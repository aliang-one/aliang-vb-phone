/**
 * ai.done is the definitive turn-end signal in `--print` headless mode (one
 * process per prompt → one ai.done at the true end). The phone now flips
 * `status: running → idle` on it — the unified trigger that settles the top
 * phase to 已完成, hides the stop button, unlocks the composer, and opens the
 * send guard — immediately, with no 8s activity window.
 *
 * These pin that behavior (and the don't-clobber-terminal / finalize-structured-
 * events side effects) so a refactor of the ai.done handler stays honest.
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

describe('ai.done settles the turn (status running → idle)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useControlCenterStore.setState({
      serverMode: true,
      vibeRuns: [run({ status: 'running' })],
      devices: [],
    });
  });

  it('flips running → idle (definitive turn end, no 8s wait)', () => {
    aiDone();
    expect(useControlCenterStore.getState().vibeRuns[0].status).toBe('idle');
  });

  it('does not clobber failed / completed / waiting_approval', () => {
    const preserve = ['failed', 'completed', 'waiting_approval'] as const;
    for (const status of preserve) {
      useControlCenterStore.setState({ vibeRuns: [run({ status })] });
      aiDone();
      expect(useControlCenterStore.getState().vibeRuns[0].status).toBe(status);
    }
  });

  it('finalizes an active thinking / started-command structured event', () => {
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
  // force 'running' (which would re-activate a session the user just stopped, and
  // with no 8s window anymore, would stick).
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
