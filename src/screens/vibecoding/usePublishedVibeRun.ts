/**
 * usePublishedVibeRun — 聊天屏对"被查看会话"的订阅,带发布节流。
 *
 * 为什么需要:流式期间每个 100ms batch(aiStreamBatching)都给被查看会话
 * 一个新的 run 对象身份,而 useVibeRun 用 Object.is 比较选中对象 —— 屏幕
 * 组件体(3700 行)因此以 ≤10Hz 全量重跑。transcript 派生链路早已通过
 * useThrottledValue(LIVE_TRANSCRIPT_RENDER_MS=200,见 useConversationTranscript)
 * 收敛到 ≤5Hz,屏幕体却没有。这里把"发布"也收敛到同一节拍:
 *
 * - 会话活跃(queued/running/cancelling,见 isAuthoritativeRunLive)时,
 *   新 run 身份至多每 LIVE_SESSION_PUBLISH_MS 发布一次 → 屏幕体重跑 ≤5Hz;
 * - 会话非活跃(settle 完成/失败/waiting_approval)时,0ms 门 → 状态翻面
 *   立即可见,不拖尾;
 * - 会话从活跃翻到非活跃的那次更新本身立即发布(门随值翻转,无需等窗口)。
 *
 * 语义与 useConversationTranscript 的 transcript 节流一致:发布的是最新值
 * (latestRef),只是合流频率;settled 后无任何额外延迟。
 */
import type { VibeCodingRun } from '../../data/platformModels';
import { useVibeRun } from '../../store/controlCenterStore';
import { useThrottledValue } from '../../hooks/useThrottledValue';
import { isAuthoritativeRunLive } from '../../utils/sessionPhase';

export const LIVE_SESSION_PUBLISH_MS = 200;

export function usePublishedVibeRun(
  sessionId: string | undefined,
): VibeCodingRun | undefined {
  const rawRun = useVibeRun(sessionId);
  const publishMs =
    rawRun &&
    isAuthoritativeRunLive(
      rawRun.runStateVersion,
      rawRun.runState,
      rawRun.status,
    )
      ? LIVE_SESSION_PUBLISH_MS
      : 0;
  return useThrottledValue(rawRun, publishMs);
}
