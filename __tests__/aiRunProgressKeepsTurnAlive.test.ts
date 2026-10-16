/**
 * `ai.run.progress` is the agent's heartbeat during the quiet gaps of a
 * tool-using run — subagent execution, a long Bash, an API retry. It is the
 * ONLY event the agent emits when no `ai.delta` is flowing (the Claude path
 * ticks it every 10s; see agent_ai.go runCLIPass). The phone MUST treat it as
 * "the turn is still alive":
 *   - refresh lastActivityMs so mergeVibeRunSnapshot's stale-demotion guard
 *     has a current timestamp (otherwise a server idle snapshot whose
 *     lastActivityMs is newer than our stagnant local one demotes a running
 *     turn);
 *   - keep status running, and restore running if a stale snapshot already
 *     demoted it to idle.
 *
 * Before this fix `ai.run.progress` was unmapped at the transport layer (fell
 * through to `{type:'raw'}`) and had no case in handleTransportEvent, so a long
 * quiet gap let the phone show "已完成" while the agent was still working.
 *
 * `ai.run.started` is the turn-start signal; the code's own comment claimed
 * "running is carried by ai.run.started" but no such case existed. Pin both.
 */
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { PlatformTransportEvent } from '../src/services/platformTransport';
import type { VibeCodingRun } from '../src/data/platformModels';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
  },
}));

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
    lastActivityMs: 1_000,
    ...over,
  }) as unknown as VibeCodingRun;

const progress = () =>
  useControlCenterStore.getState().handleTransportEvent({
    type: 'ai.run.progress',
    sessionId: 's1',
    raw: {},
  } as unknown as PlatformTransportEvent);

const started = () =>
  useControlCenterStore.getState().handleTransportEvent({
    type: 'ai.run.started',
    sessionId: 's1',
    raw: {},
  } as unknown as PlatformTransportEvent);

describe('ai.run.progress keeps the turn alive (quiet-gap heartbeat)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.setSystemTime(10_000);
    useControlCenterStore.setState({
      serverMode: true,
      vibeRuns: [run({ status: 'running', lastActivityMs: 1_000 })],
      devices: [],
    });
  });

  it('refreshes lastActivityMs to the wire event clock so the stale-demotion guard has a current timestamp', () => {
    // 事件钟契约(2026-10-15 事故):心跳把 lastActivityMs 刷到 broker 信封的
    // created_at(服务端发送时刻=会话真实活跃时刻),而不是手机本地钟——
    // "收到事件"不等于"会话此刻活跃"。守卫目的不变:时间戳保持新鲜。
    const wireTs = '2026-10-15T05:15:34.000Z';
    useControlCenterStore.getState().handleTransportEvent({
      type: 'ai.run.progress',
      sessionId: 's1',
      raw: { created_at: wireTs },
    } as unknown as PlatformTransportEvent);
    expect(
      useControlCenterStore.getState().vibeRuns[0].lastActivityMs,
    ).toBe(Date.parse(wireTs));
  });

  it('keeps the existing timestamp when the envelope carries no clock (no fabrication)', () => {
    // 信封缺 created_at(极老服务端):宁可不刷新,也不拿本地 now 伪造——
    // 伪造值会被 mergeVibeRunSnapshot 的棘轮钉死(事故链第二环)。
    jest.setSystemTime(20_000);
    progress();
    expect(
      useControlCenterStore.getState().vibeRuns[0].lastActivityMs,
    ).toBe(1_000);
  });

  it('keeps a running turn running (no mid-run demotion)', () => {
    progress();
    expect(useControlCenterStore.getState().vibeRuns[0].status).toBe('running');
  });

  it('restores running when a stale server snapshot had demoted the turn to idle', () => {
    useControlCenterStore.setState({
      vibeRuns: [run({ status: 'idle', lastActivityMs: 1_000 })],
    });
    progress();
    expect(useControlCenterStore.getState().vibeRuns[0].status).toBe('running');
  });

  it('does not clobber failed / completed terminal states', () => {
    for (const status of ['failed', 'completed'] as const) {
      useControlCenterStore.setState({
        vibeRuns: [run({ status, lastActivityMs: 1_000 })],
      });
      progress();
      expect(useControlCenterStore.getState().vibeRuns[0].status).toBe(status);
    }
  });
});

describe('ai.run.started marks the turn running', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.setSystemTime(10_000);
    useControlCenterStore.setState({
      serverMode: true,
      vibeRuns: [run({ status: 'idle', lastActivityMs: 1_000 })],
      devices: [],
    });
  });

  it('flips idle → running and refreshes lastActivityMs to the wire clock', () => {
    const wireTs = '2026-10-15T05:15:34.000Z';
    useControlCenterStore.getState().handleTransportEvent({
      type: 'ai.run.started',
      sessionId: 's1',
      raw: { created_at: wireTs },
    } as unknown as PlatformTransportEvent);
    const s = useControlCenterStore.getState().vibeRuns[0];
    expect(s.status).toBe('running');
    expect(s.lastActivityMs).toBe(Date.parse(wireTs));
  });

  it('does not clobber failed / completed terminal states', () => {
    for (const status of ['failed', 'completed'] as const) {
      useControlCenterStore.setState({
        vibeRuns: [run({ status, lastActivityMs: 1_000 })],
      });
      started();
      expect(useControlCenterStore.getState().vibeRuns[0].status).toBe(status);
    }
  });
});
