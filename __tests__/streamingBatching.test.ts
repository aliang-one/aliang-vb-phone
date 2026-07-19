/**
 * Characterization tests for the realtime streaming-batching integration.
 *
 * `deltaBatch.test.ts` only unit-tests the pure `applyDeltasToRuns` helper. These
 * tests pin the BEHAVIOR AROUND it that lives in the store's transport dispatcher:
 * the module-level `pendingDeltas` buffer, the ~100ms coalescing timer, the
 * "flush pending before a different event" ordering rule, and the cancel-on-reset
 * coupling between the realtime slice and the batching state.
 *
 * They exist so a refactor of that batching plumbing (e.g. extracting it into its
 * own module) can be proven behavior-preserving: these must stay green across it.
 */
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { VibeCodingRun } from '../src/data/platformModels';

// The dispatcher path under test never touches the network; mock the transport so
// resetSessionData's disconnect() is a deterministic no-op with no real sockets.
jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.useFakeTimers();

// Mirror of the implementation's DELTA_FLUSH_MS in store/streaming.ts. Kept as a
// local copy (not imported) because the constant is module-private; if the
// flush window changes there, update this too.
const DELTA_FLUSH_MS = 100;

const run = (transcript: VibeCodingRun['transcript'] = []): VibeCodingRun => ({
  id: 's1',
  title: 'run-s1',
  deviceId: 'device-1',
  projectId: 'project-1',
  directory: '~/proj',
  status: 'running',
  objective: '',
  model: 'Claude Code',
  risk: 'medium',
  currentStep: '',
  branch: 'main',
  lastActivityMs: 0,
  updatedAt: '',
  suggestions: [],
  transcript,
  events: [],
  structuredEvents: [],
});

const deltaEvent = (delta: string, messageId = 'msg-A', currentStep = '') =>
  ({
    type: 'ai.delta' as const,
    sessionId: 's1',
    delta,
    currentStep,
    messageId,
    raw: {},
  });

const thinkingEvent = (sessionId: string, chars: number) => ({
  type: 'ai.thinking' as const,
  sessionId,
  messageId: `msg-${sessionId}`,
  active: true,
  chars,
  eventId: `thinking-${sessionId}`,
  raw: {},
});

// Dispatching any non-ai.delta event flushes pending deltas at the very start of
// the handler — used both as a flush trigger and to drain leftover state in setup.
const dispatchStatus = () =>
  useControlCenterStore
    .getState()
    .handleTransportEvent({ type: 'transport.status', status: 'connected' });

const seed = (
  transcript: VibeCodingRun['transcript'] = [
    { id: 'msg-A', role: 'assistant', content: 'Hello', timestamp: '09:59' },
  ],
) => useControlCenterStore.setState({ vibeRuns: [run(transcript)], events: [] });

const transcriptContent = () =>
  useControlCenterStore.getState().vibeRuns[0]?.transcript[0]?.content ?? '';

beforeEach(() => {
  // Drain any pending deltas + let any pending flush timer fire naturally so the
  // module-level batching state starts clean for each test. (jest.clearAllTimers
  // would dangle the module's timer handle and break the next window, so we drain
  // then advance instead.)
  dispatchStatus();
  jest.advanceTimersByTime(DELTA_FLUSH_MS + 50);
  seed();
});

describe('realtime streaming batching', () => {
  it('coalesces ai.delta tokens and flushes only after the flush window', () => {
    const store = useControlCenterStore.getState();
    store.handleTransportEvent(deltaEvent(' a'));
    store.handleTransportEvent(deltaEvent(' b'));
    store.handleTransportEvent(deltaEvent(' c'));

    // Not applied yet — tokens are buffered, not written per-token.
    expect(transcriptContent()).toBe('Hello');

    jest.advanceTimersByTime(DELTA_FLUSH_MS);

    // All three tokens merged in a single flush into the trailing message.
    expect(transcriptContent()).toBe('Hello a b c');
  });

  it('flushes pending tokens immediately when a different event arrives', () => {
    useControlCenterStore.getState().handleTransportEvent(deltaEvent(' now'));

    // A non-ai.delta event drains the buffer before it is handled, so ordering
    // is preserved (no token is lost behind a later lifecycle event).
    dispatchStatus();

    expect(transcriptContent()).toBe('Hello now');
  });

  it('cancels pending tokens on resetSessionData (no stale leak after reset)', () => {
    useControlCenterStore.getState().handleTransportEvent(deltaEvent(' leaked'));

    // resetSessionData tears down batching state as part of session reset.
    useControlCenterStore.getState().resetSessionData();

    // Re-seed a fresh run and let the (canceled) flush window elapse.
    seed();
    jest.advanceTimersByTime(DELTA_FLUSH_MS + 50);

    // The canceled token must NOT have been applied to the fresh run.
    expect(transcriptContent()).toBe('Hello');
  });

  it('coalesces interleaved delta and thinking events into one store write', () => {
    const second = { ...run(), id: 's2', title: 'run-s2' };
    const untouched = { ...run(), id: 's3', title: 'run-s3' };
    useControlCenterStore.setState({
      vibeRuns: [run(), second, untouched],
      events: [],
    });
    const untouchedRef = useControlCenterStore.getState().vibeRuns[2];
    let writes = 0;
    const unsubscribe = useControlCenterStore.subscribe((state, previous) => {
      if (state.vibeRuns !== previous.vibeRuns) writes += 1;
    });

    const store = useControlCenterStore.getState();
    for (let index = 0; index < 20; index += 1) {
      store.handleTransportEvent(deltaEvent(` ${index}`));
      store.handleTransportEvent(thinkingEvent('s2', index));
    }

    expect(writes).toBe(0);
    jest.advanceTimersByTime(DELTA_FLUSH_MS);
    expect(writes).toBe(1);
    expect(useControlCenterStore.getState().vibeRuns[2]).toBe(untouchedRef);
    unsubscribe();
  });

  it('starts a fresh timer window after an ordering-boundary flush', () => {
    const store = useControlCenterStore.getState();
    store.handleTransportEvent(deltaEvent(' first'));
    dispatchStatus();
    expect(transcriptContent()).toBe('Hello first');

    store.handleTransportEvent(deltaEvent(' second'));
    jest.advanceTimersByTime(DELTA_FLUSH_MS - 1);
    expect(transcriptContent()).toBe('Hello first');
    jest.advanceTimersByTime(1);
    expect(transcriptContent()).toBe('Hello first second');
  });
});
