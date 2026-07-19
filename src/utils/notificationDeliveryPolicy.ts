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
