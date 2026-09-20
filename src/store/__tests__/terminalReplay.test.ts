jest.mock('../../services/platformTransport', () => ({
  platformTransport: {
    loadSnapshot: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
  },
}));

import {
  appendTerminalReplayChunk,
  beginTerminalReplayStream,
  emptySessionData,
  finalizeTerminalReplay,
  MAX_REPLAY_CHUNKS_BYTES,
  mergeTerminalSessionSnapshot,
  serverTerminalSessionToClient,
} from '../internals';
import { useControlCenterStore } from '../controlCenterStore';
import { drainPendingTerminalOutput } from '../../services/terminalOutputRegistry';
import type { ControlCenterState, TerminalSession } from '../types';
import type { PlatformTerminalSessionSnapshot } from '../../services/platformTransport';

type Dispatcher = ControlCenterState['handleTransportEvent'];

const makeSession = (
  over: Partial<TerminalSession> & { id: string },
): TerminalSession => ({
  deviceId: 'device-1',
  directory: '~',
  shell: 'zsh',
  status: 'running',
  lines: [],
  createdAt: '2026-09-20T08:00:00.000Z',
  updatedAt: '2026-09-20T08:00:00.000Z',
  ...over,
});

const seedStore = (sessions: TerminalSession[]) => {
  useControlCenterStore.setState({
    ...emptySessionData(),
    serverMode: true,
    terminalSessions: sessions,
  });
};

const dispatch = (event: Parameters<Dispatcher>[0]) =>
  useControlCenterStore.getState().handleTransportEvent(event);

const replayFrame = (over: {
  sessionId: string;
  data?: string;
  seq?: number;
  final?: boolean;
  status?: string;
  truncated?: boolean;
}) => ({
  type: 'terminal.replay' as const,
  sessionId: over.sessionId,
  data: over.data ?? '',
  encoding: 'text',
  seq: over.seq ?? 0,
  final: over.final ?? false,
  status: over.status,
  truncated: over.truncated,
  raw: {},
});

const getTerminal = (id: string) =>
  useControlCenterStore
    .getState()
    .terminalSessions.find(ts => ts.id === id) as TerminalSession;

const snapshotSession = (
  over: Partial<PlatformTerminalSessionSnapshot> & {
    session_id: string;
  },
): PlatformTerminalSessionSnapshot =>
  ({
    kind: 'terminal',
    user_id: 'user-1',
    device_id: 'device-1',
    status: 'active',
    cols: 80,
    rows: 24,
    created_at: '2026-09-20T08:00:00.000Z',
    last_active_at: '2026-09-20T08:00:00.000Z',
    ...over,
  }) as PlatformTerminalSessionSnapshot;

describe('terminal.replay buffering (dispatcher)', () => {
  beforeEach(() => {
    seedStore([makeSession({ id: 'term-1' })]);
  });

  it('accumulates chunks in order and the final frame marks replayReady', () => {
    dispatch(replayFrame({ sessionId: 'term-1', data: '$ ls\r\n', seq: 0 }));
    dispatch(replayFrame({ sessionId: 'term-1', data: 'a.txt\n', seq: 1 }));
    dispatch(
      replayFrame({
        sessionId: 'term-1',
        seq: 2,
        final: true,
        status: 'live',
        truncated: false,
      }),
    );

    const session = getTerminal('term-1');
    expect(session.replayChunks).toEqual(['$ ls\r\n', 'a.txt\n']);
    expect(session.replayReady).toBe(true);
    expect(session.replayStatus).toBe('live');
    expect(session.replayTruncated).toBe(false);
  });

  it('never writes replay frames into session.lines (lossy path is off-limits)', () => {
    const before = getTerminal('term-1').lines;
    dispatch(replayFrame({ sessionId: 'term-1', data: '$ ls\r\n' }));
    expect(getTerminal('term-1').lines).toBe(before);
  });

  it('live terminal.output keeps going to the registry pending buffer, not replayChunks', () => {
    dispatch({ type: 'terminal.output', sessionId: 'term-1', data: 'live\n', encoding: 'text', raw: {} });
    // No emulator is mounted in this test, so the chunk must sit in the
    // registry's pending buffer — replayChunks is reserved for replay frames.
    expect(drainPendingTerminalOutput('term-1')).toEqual([
      { data: 'live\n', encoding: 'text' },
    ]);
    expect(getTerminal('term-1').replayChunks).toBeUndefined();
  });

  it('final frame with status "exited" records the exited replay status', () => {
    dispatch(replayFrame({ sessionId: 'term-1', data: 'crash log\n', seq: 0 }));
    dispatch(
      replayFrame({
        sessionId: 'term-1',
        seq: 1,
        final: true,
        status: 'exited',
        truncated: false,
      }),
    );

    const session = getTerminal('term-1');
    expect(session.replayChunks).toEqual(['crash log\n']);
    expect(session.replayReady).toBe(true);
    expect(session.replayStatus).toBe('exited');
  });

  it('a re-attach (second replay stream) REPLACES the previous buffer, never duplicates', () => {
    // Attach #1: replay scrollback, then the agent confirms a live resume.
    dispatch(replayFrame({ sessionId: 'term-1', data: 'FIRST\r\n', seq: 0 }));
    dispatch(
      replayFrame({ sessionId: 'term-1', seq: 1, final: true, status: 'live' }),
    );
    dispatch({
      type: 'terminal.created',
      sessionId: 'term-1',
      raw: { resumed: true },
    });

    // Attach #2 (terminal screen remount): a new stream must start clean —
    // seq 0 is the stream-start marker, so the old scrollback is dropped.
    dispatch(replayFrame({ sessionId: 'term-1', data: 'SECOND\r\n', seq: 0 }));
    dispatch(
      replayFrame({ sessionId: 'term-1', seq: 1, final: true, status: 'live' }),
    );

    const session = getTerminal('term-1');
    expect(session.replayChunks).toEqual(['SECOND\r\n']);
    expect(session.replayReady).toBe(true);
    expect(session.replayTruncated).toBe(false);
  });

  it('a non-final frame on an already-finalized buffer starts a fresh stream even without a seq-0 marker', () => {
    dispatch(replayFrame({ sessionId: 'term-1', data: 'OLD\r\n', seq: 0 }));
    dispatch(
      replayFrame({ sessionId: 'term-1', seq: 1, final: true, status: 'live' }),
    );

    // A stream that never reports seq 0: the finalized buffer is itself proof
    // the previous stream ended, so a non-final frame can only be a new head.
    dispatch(replayFrame({ sessionId: 'term-1', data: 'NEW\r\n', seq: 7 }));

    expect(getTerminal('term-1').replayChunks).toEqual(['NEW\r\n']);
  });

  it('a fresh stream resets stale truncated/ready/status flags', () => {
    seedStore([
      makeSession({
        id: 'term-1',
        replayChunks: ['stale\n'],
        replayReady: true,
        replayStatus: 'exited',
        replayTruncated: true,
      }),
    ]);
    dispatch(replayFrame({ sessionId: 'term-1', data: 'fresh\n', seq: 0 }));

    const session = getTerminal('term-1');
    expect(session.replayChunks).toEqual(['fresh\n']);
    expect(session.replayReady).toBe(false);
    expect(session.replayStatus).toBeUndefined();
    expect(session.replayTruncated).toBe(false);
  });

  it('an empty re-attach (seq-0 final frame only) clears stale scrollback', () => {
    // Attach #1 had scrollback; attach #2 finds none — the lone seq-0 final
    // frame IS the whole fresh stream, so the stale chunks must not survive.
    seedStore([
      makeSession({
        id: 'term-1',
        replayChunks: ['old\r\n'],
        replayReady: true,
        replayStatus: 'live',
      }),
    ]);
    dispatch(
      replayFrame({ sessionId: 'term-1', seq: 0, final: true, status: 'live' }),
    );

    const session = getTerminal('term-1');
    expect(session.replayChunks).toEqual([]);
    expect(session.replayReady).toBe(true);
    expect(session.replayTruncated).toBe(false);
  });

  it('drops the OLDEST chunks past the 512KB cap and flags replayTruncated', () => {
    // Each chunk ~128KB: 5 chunks = 640KB > 512KB cap → the head must go.
    const chunk = 'x'.repeat(128 * 1024);
    dispatch(replayFrame({ sessionId: 'term-1', data: chunk, seq: 0 }));
    dispatch(replayFrame({ sessionId: 'term-1', data: chunk, seq: 1 }));
    dispatch(replayFrame({ sessionId: 'term-1', data: chunk, seq: 2 }));
    dispatch(replayFrame({ sessionId: 'term-1', data: chunk, seq: 3 }));
    dispatch(
      replayFrame({
        sessionId: 'term-1',
        data: chunk,
        seq: 4,
        final: true,
        status: 'live',
        truncated: false,
      }),
    );

    const session = getTerminal('term-1');
    expect(session.replayChunks).toBeDefined();
    expect(session.replayChunks!.length).toBeLessThan(5);
    // The newest chunk (seq 4) survives; some earlier chunk was dropped.
    expect(session.replayChunks![session.replayChunks!.length - 1]).toBe(chunk);
    // Kept chunks together stay within the byte cap.
    const keptBytes = session.replayChunks!.reduce(
      (total, item) => total + item.length,
      0,
    );
    expect(keptBytes).toBeLessThanOrEqual(MAX_REPLAY_CHUNKS_BYTES);
    expect(session.replayTruncated).toBe(true);
    expect(session.replayReady).toBe(true);
  });
});

describe('terminal.created resumed/exited state machine (dispatcher)', () => {
  beforeEach(() => {
    seedStore([makeSession({ id: 'term-1' })]);
  });

  it('created{resumed:true} keeps the session running with its replay chunks', () => {
    dispatch(replayFrame({ sessionId: 'term-1', data: '$ ls\r\n', seq: 0 }));
    dispatch(
      replayFrame({ sessionId: 'term-1', seq: 1, final: true, status: 'live' }),
    );
    dispatch({
      type: 'terminal.created',
      sessionId: 'term-1',
      raw: { resumed: true },
    });

    const session = getTerminal('term-1');
    expect(session.status).toBe('running');
    expect(session.replayChunks).toEqual(['$ ls\r\n']);
    expect(session.replayReady).toBe(true);
  });

  it('created{exited:true} completes the session and KEEPS replay chunks', () => {
    dispatch(replayFrame({ sessionId: 'term-1', data: 'crash log\n', seq: 0 }));
    dispatch(
      replayFrame({ sessionId: 'term-1', seq: 1, final: true, status: 'exited' }),
    );
    dispatch({
      type: 'terminal.created',
      sessionId: 'term-1',
      raw: { resumed: false, exited: true },
    });

    const session = getTerminal('term-1');
    expect(session.status).toBe('completed');
    expect(session.replayChunks).toEqual(['crash log\n']);
    expect(session.replayReady).toBe(true);
    expect(session.replayStatus).toBe('exited');
  });

  it('a plain created (fresh session) clears any stale replay state', () => {
    seedStore([
      makeSession({
        id: 'term-1',
        replayChunks: ['stale\n'],
        replayReady: true,
        replayStatus: 'live',
        replayTruncated: true,
      }),
    ]);
    dispatch({ type: 'terminal.created', sessionId: 'term-1', raw: {} });

    const session = getTerminal('term-1');
    expect(session.status).toBe('running');
    expect(session.replayChunks).toEqual([]);
    expect(session.replayReady).toBe(false);
    expect(session.replayStatus).toBeUndefined();
    expect(session.replayTruncated).toBe(false);
  });
});

describe('terminal.closed clears replay state (dispatcher)', () => {
  it('resets the replay buffer of the closed session', () => {
    seedStore([
      makeSession({
        id: 'term-1',
        replayChunks: ['$ ls\r\n', 'a.txt\n'],
        replayReady: true,
        replayStatus: 'live',
      }),
    ]);
    dispatch({ type: 'terminal.closed', sessionId: 'term-1', raw: {} });

    const session = getTerminal('term-1');
    expect(session.status).toBe('completed');
    expect(session.replayChunks).toEqual([]);
    expect(session.replayReady).toBe(false);
    expect(session.replayStatus).toBeUndefined();
  });
});

describe('resetTerminalReplay action', () => {
  it('clears the replay buffer of only the target session (P4 attach hook)', () => {
    seedStore([
      makeSession({
        id: 'term-1',
        replayChunks: ['old\n'],
        replayReady: true,
        replayStatus: 'live',
        replayTruncated: true,
      }),
      makeSession({ id: 'term-2', replayChunks: ['keep\n'] }),
    ]);

    useControlCenterStore.getState().resetTerminalReplay('term-1');

    const target = getTerminal('term-1');
    expect(target.replayChunks).toEqual([]);
    expect(target.replayReady).toBe(false);
    expect(target.replayStatus).toBeUndefined();
    expect(target.replayTruncated).toBe(false);
    // Sibling sessions are untouched.
    expect(getTerminal('term-2').replayChunks).toEqual(['keep\n']);
  });
});

describe('appendTerminalReplayChunk (pure)', () => {
  it('returns the same reference for an empty chunk', () => {
    const session = makeSession({ id: 'term-1' });
    expect(appendTerminalReplayChunk(session, '')).toBe(session);
  });

  it('beginTerminalReplayStream returns a session with clean replay state', () => {
    const stale = makeSession({
      id: 'term-1',
      replayChunks: ['old\n'],
      replayReady: true,
      replayStatus: 'exited',
      replayTruncated: true,
    });
    const fresh = beginTerminalReplayStream(stale);
    expect(fresh.replayChunks).toEqual([]);
    expect(fresh.replayReady).toBe(false);
    expect(fresh.replayStatus).toBeUndefined();
    expect(fresh.replayTruncated).toBe(false);
    // Non-replay fields untouched.
    expect(fresh.lines).toBe(stale.lines);
    expect(fresh.status).toBe(stale.status);
  });

  it('appends to an undefined buffer as if it were empty', () => {
    const session = makeSession({ id: 'term-1' });
    const next = appendTerminalReplayChunk(session, 'hello\n');
    expect(next.replayChunks).toEqual(['hello\n']);
    expect(next.replayTruncated).toBe(false);
  });
});

describe('mergeTerminalSessionSnapshot replay preservation', () => {
  it('does not clear unconsumed replayChunks when a snapshot rehydrates', () => {
    const existing = makeSession({
      id: 'term-1',
      replayChunks: ['$ ls\r\n'],
      replayReady: true,
      replayStatus: 'live',
      replayTruncated: true,
    });
    const incoming = serverTerminalSessionToClient(
      snapshotSession({ session_id: 'term-1' }),
    );

    const merged = mergeTerminalSessionSnapshot(existing, incoming);
    expect(merged.replayChunks).toEqual(['$ ls\r\n']);
    expect(merged.replayReady).toBe(true);
    expect(merged.replayStatus).toBe('live');
    expect(merged.replayTruncated).toBe(true);
  });

  it('a fresh session from the server snapshot starts with clean replay state', () => {
    const mapped = serverTerminalSessionToClient(
      snapshotSession({ session_id: 'term-2' }),
    );
    expect(mapped.replayChunks).toEqual([]);
    expect(mapped.replayReady).toBe(false);
    expect(mapped.replayStatus).toBeUndefined();
    expect(mapped.replayTruncated).toBe(false);
  });
});

describe('finalizeTerminalReplay (pure)', () => {
  it('marks ready with the live status by default', () => {
    const next = finalizeTerminalReplay(makeSession({ id: 'term-1' }));
    expect(next.replayReady).toBe(true);
    expect(next.replayStatus).toBe('live');
  });

  it('keeps a locally-set truncation flag even when the agent reports none', () => {
    // Two ~400KB chunks exceed the 512KB cap → the head is dropped.
    const dropped = appendTerminalReplayChunk(
      appendTerminalReplayChunk(
        makeSession({ id: 'term-1' }),
        'x'.repeat(400 * 1024),
      ),
      'y'.repeat(400 * 1024),
    );
    expect(dropped.replayTruncated).toBe(true);

    const finalized = finalizeTerminalReplay(dropped, {
      status: 'live',
      truncated: false,
    });
    expect(finalized.replayTruncated).toBe(true);
  });
});
