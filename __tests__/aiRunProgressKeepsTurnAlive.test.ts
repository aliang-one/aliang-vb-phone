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

  it('refreshes lastActivityMs so the stale-demotion guard has a current timestamp', () => {
    // A quiet gap elapsed on the agent side; its heartbeat arrives now.
    jest.setSystemTime(20_000);
    progress();
    expect(
      useControlCenterStore.getState().vibeRuns[0].lastActivityMs,
    ).toBeGreaterThanOrEqual(20_000);
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

  it('flips idle → running and refreshes lastActivityMs', () => {
    jest.setSystemTime(20_000);
    started();
    const s = useControlCenterStore.getState().vibeRuns[0];
    expect(s.status).toBe('running');
    expect(s.lastActivityMs).toBeGreaterThanOrEqual(20_000);
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
