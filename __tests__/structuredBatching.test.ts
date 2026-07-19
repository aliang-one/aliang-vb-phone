/**
 * Characterization tests for the structured-activity batching integration.
 *
 * `structuredEvents.test.ts` only unit-tests the pure `applyStructuredEvent`
 * helper. These pin the BEHAVIOR AROUND it that lives in the store's transport
 * dispatcher: the module-level `pendingStructured` buffer, the ~100ms coalescing
 * timer, the "flush pending before a non-structured event" ordering rule, and
 * the cancel-on-reset coupling between the realtime slice and this batching
 * state.
 *
 * They exist for the same reason `streamingBatching.test.ts` does: the agent
 * emits ai.thinking at LLM-token rate, and without this batcher each token
 * caused a full store write + screen re-render. These tests prove a refactor of
 * the batching plumbing stays behavior-preserving.
 */
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { VibeCodingRun } from '../src/data/platformModels';

// The dispatcher path under test never touches the network; mock the transport
// so resetSessionData's disconnect() is a deterministic no-op with no sockets.
jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.useFakeTimers();

// Mirror of STREAM_FLUSH_MS in store/aiStreamBatching.ts. Kept local (not
// imported) because the constant is module-private; if the flush window changes
// there, update this too.
const STRUCTURED_FLUSH_MS = 100;

const run = (
  structuredEvents: VibeCodingRun['structuredEvents'] = [],
): VibeCodingRun => ({
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
  transcript: [],
  events: [],
  structuredEvents,
});

// A thinking event with a STABLE eventId (matches production: the server derives
// a deterministic eventId per thinking span, so every chars update upserts in
// place). chars grows to mimic the per-token stream.
const thinkingEvent = (chars: number, messageId = 'msg-A') =>
  ({
    type: 'ai.thinking' as const,
    sessionId: 's1',
    messageId,
    active: true,
    chars,
    eventId: 'se-think-msg-A',
    raw: {},
  });

// Dispatching any non-structured event flushes pending structured events at the
// very start of the handler — used both as a flush trigger and to drain leftover
// state in setup.
const dispatchStatus = () =>
  useControlCenterStore
    .getState()
    .handleTransportEvent({ type: 'transport.status', status: 'connected' });

const seed = (
  structuredEvents: VibeCodingRun['structuredEvents'] = [],
) =>
  useControlCenterStore.setState({
    vibeRuns: [run(structuredEvents)],
    events: [],
  });

const structuredEventsOf = () =>
  useControlCenterStore.getState().vibeRuns[0]?.structuredEvents ?? [];

// `.chars` only exists on the 'thinking' variant; narrow via the discriminant
// (after asserting kind) so the access type-checks.
const thinkingChars = (
  events: VibeCodingRun['structuredEvents'],
): number | undefined => {
  const first = events[0];
  return first && first.kind === 'thinking' ? first.chars : undefined;
};

beforeEach(() => {
  // Drain any pending structured events + let any pending flush timer fire
  // naturally so the module-level batching state starts clean for each test.
  dispatchStatus();
  jest.advanceTimersByTime(STRUCTURED_FLUSH_MS + 50);
  seed();
});

describe('structured activity batching', () => {
  it('coalesces ai.thinking tokens and flushes only after the flush window', () => {
    const store = useControlCenterStore.getState();
    store.handleTransportEvent(thinkingEvent(100));
    store.handleTransportEvent(thinkingEvent(200));
    store.handleTransportEvent(thinkingEvent(300));

    // Not applied yet — events are buffered, not written per-token.
    expect(structuredEventsOf()).toEqual([]);

    jest.advanceTimersByTime(STRUCTURED_FLUSH_MS);

    // All three tokens folded in a single flush; same eventId upserts in place,
    // so the last chars (300) wins.
    const events = structuredEventsOf();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('thinking');
    expect(thinkingChars(events)).toBe(300);
  });

  it('flushes pending events immediately when a non-structured event arrives', () => {
    useControlCenterStore.getState().handleTransportEvent(thinkingEvent(120));

    // A non-structured event drains the buffer before it is handled, so ordering
    // is preserved (the final thinking state is settled before, e.g., ai.done
    // finalizes the turn).
    dispatchStatus();

    const events = structuredEventsOf();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('thinking');
    expect(thinkingChars(events)).toBe(120);
  });

  it('cancels pending events on resetSessionData (no stale leak after reset)', () => {
    useControlCenterStore.getState().handleTransportEvent(thinkingEvent(999));

    // resetSessionData tears down batching state as part of session reset.
    useControlCenterStore.getState().resetSessionData();

    // Re-seed a fresh run and let the (canceled) flush window elapse.
    seed();
    jest.advanceTimersByTime(STRUCTURED_FLUSH_MS + 50);

    // The canceled event must NOT have been applied to the fresh run.
    expect(structuredEventsOf()).toEqual([]);
  });
});
