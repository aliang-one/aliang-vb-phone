jest.mock('../../services/platformTransport', () => ({
  platformTransport: {
    loadSnapshot: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
  },
}));

import { useControlCenterStore } from '../controlCenterStore';
import {
  emptySessionData,
  mergeTerminalSessionSnapshot,
  serverTerminalSessionToClient,
} from '../internals';
import {
  isLocalTerminalResizeRecent,
  markLocalTerminalResize,
  resetTerminalGeometryFollowForTests,
} from '../../services/terminalGeometryFollow';
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
  createdAt: '2026-10-05T08:00:00.000Z',
  updatedAt: '2026-10-05T08:00:00.000Z',
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

const geometryEvent = (over: {
  sessionId: string;
  cols?: number;
  rows?: number;
  origin?: 'web' | 'phone';
}) => ({
  type: 'terminal.geometry_changed' as const,
  sessionId: over.sessionId,
  cols: over.cols ?? 120,
  rows: over.rows ?? 40,
  origin: over.origin ?? 'web',
  raw: {},
});

const getTerminal = (id: string) =>
  useControlCenterStore
    .getState()
    .terminalSessions.find(ts => ts.id === id) as TerminalSession;

// 几何跟随(设计 §1/§2):server resize 成功后广播 geometry_changed,非自发
// 回显的写入会话条目 geometryFollow(重进终端屏仍在跟随);2.5s 自发窗口内的
// 回显被忽略。clearTerminalGeometryFollow 是夺回跟随的统一出口。
describe('terminal.geometry_changed → geometryFollow (dispatcher)', () => {
  beforeEach(() => {
    // 窗口是模块级 Map——用例间必须清,否则上一条的 mark 会吞掉本条的写入。
    resetTerminalGeometryFollowForTests();
    seedStore([makeSession({ id: 'term-1' }), makeSession({ id: 'term-2' })]);
  });

  it('records cols/rows/origin on the target session only', () => {
    dispatch(geometryEvent({ sessionId: 'term-1', cols: 132, rows: 43, origin: 'web' }));

    expect(getTerminal('term-1').geometryFollow).toEqual({
      cols: 132,
      rows: 43,
      origin: 'web',
    });
    // Sibling sessions are untouched.
    expect(getTerminal('term-2').geometryFollow).toBeUndefined();
  });

  it('overwrites a previous follow with the newest geometry', () => {
    dispatch(geometryEvent({ sessionId: 'term-1', cols: 100, rows: 30 }));
    dispatch(geometryEvent({ sessionId: 'term-1', cols: 90, rows: 28, origin: 'phone' }));

    expect(getTerminal('term-1').geometryFollow).toEqual({
      cols: 90,
      rows: 28,
      origin: 'phone',
    });
  });

  it('ignores the echo of a local resize inside the 2.5s window', () => {
    markLocalTerminalResize('term-1');
    dispatch(geometryEvent({ sessionId: 'term-1', cols: 132, rows: 43 }));

    expect(getTerminal('term-1').geometryFollow).toBeUndefined();
  });

  it('still records after the local window has passed (another client resized)', () => {
    jest.useFakeTimers();
    try {
      markLocalTerminalResize('term-1');
      // 2.5s 窗口滑出:此刻到达的 geometry_changed 只能是别的客户端发起的。
      jest.advanceTimersByTime(2500);
      dispatch(geometryEvent({ sessionId: 'term-1', cols: 132, rows: 43 }));
    } finally {
      jest.useRealTimers();
    }

    expect(getTerminal('term-1').geometryFollow).toEqual({
      cols: 132,
      rows: 43,
      origin: 'web',
    });
  });

  it('a geometry event for an unknown session is a no-op (no placeholder)', () => {
    dispatch(geometryEvent({ sessionId: 'term-unknown' }));

    expect(
      useControlCenterStore.getState().terminalSessions.map(ts => ts.id),
    ).toEqual(['term-1', 'term-2']);
  });
});

describe('clearTerminalGeometryFollow action', () => {
  beforeEach(() => {
    resetTerminalGeometryFollowForTests();
    seedStore([
      makeSession({
        id: 'term-1',
        geometryFollow: { cols: 120, rows: 40, origin: 'web' },
      }),
      makeSession({
        id: 'term-2',
        geometryFollow: { cols: 80, rows: 24, origin: 'phone' },
      }),
    ]);
  });

  it('clears the follow of only the target session', () => {
    useControlCenterStore.getState().clearTerminalGeometryFollow('term-1');

    expect(getTerminal('term-1').geometryFollow).toBeUndefined();
    expect(getTerminal('term-2').geometryFollow).toEqual({
      cols: 80,
      rows: 24,
      origin: 'phone',
    });
  });

  it('is a no-op for an unknown session id', () => {
    useControlCenterStore.getState().clearTerminalGeometryFollow('term-404');

    expect(getTerminal('term-1').geometryFollow).toEqual({
      cols: 120,
      rows: 40,
      origin: 'web',
    });
    expect(getTerminal('term-2').geometryFollow).toEqual({
      cols: 80,
      rows: 24,
      origin: 'phone',
    });
  });
});

describe('geometryFollow survives snapshot rehydration', () => {
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
      created_at: '2026-10-05T08:00:00.000Z',
      last_active_at: '2026-10-05T08:00:00.000Z',
      ...over,
    }) as PlatformTerminalSessionSnapshot;

  it('mergeTerminalSessionSnapshot keeps the pending follow (attach re-entry keeps the badge)', () => {
    const existing = makeSession({
      id: 'term-1',
      geometryFollow: { cols: 120, rows: 40, origin: 'web' },
    });
    const incoming = serverTerminalSessionToClient(
      snapshotSession({ session_id: 'term-1' }),
    );

    const merged = mergeTerminalSessionSnapshot(existing, incoming);
    expect(merged.geometryFollow).toEqual({ cols: 120, rows: 40, origin: 'web' });
  });

  it('a fresh snapshot-mapped session starts without a follow', () => {
    const mapped = serverTerminalSessionToClient(
      snapshotSession({ session_id: 'term-2' }),
    );
    expect(mapped.geometryFollow).toBeUndefined();
  });
});

describe('plain terminal.created rebirth drops a stale follow', () => {
  it('clears geometryFollow along with the stale replay state', () => {
    resetTerminalGeometryFollowForTests();
    seedStore([
      makeSession({
        id: 'term-1',
        geometryFollow: { cols: 120, rows: 40, origin: 'web' },
      }),
    ]);
    dispatch({ type: 'terminal.created', sessionId: 'term-1', raw: {} });

    expect(getTerminal('term-1').geometryFollow).toBeUndefined();
  });
});

// 重连 re-attach(resumed:true)是「重进终端屏仍在跟随」的主路径之一:该分支
// 只改 status/exitReason,不得顺带抹掉挂起的跟随。墓碑分支(exited:true)同理。
describe('terminal.created resumed/exited keep the pending follow', () => {
  beforeEach(() => {
    resetTerminalGeometryFollowForTests();
    seedStore([
      makeSession({
        id: 'term-1',
        geometryFollow: { cols: 120, rows: 40, origin: 'web' },
      }),
    ]);
  });

  it('resumed:true (live re-attach) keeps the follow', () => {
    dispatch({
      type: 'terminal.created',
      sessionId: 'term-1',
      raw: { resumed: true },
    });

    expect(getTerminal('term-1').geometryFollow).toEqual({
      cols: 120,
      rows: 40,
      origin: 'web',
    });
    expect(getTerminal('term-1').status).toBe('running');
  });

  it('exited:true (tombstone attach) keeps the follow too', () => {
    dispatch({
      type: 'terminal.created',
      sessionId: 'term-1',
      raw: { exited: true },
    });

    expect(getTerminal('term-1').geometryFollow).toEqual({
      cols: 120,
      rows: 40,
      origin: 'web',
    });
    expect(getTerminal('term-1').status).toBe('completed');
  });
});

describe('terminal.closed forgets the local-resize window entry', () => {
  it('drops the window mark along with the session (bounded-map hygiene)', () => {
    resetTerminalGeometryFollowForTests();
    seedStore([makeSession({ id: 'term-1' })]);
    markLocalTerminalResize('term-1');

    dispatch({ type: 'terminal.closed', sessionId: 'term-1', raw: {} });

    expect(isLocalTerminalResizeRecent('term-1')).toBe(false);
  });
});
