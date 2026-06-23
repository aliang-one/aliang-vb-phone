/**
 * Singleton batching state for `terminal.output` transport events.
 *
 * Mirror of ./streaming (which batches `ai.delta`): stdout from a background
 * terminal (one whose screen isn't mounted, so `routeTerminalOutputToEmulator`
 * didn't consume it) can arrive many times per second. Each unbatched chunk
 * rewrote the whole `terminalSessions` array, re-rendering every subscriber on
 * every chunk. We coalesce a burst into a single flush that does ONE store
 * write per window, applying all buffered payloads in arrival order.
 *
 * Like ./streaming, this module owns the mutable buffers/timers so both the
 * store (flush via the registered applier) and the realtime slice (cancel on
 * reset / disconnect) share one source of truth. The store registers the
 * applier via `registerTerminalOutputApplier`; `flushTerminalOutput` hands
 * drained items back to that callback. `flushTerminalOutput` is a no-op when
 * nothing is buffered and does NOT touch the flush timer.
 */

const TERMINAL_FLUSH_MS = 60;

export interface TerminalOutputBatchItem {
  sessionId: string;
  data: string;
  encoding: string;
}

let pendingItems: TerminalOutputBatchItem[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

let applyBatch: ((items: TerminalOutputBatchItem[]) => void) | null = null;

/** Registered by the store at creation; invoked with drained items on each flush. */
export function registerTerminalOutputApplier(
  fn: (items: TerminalOutputBatchItem[]) => void,
): void {
  applyBatch = fn;
}

/** Drop buffered chunks + cancel the pending flush timer (reset / disconnect). */
export function cancelTerminalBatch(): void {
  pendingItems = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/** Apply buffered terminal chunks now (no-op when nothing is buffered). */
export function flushTerminalOutput(): void {
  if (!pendingItems.length || !applyBatch) return;
  const items = pendingItems;
  pendingItems = [];
  applyBatch(items);
}

/** Buffer a terminal.output chunk and ensure at most one flush per window. */
export function pushTerminalOutput(item: TerminalOutputBatchItem): void {
  pendingItems.push(item);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushTerminalOutput();
    }, TERMINAL_FLUSH_MS);
  }
}
