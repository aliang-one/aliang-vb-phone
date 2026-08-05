export interface NotificationDeliveryState {
  recentAlertTimes: number[];
  suppressedCount: number;
}

export interface NotificationDeliveryDecision {
  kind: 'individual' | 'summary';
  state: NotificationDeliveryState;
}

export function decideNotificationDelivery(
  current: NotificationDeliveryState,
  now: number,
  windowMs = 60_000,
  maxAlertsPerWindow = 5,
): NotificationDeliveryDecision {
  const recentAlertTimes = current.recentAlertTimes.filter(
    timestamp => now - timestamp < windowMs,
  );
  if (recentAlertTimes.length >= maxAlertsPerWindow) {
    return {
      kind: 'summary',
      state: {
        recentAlertTimes,
        suppressedCount: current.suppressedCount + 1,
      },
    };
  }
  return {
    kind: 'individual',
    state: {
      recentAlertTimes: [...recentAlertTimes, now],
      suppressedCount:
        recentAlertTimes.length === 0 ? 0 : current.suppressedCount,
    },
  };
}

/**
 * The event categories a user can switch on/off individually. Keys match the
 * `data.type` (BackgroundNotificationType) carried by each pending notification
 * so the background hook can filter without any mapping.
 */
export type NotifiableEventType =
  | 'approval'
  | 'session_done'
  | 'session_failed'
  | 'device_offline';

export type NotificationPrefs = Record<NotifiableEventType, boolean>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  approval: true,
  session_done: true,
  session_failed: true,
  device_offline: true,
};

/**
 * True unless the user has explicitly switched this type off. A missing key
 * (older persisted state predating a type) defaults to enabled so a pref schema
 * change can never silently suppress notifications.
 */
export function isEventTypeEnabled(
  prefs: NotificationPrefs,
  type: NotifiableEventType,
): boolean {
  return prefs[type] !== false;
}
