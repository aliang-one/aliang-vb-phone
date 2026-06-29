/**
 * Singleton batching state for structured AI activity events
 * (`ai.command`/`ai.file_change`/`ai.thinking`/`ai.usage`/`ai.task`).
 *
 * Mirrors {@link ./streaming} (the `ai.delta` batcher). The agent emits these —
 * especially `ai.thinking` — at LLM-token granularity: Claude streams a
 * `thinking_delta` per token and the server relays each one 1:1 (no batching on
 * either hop), so a thinking phase pushes dozens of `ai.thinking` events per
 * second. Applying each synchronously to the store caused one full-screen
 * re-render per token (each carrying O(transcript) derivation) and saturated the
 * JS thread → laggy UI and frozen navigation during thinking. This coalesces a
 * burst into a single store write per flush window so subscribers re-render
 * ~10×/sec instead of per-token.
 *
 * Kept free of any zustand coupling: the store registers the applier via
 * {@link registerStructuredApplier}; {@link flushStructuredEvents} then hands
 * drained events back to that callback, which folds them — in arrival order,
 * via `applyStructuredEvent` (upsert by eventId) — into ONE new run per session.
 * Semantics mirror `flushDeltas`: a no-op when nothing is buffered, and it does
 * NOT touch the flush timer (the timer self-clears when it fires;
 * {@link cancelStructuredBatch} handles explicit teardown).
 */
import type { PlatformTransportEvent } from '../services/platformTransport';

/** The 5 structured-activity transport types funneled through this batcher. */
export const STRUCTURED_TRANSPORT_TYPES = new Set([
  'ai.command',
  'ai.file_change',
  'ai.thinking',
  'ai.usage',
  'ai.task',
]);

/** A structured event: one of the 5 activity variants (all carry sessionId + eventId). */
export type StructuredTransportEvent = Extract<
  PlatformTransportEvent,
  { type: 'ai.command' | 'ai.file_change' | 'ai.thinking' | 'ai.usage' | 'ai.task' }
>;

/** Type guard so the dispatcher can gate the flush on "is this a structured event?". */
export const isStructuredTransportEvent = (
  ev: PlatformTransportEvent,
): ev is StructuredTransportEvent => STRUCTURED_TRANSPORT_TYPES.has(ev.type);

// Coalesce window for structured activity events. 100ms balances liveness of the
// "🧠 思考中…(chars)" headline (~10 updates/sec) against the derivation +
// re-render each flush triggers — paired with the incremental
// `activityEventsByDisplayMessageId` (O(M)) so each flush is cheap. Same cadence
// as `ai.delta` (DELTA_FLUSH_MS) for uniform JS-thread pressure across both
// streaming paths.
const STRUCTURED_FLUSH_MS = 100;

let pendingStructured: StructuredTransportEvent[] = [];
let structuredFlushTimer: ReturnType<typeof setTimeout> | null = null;

let applyStructured:
  | ((events: StructuredTransportEvent[]) => void)
  | null = null;

/** Registered by the store at creation; invoked with drained events on each flush. */
export function registerStructuredApplier(
  fn: (events: StructuredTransportEvent[]) => void,
): void {
  applyStructured = fn;
}

/** Drop buffered events + cancel the pending flush timer (reset / disconnect). */
export function cancelStructuredBatch(): void {
  pendingStructured = [];
  if (structuredFlushTimer) {
    clearTimeout(structuredFlushTimer);
    structuredFlushTimer = null;
  }
}

/** Apply buffered structured events now (no-op when nothing is buffered). */
export function flushStructuredEvents(): void {
  if (!pendingStructured.length || !applyStructured) return;
  const events = pendingStructured;
  pendingStructured = [];
  applyStructured(events);
}

/** Buffer a structured event and ensure at most one flush is scheduled per window. */
export function pushStructuredEvent(ev: StructuredTransportEvent): void {
  pendingStructured.push(ev);
  if (!structuredFlushTimer) {
    structuredFlushTimer = setTimeout(() => {
      structuredFlushTimer = null;
      flushStructuredEvents();
    }, STRUCTURED_FLUSH_MS);
  }
}
