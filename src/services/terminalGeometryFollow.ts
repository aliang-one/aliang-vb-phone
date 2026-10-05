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

// 会话关闭时由 dispatcher 调用:窗口条目随会话失效(有界 Map 纪律,与
// terminalOutputRegistry 的 dispose 同类),不让关闭过的 sessionId 永久滞留。
export function forgetTerminalGeometryFollow(sessionId: string): void {
  lastLocalResizeAt.delete(sessionId);
}

export function resetTerminalGeometryFollowForTests(): void {
  lastLocalResizeAt.clear();
}
