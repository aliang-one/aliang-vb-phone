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
 * mount auto-load).
 *
 * 2026-10-28 实锤:此前的 `isAuthoritativeDetail(detailState) || transcriptLength > 0`
 * 让「快照热窗 transcript 非空」本身就算已加载——而快照喂的是服务端被截断、
 * 且混入空 assistant 锚点的 transcript 列,不是权威 ai_messages 页。一次实时
 * 运行结束后打开会话,挂载自动加载被短路,权威页永不被拉,用户看到的是
 * 「从半截开始」的对话。所以 hasDetail 现在必须以**一次真实的详情页加载**
 * (`detailFromPage`,任何结果——ready/empty/failed 都算对过账)为前提;
 * 快照自身不再构成「已加载」。
 */
export function computeHasDetail(
  detailState: DetailState | undefined,
  transcriptLength: number,
  detailFromPage: boolean | undefined,
): boolean {
  return (
    detailFromPage === true &&
    (isAuthoritativeDetail(detailState) || transcriptLength > 0)
  );
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
