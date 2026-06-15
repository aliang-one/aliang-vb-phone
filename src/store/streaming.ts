/**
 * Singleton batching + debounce state for realtime streaming updates.
 *
 * Owns the mutable buffers/timers so both the realtime slice (cancel on session
 * reset / disconnect) and the transport dispatcher (push on `ai.delta`, flush
 * before a different event) share ONE source of truth across module boundaries.
 * ES-module live bindings are read-only to importers, so this state must live in
 * a single owner module rather than being imported-and-reassigned.
 *
 * To keep this module free of any zustand coupling, the store registers the
 * delta applier via `registerDeltaApplier`; `flushDeltas` then hands drained
 * deltas back to that callback. Semantics mirror the original inline logic:
 * `flushDeltas` is a no-op when nothing is buffered and does NOT touch the flush
 * timer (the timer self-clears when it fires; `cancelDeltaBatch` handles
 * explicit teardown).
 */
import type { DeltaUpdate } from '../utils/deltaBatch';

const DELTA_FLUSH_MS = 60;
const REFRESH_DEBOUNCE_MS = 250;

let pendingDeltas: DeltaUpdate[] = [];
let deltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

let applyDeltas: ((deltas: DeltaUpdate[]) => void) | null = null;

/** Registered by the store at creation; invoked with drained deltas on each flush. */
export function registerDeltaApplier(fn: (deltas: DeltaUpdate[]) => void): void {
  applyDeltas = fn;
}

/** Drop buffered tokens + cancel the pending flush timer (reset / disconnect). */
export function cancelDeltaBatch(): void {
  pendingDeltas = [];
  if (deltaFlushTimer) {
    clearTimeout(deltaFlushTimer);
    deltaFlushTimer = null;
  }
}

export function cancelRefreshDebounce(): void {
  if (refreshDebounceTimer) {
    clearTimeout(refreshDebounceTimer);
    refreshDebounceTimer = null;
  }
}

/** Coalesce a burst of `*.updated` realtime messages into a single snapshot reload. */
export function scheduleRefreshDebounce(run: () => void): void {
  if (refreshDebounceTimer) {
    clearTimeout(refreshDebounceTimer);
  }
  refreshDebounceTimer = setTimeout(() => {
    refreshDebounceTimer = null;
    run();
  }, REFRESH_DEBOUNCE_MS);
}

/** Apply buffered streaming tokens now (no-op when nothing is buffered). */
export function flushDeltas(): void {
  if (!pendingDeltas.length || !applyDeltas) return;
  const deltas = pendingDeltas;
  pendingDeltas = [];
  applyDeltas(deltas);
}

/** Buffer a streaming token and ensure at most one flush is scheduled per window. */
export function pushDelta(delta: DeltaUpdate): void {
  pendingDeltas.push(delta);
  if (!deltaFlushTimer) {
    deltaFlushTimer = setTimeout(() => {
      deltaFlushTimer = null;
      flushDeltas();
    }, DELTA_FLUSH_MS);
  }
}
