import type { PushNotificationItem } from '../store/types';

export type BackgroundNotificationType =
  | 'approval'
  | 'session_done'
  | 'session_failed'
  | 'device_offline';

export interface PendingLocalNotification {
  /** Server notification identity, used for delivery dedupe and read sync. */
  key: string;
  /** Stable Android identity. Related updates replace instead of stacking. */
  nativeId: string;
  title: string;
  body: string;
  createdAt: string;
  data: {
    type: BackgroundNotificationType;
    notificationId: string;
    sessionId?: string;
    approvalId?: string;
    deviceId?: string;
    userId?: string;
  };
}

export interface BackgroundNotifyInput {
  isBackground: boolean;
  notifications: PushNotificationItem[];
  /** Notifications present when the app entered the background are historical. */
  baselineNotificationIds: Set<string>;
  /** Notifications successfully delivered during this background window. */
  alreadyNotified: Set<string>;
  userId?: string;
}

export interface BackgroundNotifyResult {
  notifications: PendingLocalNotification[];
  notifiedKeys: Set<string>;
}

const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_.-]/g, '_');

export function nativeNotificationId(item: PushNotificationItem): string {
  if (item.type === 'approval' && item.approvalId) {
    return `vibe_approval_${safeId(item.approvalId)}`;
  }
  if ((item.type === 'completed' || item.type === 'error') && item.sessionId) {
    // A late authoritative completion replaces an earlier error instead of
    // leaving contradictory terminal-state notifications in the tray.
    return `vibe_session_${safeId(item.sessionId)}_terminal`;
  }
  if (item.type === 'device_offline' && item.deviceId) {
    return `vibe_device_${safeId(item.deviceId)}_offline`;
  }
  return `vibe_notification_${safeId(item.id)}`;
}

const notificationType = (
  type: PushNotificationItem['type'],
): BackgroundNotificationType => {
  if (type === 'completed') return 'session_done';
  if (type === 'error') return 'session_failed';
  return type;
};

/**
 * Select new unread server notifications for native delivery.
 *
 * Server notification IDs are the canonical dedupe boundary. This avoids the
 * previous double source of truth where approval events and run status changes
 * independently generated local notifications for the same backend action.
 */
export function decideBackgroundNotifications(
  input: BackgroundNotifyInput,
): BackgroundNotifyResult {
  const pending: PendingLocalNotification[] = [];
  const notified = new Set(input.alreadyNotified);
  if (!input.isBackground) {
    return { notifications: pending, notifiedKeys: notified };
  }

  const ordered = [...input.notifications].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  for (const item of ordered) {
    if (item.read || input.baselineNotificationIds.has(item.id)) continue;
    const key = `notification:${item.id}`;
    if (notified.has(key)) continue;
    pending.push({
      key,
      nativeId: nativeNotificationId(item),
      title: item.title,
      body: item.body,
      createdAt: item.createdAt,
      data: {
        type: notificationType(item.type),
        notificationId: item.id,
        sessionId: item.sessionId,
        approvalId: item.approvalId,
        deviceId: item.deviceId,
        userId: input.userId,
      },
    });
    notified.add(key);
  }

  return { notifications: pending, notifiedKeys: notified };
}
