/**
 * resolvePullToRefreshAction — 下拉刷新派发决策。
 *
 * 2026-10-18 全链审计钉死的两处回归(S1/S2):
 * 1) 空会话(本地无服务端确认消息可作 before 锚点)即使服务端报
 *    hasServerEarlierMessages,loadEarlier 也会在 store 层因无锚点静默
 *    no-op——派发层必须改走强制 refreshLatest(S2"反复刷新无效");
 * 2) 有内容且已到最早的会话,下拉原来是"已是最早消息"提示 no-op——
 *    TUI 内容是纯拉模式,该分支必须降级为 refreshLatest 强拉最新,
 *    否则手机永远拿不到 server 页缓存之外的新正文(S1)。
 */
import { resolvePullToRefreshAction } from '../sessionRefreshDispatch';

describe('resolvePullToRefreshAction', () => {
  it('有更早历史且有服务端确认锚点时保留加载更早路径', () => {
    expect(
      resolvePullToRefreshAction({
        hasEarlierToLoad: true,
        hasServerConfirmedAnchor: true,
      }),
    ).toBe('load-earlier');
  });

  it('有更早历史但本地无服务端确认锚点(空会话/仅私有气泡)时强制刷新最新', () => {
    expect(
      resolvePullToRefreshAction({
        hasEarlierToLoad: true,
        hasServerConfirmedAnchor: false,
      }),
    ).toBe('refresh-latest');
  });

  it('有锚点但无更早历史(已到最早)时强制刷新最新而非提示', () => {
    expect(
      resolvePullToRefreshAction({
        hasEarlierToLoad: false,
        hasServerConfirmedAnchor: true,
      }),
    ).toBe('refresh-latest');
  });

  it('既无更早历史也无锚点时强制刷新最新', () => {
    expect(
      resolvePullToRefreshAction({
        hasEarlierToLoad: false,
        hasServerConfirmedAnchor: false,
      }),
    ).toBe('refresh-latest');
  });
});
