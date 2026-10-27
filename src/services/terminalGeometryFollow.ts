// 自发 resize 时间窗(设计 §1 防抖):publishToMobiles 无排除参数,手机发出的
// resize 会以 geometry_changed 回显给自己——毫秒级到达,用 2.5s 窗口滤掉。
const LOCAL_RESIZE_WINDOW_MS = 2500;
const lastLocalResizeAt = new Map<string, number>();

export function markLocalTerminalResize(sessionId: string): void {
  lastLocalResizeAt.set(sessionId, Date.now());
}

export function isLocalTerminalResizeRecent(sessionId: string): boolean {
  const at = lastLocalResizeAt.get(sessionId);
  return at !== undefined && Date.now() - at < LOCAL_RESIZE_WINDOW_MS;
}

// 显式夺回标记(2026-10-27 浏览器优先):跟随徽章 tap = 用户明确要求把
// PTY 网格拿回本机。桥侧 unfollow 会触发一次自发 fit → resize 上报,该
// resize 消费此标记并升级为 takeover:true——服务端「网页授权在线时把手机
// 自动 resize 降级回网页几何」的分支对显式夺回放行。一次性且与自发窗口
// 同寿命:误标/过期的残留最多让 2.5s 内的下一次普通 resize 也带
// takeover(此刻用户刚点过接管,语义上仍属同一次意图),不会长期毒化。
const takeoverAt = new Map<string, number>();

export function markTerminalGeometryTakeover(sessionId: string): void {
  takeoverAt.set(sessionId, Date.now());
}

/** 读取并清除一次性夺回标记:每次 tap 只放行紧随其后的那一次 resize。 */
export function consumeTerminalGeometryTakeover(sessionId: string): boolean {
  const at = takeoverAt.get(sessionId);
  takeoverAt.delete(sessionId);
  return at !== undefined && Date.now() - at < LOCAL_RESIZE_WINDOW_MS;
}

// 会话关闭时由 dispatcher 调用:窗口条目随会话失效(有界 Map 纪律,与
// terminalOutputRegistry 的 dispose 同类),不让关闭过的 sessionId 永久滞留。
export function forgetTerminalGeometryFollow(sessionId: string): void {
  lastLocalResizeAt.delete(sessionId);
  takeoverAt.delete(sessionId);
}

export function resetTerminalGeometryFollowForTests(): void {
  lastLocalResizeAt.clear();
  takeoverAt.clear();
}
