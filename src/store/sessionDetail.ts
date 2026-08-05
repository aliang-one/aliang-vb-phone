/**
 * Session-detail loading domain.
 *
 * Single session detail loading ("open a conversation, show its transcript")
 * used to be scattered: the escalation policy lived in internals, the
 * "is this result loaded or transient" decision was inlined in
 * `loadAgentSessionDetail`, and the stored representation was a single
 * `detailLoadedAt` timestamp whose truthiness simultaneously meant "memory
 * resident", "successfully loaded", and "has content to show". That conflation
 * is what made "open a conversation → blank until refresh" recur: a fresh-but-
 * empty agent response stamped the timestamp, every read site inferred "loaded",
 * and all retry paths gated off.
 *
 * This module is the canonical home for the two pure policies that decide what
 * a detail fetch means:
 *   - {@link shouldEscalateEmptyDetailToRefresh} — cache-first fetch came back
 *     empty for a session known to have history → escalate to ONE forced fetch.
 *   - {@link resolveDetailState} — given a fetch's outcome, which typed
 *     {@link DetailState} applies. The result is stored on the run as the
 *     canonical representation; readers ask {@link isAuthoritativeDetail}
 *     instead of guessing from a timestamp.
 *
 * Pure / deterministic so the load path can be reasoned about and tested
 * without transport or store plumbing. See `sessionDetail.test.ts`.
 */
import type { DetailState } from '../data/platformModels';

export interface EmptyDetailEscalationInput {
  /** Length of the just-fetched (cache-first) transcript. */
  transcriptLength: number;
  /** Server-known total message count for the session (resident metadata). */
  transcriptCount: number;
  /** Server `detail_refresh.status` carried on the fetched run. */
  detailRefreshStatus: string | undefined;
  /** Session purpose; `'goal'` sessions are server-owned history. */
  purpose: 'chat' | 'goal' | undefined;
  /** True when the caller already passed `refresh: true` (manual / pull-to-refresh). */
  isManualRefresh: boolean;
}

/**
 * Decide whether a cache-first single-session detail fetch that came back empty
 * should escalate to ONE forced (`refresh: true`) agent fetch.
 *
 * The strong recovery signal is the page disagreeing with resident metadata:
 * `transcriptCount > 0` (the server reports known history) but the page came
 * back empty. Escalate exactly once in that case; the caller bounds it to at
 * most one `refresh: true` per `loadAgentSessionDetail` invocation.
 *
 * No escalation when any of: `isManualRefresh` (already forcing); `purpose ===
 * 'goal'` or status `server_owned` (server ledger owns history); `failed` /
 * `skipped_offline` (already retryable via the recoverable-conversation path);
 * non-empty result; or no known history (`transcriptCount === 0`).
 */
export function shouldEscalateEmptyDetailToRefresh(
  input: EmptyDetailEscalationInput,
): boolean {
  if (input.isManualRefresh) return false;
  if (input.purpose === 'goal') return false;
  if (input.detailRefreshStatus === 'server_owned') return false;
  if (input.detailRefreshStatus === 'failed') return false;
  if (input.detailRefreshStatus === 'skipped_offline') return false;
  if (input.transcriptLength > 0) return false;
  return input.transcriptCount > 0;
}

export interface DetailStateInput {
  transcriptLength: number;
  transcriptCount: number;
  detailRefreshStatus: string | undefined;
}

/**
 * Resolve the typed {@link DetailState} for a session from a fetch outcome.
 *
 * Resolution precedence:
 *   1. `ready` — transcript content delivered (always wins; we have something
 *      to show regardless of refresh status).
 *   2. `offline` — agent offline (`skipped_offline`); history unreachable.
 *   3. `failed` — agent request errored.
 *   4. `recoverable_empty` — empty page but the server reports known history
 *      (`transcriptCount > 0`); a cache/agent miss, retryable.
 *   5. `empty` — empty page and no known history; a genuinely empty session.
 *
 * The caller stores this on the run as `detailState`.
 */
export function resolveDetailState(input: DetailStateInput): DetailState {
  if (input.transcriptLength > 0) return { kind: 'ready' };
  if (input.detailRefreshStatus === 'skipped_offline') return { kind: 'offline' };
  if (input.detailRefreshStatus === 'failed') return { kind: 'failed' };
  if (input.transcriptCount > 0) return { kind: 'recoverable_empty' };
  return { kind: 'empty' };
}

/**
 * Whether a detail state is "authoritative" — content was delivered OR the
 * fetch definitively resolved to genuine-empty. Authoritative states count as
 * detail-loaded (eviction residency, the chat screen's `hasDetail`); the
 * retryable states (`recoverable_empty` / `offline` / `failed`) do not, so the
 * screen keeps re-attempting instead of freezing on a blank conversation.
 *
 * This is the single predicate that replaced every legacy `Boolean(detailLoadedAt)`
 * read site — the retirement of the timestamp-as-business-state inference.
 */
export function isAuthoritativeDetail(
  state: DetailState | undefined,
): boolean {
  return state?.kind === 'ready' || state?.kind === 'empty';
}

/**
 * Merge policy for `detailState` across a snapshot/run merge. Reproduces the
 * legacy `incoming.detailLoadedAt ?? existing.detailLoadedAt` semantics: an
 * authoritative incoming (ready/empty — a real detail fetch that resolved)
 * overwrites; a non-authoritative incoming (recoverable_empty/offline/failed,
 * or a list snapshot with `undefined`) preserves the existing state. A
 * transient-empty fetch therefore never clobbers content already held.
 */
export function mergeDetailState(
  incoming: DetailState | undefined,
  existing: DetailState | undefined,
): DetailState | undefined {
  return isAuthoritativeDetail(incoming) ? incoming : existing;
}
