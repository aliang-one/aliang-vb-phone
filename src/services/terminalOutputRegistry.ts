/**
 * Terminal output registry — the single owner of the terminal output routing
 * table and its pending-output buffer.
 *
 * Why this exists as a service, not inside the `TerminalEmulator` component:
 * the store (WebSocket terminal.output handler) must route incoming output to
 * whichever emulator instance is mounted for a session, and buffer it when no
 * emulator is mounted yet. Putting that registry inside the UI component file
 * inverted the dependency (store → component). This module is a domain service
 * that BOTH the store and the component depend on; neither owns the other's
 * concern.
 *
 * Single-writer discipline: the two Maps below are module-private. Mutating
 * them is only possible through the intent-revealing functions exported here
 * (`register` / `unregister` / `route` / `drain` / `clear`). Callers must never
 * reach into a raw Map — that was the old `terminalOutputHandlers.delete(...)`
 * pattern which scattered ownership across the store and the component.
 */

export interface TerminalOutputChunk {
  data: string;
  encoding: string;
}

/** A mounted emulator's per-session output sink. */
export type TerminalOutputHandler = (
  data: string,
  encoding?: string,
) => void;

/** Max chunks buffered per session while no emulator is mounted. */
const MAX_PENDING_OUTPUT = 200;

/** sessionId → mounted emulator output handler. Empty when no screen is mounted. */
const handlers = new Map<string, TerminalOutputHandler>();

/** sessionId → output chunks received before any handler registered. */
const pending = new Map<string, TerminalOutputChunk[]>();

/**
 * Route a terminal output chunk to the mounted emulator for `sessionId`. If no
 * emulator is mounted yet, buffer the chunk (capped to `MAX_PENDING_OUTPUT`)
 * so it can be drained once one mounts. Returns true if delivered immediately,
 * false if buffered.
 */
export const routeTerminalOutputToEmulator = (
  sessionId: string,
  data: string,
  encoding = 'text',
): boolean => {
  const handler = handlers.get(sessionId);
  if (handler) {
    handler(data, encoding);
    return true;
  }
  const queued = pending.get(sessionId) ?? [];
  pending.set(sessionId, [
    ...queued.slice(-(MAX_PENDING_OUTPUT - 1)),
    { data, encoding },
  ]);
  return false;
};

/**
 * Register the mounted emulator's output handler for `sessionId` and return any
 * output that arrived before it mounted (so the emulator can replay it). Only
 * one handler per session is expected; re-registering replaces the previous one.
 */
export const registerTerminalOutputHandler = (
  sessionId: string,
  handler: TerminalOutputHandler,
): TerminalOutputChunk[] => {
  handlers.set(sessionId, handler);
  return drainPendingTerminalOutput(sessionId);
};

/** Remove a session's mounted handler (call on emulator unmount). */
export const unregisterTerminalOutputHandler = (sessionId: string): void => {
  handlers.delete(sessionId);
};

/** Return and clear the buffered pending output for a session. */
export const drainPendingTerminalOutput = (
  sessionId: string,
): TerminalOutputChunk[] => {
  const queued = pending.get(sessionId) ?? [];
  pending.delete(sessionId);
  return queued;
};

/** Drop any buffered pending output for a session (e.g. when the session ends). */
export const clearPendingTerminalOutput = (sessionId: string): void => {
  pending.delete(sessionId);
};

/**
 * Teardown helper for store-side session end: remove the handler AND drop the
 * pending buffer together so a remount starts clean. Callers used to do two raw
 * Map deletes inline; this is the single entry point for "this session is gone".
 */
export const disposeTerminalOutput = (sessionId: string): void => {
  handlers.delete(sessionId);
  pending.delete(sessionId);
};
