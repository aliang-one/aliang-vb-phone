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

describe('authoritative snapshot ordering across client stream batching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    useControlCenterStore.setState({
      serverMode: true,
      devices: [],
      projects: [],
      vibeRuns: [
        {
          id: 's1',
          deviceId: 'd1',
          projectId: '',
          status: 'running',
          phase: 'running',
          activeRunId: 'r1',
          latestRunId: 'r1',
          runState: 'running',
          runStateVersion: 2,
          transcript: [],
          events: [],
          structuredEvents: [],
          lastActivityMs: 1,
        } as unknown as VibeCodingRun,
      ],
    });
  });

  it('flushes an earlier buffered delta before applying completed', () => {
    useControlCenterStore.getState().handleTransportEvent({
      type: 'ai.delta',
      sessionId: 's1',
      delta: 'final text',
      messageId: 'a1',
      raw: {},
    } as PlatformTransportEvent);

    useControlCenterStore.getState().handleTransportEvent({
      type: 'ai.session.updated',
      session: {
        session_id: 's1',
        kind: 'ai',
        user_id: 'u1',
        device_id: 'd1',
        status: 'idle',
        phase: 'completed',
        latest_run_id: 'r1',
        run_state: 'completed',
        run_state_version: 3,
        mode: 'vibe',
        created_at: '2026-01-01T00:00:00.000Z',
        last_active_at: '2026-01-01T00:00:01.000Z',
      },
      raw: {},
    } as PlatformTransportEvent);

    let run = useControlCenterStore.getState().vibeRuns[0];
    expect(run.transcript.at(-1)?.content).toBe('final text');
    expect(run.status).toBe('idle');
    expect(run.phase).toBe('completed');
    expect(run.runStateVersion).toBe(3);

    jest.runOnlyPendingTimers();
    run = useControlCenterStore.getState().vibeRuns[0];
    expect(run.status).toBe('idle');
    expect(run.phase).toBe('completed');
  });
});

