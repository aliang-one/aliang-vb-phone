export interface NotificationTapData {
  type?: string;
  notificationId?: string;
  nativeId?: string;
  sessionId?: string;
  approvalId?: string;
  deviceId?: string;
  userId?: string;
}

export type NotificationTapTarget =
  | {
      route: 'VibeCodingSession';
      params: { sessionId: string; approvalId?: string };
    }
  | { route: 'DeviceDetail'; params: { deviceId: string } }
  | { route: 'NotificationCenter'; params: undefined };

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

export function resolveNotificationTapTarget(
  data: NotificationTapData | null | undefined,
): NotificationTapTarget | null {
  if (!data) return null;
  if (data.type === 'summary') {
    return { route: 'NotificationCenter', params: undefined };
  }
  const deviceId = stringValue(data.deviceId);
  if (data.type === 'device_offline' && deviceId) {
    return { route: 'DeviceDetail', params: { deviceId } };
  }
  const sessionId = stringValue(data.sessionId);
  if (!sessionId) return null;
  const approvalId =
    data.type === 'approval' ? stringValue(data.approvalId) : undefined;
  return {
    route: 'VibeCodingSession',
    params: { sessionId, approvalId },
  };
}
