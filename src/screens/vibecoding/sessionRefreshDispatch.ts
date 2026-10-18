/**
 * 下拉刷新派发决策(纯函数,便于对 2026-10-18 审计的 S1/S2 回归钉测试)。
 *
 * 旧逻辑(VibeCodingSessionScreen.handleRefresh 内联):`hasMore ||
 * hasServerEarlierMessages` 即走加载更早;有内容且无更早时只提示
 * "已是最早消息";空会话虽落到 refreshLatest,但空会话的
 * hasServerEarlierMessages 几乎恒为 true(服务端 transcript_count > 本地 0),
 * 实际仍被抢进加载更早分支,再在 store 层因无 before 锚点静默 no-op。
 */
export type PullToRefreshAction = 'load-earlier' | 'refresh-latest';

export function resolvePullToRefreshAction(input: {
  hasEarlierToLoad: boolean;
  hasServerConfirmedAnchor: boolean;
}): PullToRefreshAction {
  // 只有"确实有更早可下"且"本地存在服务端确认消息可作 before 锚点"才走
  // 加载更早——store 层 loadEarlierAgentMessages 对无锚点会话静默 no-op,
  // 派发层放行等于把下拉变成无效手势。其余一律强制 refreshLatest:TUI
  // 内容是纯拉模式,server 页缓存之外的新正文只有 refresh=true 的详情
  // 拉取才能带回。
  if (input.hasEarlierToLoad && input.hasServerConfirmedAnchor) {
    return 'load-earlier';
  }
  return 'refresh-latest';
}
