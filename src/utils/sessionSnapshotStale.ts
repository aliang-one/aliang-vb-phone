/**
 * Decide whether the local snapshot of a session is stale enough to warrant a
 * silent "refresh latest" when the chat screen re-focuses it.
 *
 * Background: the chat screen loads a session's detail once (gated by
 * `hasDetail`) and otherwise relies on the live `ai.delta` stream to keep it
 * fresh. Two holes make that insufficient for a session that was already
 * running on another client when entered:
 *   1. Idle demotion clears `events`/`structuredEvents` while the user is away,
 *      which also hides the bottom badge that hosts the only manual "refresh
 *      latest" affordance — see VibeCodingSessionScreen.
 *   2. Any WS gap (backgrounded app, transient disconnect) misses events with no
 *      replay; only a reconnect triggers a global resync.
 *
 * This predicate is the trigger for an automatic, silent recovery refresh on
 * focus. It says "stale" when EITHER:
 *   - the user has been away from this session >= `awayThresholdMs` (demotion
 *     may have run / events may have been missed), OR
 *   - the session claims to be `running` but the local `lastActivityMs` is older
 *     than `liveWindowMs` (the live stream isn't reaching us — entered mid-run,
 *     or a quiet gap with no deltas).
 *
 * A genuinely idle session that was just viewed is NOT stale (don't thrash the
 * agent with refreshes on every re-focus of a settled conversation).
 *
 * Pure / deterministic: takes `now` as an input so it is fully unit-testable.
 */
export interface SessionSnapshotStaleInput {
  now: number;
  status: string | undefined;
  lastActivityMs: number | undefined;
  /** Last time the chat screen focused this session (client-only). */
  lastViewedAt: number | undefined;
  /** Away duration after which we assume we may have missed something. */
  awayThresholdMs: number;
  /** The live-activity window (deltas should arrive at least this often). */
  liveWindowMs: number;
}

export function isSessionSnapshotStale(input: SessionSnapshotStaleInput): boolean {
  const { now, status, lastActivityMs, lastViewedAt, awayThresholdMs, liveWindowMs } =
    input;
  if (lastViewedAt !== undefined && now - lastViewedAt >= awayThresholdMs) {
    return true;
  }
  if (
    status === 'running' &&
    lastActivityMs !== undefined &&
    now - lastActivityMs > liveWindowMs
  ) {
    return true;
  }
  return false;
}
