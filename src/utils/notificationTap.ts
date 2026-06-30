/**
 * 通知点击 → 跳转目标的**纯解析**(无副作用,易测)。
 * 由 App.tsx 的 tap 接线调用:拿到 notify-kit 的 notification.data,解析成
 * React Navigation 的 route + params,再 navigationRef.navigate。
 */

export interface NotificationTapData {
  type?: string;
  sessionId?: string;
  approvalId?: string;
}

export interface NotificationTapTarget {
  route: 'VibeCodingSession';
  params: { sessionId?: string; approvalId?: string };
}

/**
 * 把通知 data 解析成跳转目标。
 * 无 sessionId → null(无处可跳,调用方忽略)。
 * approval 类型才带 approvalId(会话内的审批卡靠它定位)。
 */
export function resolveNotificationTapTarget(
  data: NotificationTapData | null | undefined,
): NotificationTapTarget | null {
  if (!data) return null;
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
  if (!sessionId) return null;
  const approvalId =
    data.type === 'approval' && typeof data.approvalId === 'string'
      ? data.approvalId
      : undefined;
  return { route: 'VibeCodingSession', params: { sessionId, approvalId } };
}
