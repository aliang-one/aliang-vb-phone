/**
 * 重扫轮询判定(纯函数,便于对「重扫电脑」的到达语义钉测试)。
 *
 * 「重扫电脑」触发后,手机轮询 /api/projects/:id/ai-sessions:total_count
 * 增大、出现新 session id、或最新 last_active_at 变新,任一成立即算"到达"
 * (停表)。线字段名必须是 publicAiSessionSummary 下发的 last_active_at
 * ——updated_at 在本仓库特指 agent 文件时钟,server 有意不下发
 * (2026-10-15 时钟污染修复),勿混用。server 侧 upsert 有时钟守卫,
 * 无变化的重复 hello 不会推进 last_active_at,所以超时诚实地等于"没变化"。
 * 线字段是 server 出品的 UTC Zulu ISO 8601(ms 精度);比较为字典序,
 * 消费方(如 useSessionRescan 的 reduce 取 max)必须保持同一比较语义。
 * polledIds 必须是全量列表(与 total_count 同口径),不得传分页窗口切片。
 */
export type RescanTickAction = 'stop-changed' | 'keep-polling' | 'stop-timeout';

export function resolveRescanTick(input: {
  polledCount: number;
  polledIds: string[];
  polledLatestLastActiveAt: string | undefined;
  baselineCount: number;
  baselineIds: string[];
  baselineLatestLastActiveAt: string | undefined;
  isFinalTick: boolean;
}): RescanTickAction {
  if (
    input.polledCount > input.baselineCount ||
    input.polledIds.some(id => !input.baselineIds.includes(id)) ||
    (input.polledLatestLastActiveAt !== undefined &&
      input.baselineLatestLastActiveAt !== undefined &&
      input.polledLatestLastActiveAt > input.baselineLatestLastActiveAt)
  ) {
    return 'stop-changed';
  }
  return input.isFinalTick ? 'stop-timeout' : 'keep-polling';
}
