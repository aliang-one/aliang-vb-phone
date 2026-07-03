/**
 * ai.done ends ONE streaming turn — NOT necessarily the whole run. For a
 * tool-using agent (multi-turn tool calls) or providers like codex, the next
 * turn follows within seconds, so the SERVER arms a soft-settle
 * (ALIANG_AI_IDLE_SETTLE_MS, default 10s) and only flips the session to idle
 * when no further activity arrives. The phone MIRRORS that semantics: on ai.done
 * it does NOT flip status running→idle. It leaves status untouched, bumps
 * lastActivityMs (so the reverse stale guard holds against late running
 * snapshots), finalizes this turn's structured events (thinking inactive /
 * started command done), and schedules a debounced snapshot refresh. The
 * authoritative idle transition arrives later via the server's settle broadcast
 * (ai.session.updated carrying a newer lastActivityMs → mergeVibeRunSnapshot
 * demotes) — or the next ai.delta / ai.run.started simply keeps it running.
 *
 * This is the root-cause fix for "明明正在运行中,结果却显示已完成": the old handler
 * flipped idle the instant ai.done arrived, so every inter-tool gap of a
 * multi-tool run flashed 已完成 (顶部相位/composer 锁/停止按钮 全部跟着翻) until
 * the next event revived status. ai.done 与服务端语义对齐后,静默工具间隙不再误闪.
 */
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { VibeCodingRun } from '../src/data/platformModels';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
  },
}));

// ai.done schedules a debounced refreshFromServer; use fake timers so it never
// fires after teardown (would log "Cannot log after tests are done").
jest.useFakeTimers();
afterEach(() => {
  jest.clearAllTimers();
});

const run = (over: Partial<VibeCodingRun>): VibeCodingRun =>
  ({
    id: 's1',
    deviceId: 'd1',
    projectId: 'p1',
    status: 'running',
    transcript: [],
    events: [],
    structuredEvents: [],
    ...over,
  }) as unknown as VibeCodingRun;

const aiDone = () =>
  useControlCenterStore
    .getState()
    .handleTransportEvent({
      type: 'ai.done',
      sessionId: 's1',
      detail: '',
      raw: {},
    });

describe('ai.done keeps the turn alive (defers idle to the server soft-settle)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useControlCenterStore.setState({
      serverMode: true,
      vibeRuns: [run({ status: 'running' })],
      devices: [],
    });
  });

  it('does NOT flip running → idle — root cause of "运行中却显示已完成"', () => {
    // The turn's streaming reply ended, but the run may continue (the server's
    // 10s soft-settle is the authority for true idle; ai.done is not terminal).
    aiDone();
    expect(useControlCenterStore.getState().vibeRuns[0].status).toBe('running');
  });

  it('does not clobber failed / completed / waiting_approval (status untouched)', () => {
    const preserve = ['failed', 'completed', 'waiting_approval'] as const;
    for (const status of preserve) {
      useControlCenterStore.setState({ vibeRuns: [run({ status })] });
      aiDone();
      expect(useControlCenterStore.getState().vibeRuns[0].status).toBe(status);
    }
  });

  it('finalizes an active thinking / started-command structured event (and stays running)', () => {
    useControlCenterStore.setState({
      vibeRuns: [
        run({
          status: 'running',
          structuredEvents: [
            {
              kind: 'thinking',
              eventId: 't1',
              messageId: 'a1',
              active: true,
              chars: 5,
            },
            {
              kind: 'command',
              eventId: 'c1',
              messageId: 'a1',
              itemId: 'i1',
              status: 'started',
              command: 'ls',
            },
          ],
        }),
      ],
    });
    aiDone();
    const evs = useControlCenterStore.getState().vibeRuns[0].structuredEvents;
    const think = evs.find(e => e.kind === 'thinking');
    const cmd = evs.find(e => e.kind === 'command');
    if (think && 'active' in think) expect(think.active).toBe(false);
    if (cmd && 'status' in cmd) expect(cmd.status).toBe('done');
    // Status is still running despite the finalized structured events.
    expect(useControlCenterStore.getState().vibeRuns[0].status).toBe('running');
  });

  it('bumps lastActivityMs so the reverse stale guard holds against late running snapshots', () => {
    const before =
      useControlCenterStore.getState().vibeRuns[0].lastActivityMs ?? 0;
    aiDone();
    const after = useControlCenterStore.getState().vibeRuns[0].lastActivityMs ?? 0;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

describe('ai.status halt signal settles to idle (interrupt path)', () => {
  // After ai.stop the agent ends the run WITHOUT ai.done, emitting ai.status
  // "stopped"/"stopping"/"interrupted". The handler must map these to idle — not
  // force 'running' (which would re-activate a session the user just stopped).
  beforeEach(() => {
    jest.clearAllMocks();
    useControlCenterStore.setState({
      serverMode: true,
      vibeRuns: [run({ status: 'running' })],
      devices: [],
    });
  });

  const statusEvent = (status: string) =>
    useControlCenterStore.getState().handleTransportEvent({
      type: 'ai.status',
      sessionId: 's1',
      status,
      raw: {},
    });

  it('stopped / stopping / interrupted → idle (no re-activation to running)', () => {
    for (const s of ['stopped', 'stopping', 'interrupted']) {
      useControlCenterStore.setState({ vibeRuns: [run({ status: 'running' })] });
      statusEvent(s);
      expect(useControlCenterStore.getState().vibeRuns[0].status).toBe('idle');
    }
  });

  it('does not clobber failed / completed', () => {
    for (const cur of ['failed', 'completed'] as const) {
      useControlCenterStore.setState({ vibeRuns: [run({ status: cur })] });
      statusEvent('interrupted');
      expect(useControlCenterStore.getState().vibeRuns[0].status).toBe(cur);
    }
  });

  it('an unknown status keeps the current status (does not force running)', () => {
    useControlCenterStore.setState({ vibeRuns: [run({ status: 'idle' })] });
    statusEvent('approval_not_found');
    expect(useControlCenterStore.getState().vibeRuns[0].status).toBe('idle');
  });
});
