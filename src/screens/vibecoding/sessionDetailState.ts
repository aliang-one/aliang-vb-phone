/**
 * Pure detail-load DECISION functions for VibeCodingSessionScreen.
 *
 * Extracted from inline screen computations as the first characterization step
 * (item 4 / #5 decomposition design): these are the gates that drive the
 * detail-load orchestration (mount auto-load, recoverable self-heal, empty
 * state). Pinning them here as pure functions gives the hook extraction a
 * tested foundation — the upcoming useSessionDetailLoader will call these
 * instead of the screen re-deriving them inline.
 */
import { isAuthoritativeDetail } from '../../store/sessionDetail';
import type { DetailState } from '../../data/platformModels';

/**
 * Whether the screen should treat the session as holding detail (skip the
 * mount auto-load). True when an authoritative detail state resolved (ready has
 * content; empty is a definitive empty conversation) OR a hot window delivered
 * messages. Recoverable/offline/failed states stay false so the auto-load keeps
 * re-attempting instead of freezing on a blank conversation.
 */
export function computeHasDetail(
  detailState: DetailState | undefined,
  transcriptLength: number,
): boolean {
  return isAuthoritativeDetail(detailState) || transcriptLength > 0;
}

/**
 * Whether the last detail fetch is permanently unavailable for this connection
 * state (agent errored or was offline). Drives the "agent offline, pull to
 * retry" empty state and short-circuits the mount auto-load.
 *
 * Reads `detailState.kind` (the canonical state), NOT the raw
 * `detailRefreshStatus` — the two can diverge on snapshots, and detailState is
 * re-resolved in mergeVibeRunSnapshot to track the snapshot's status. The raw
 * status stays as diagnostic only.
 */
export function isDetailFetchUnavailable(
  detailState: DetailState | undefined,
): boolean {
  return detailState?.kind === 'failed' || detailState?.kind === 'offline';
}

/**
 * Whether the conversation is "blank but recoverable": connected + device
 * online, yet the transcript is empty and the detail state is offline/failed.
 * The screen edge-triggers ONE forced refresh when this becomes true (the agent
 * came back online / WS reconnected while a blank session is on screen).
 */
export function isRecoverableConversation(input: {
  wsConnected: boolean;
  deviceStatus: string | undefined;
  transcriptLength: number;
  detailState: DetailState | undefined;
}): boolean {
  return (
    input.wsConnected &&
    input.deviceStatus !== 'offline' &&
    input.transcriptLength === 0 &&
    (input.detailState?.kind === 'offline' ||
      input.detailState?.kind === 'failed')
  );
}
