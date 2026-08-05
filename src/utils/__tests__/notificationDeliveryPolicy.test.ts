import {
  DEFAULT_NOTIFICATION_PREFS,
  decideNotificationDelivery,
  isEventTypeEnabled,
  type NotificationPrefs,
} from '../notificationDeliveryPolicy';

describe('decideNotificationDelivery', () => {
  it('allows five individual alerts, then collapses overflow into one summary', () => {
    let state = { recentAlertTimes: [] as number[], suppressedCount: 0 };
    const kinds: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const decision = decideNotificationDelivery(state, index * 1_000);
      kinds.push(decision.kind);
      state = decision.state;
    }
    expect(kinds).toEqual([
      'individual',
      'individual',
      'individual',
      'individual',
      'individual',
      'summary',
      'summary',
      'summary',
    ]);
    expect(state.suppressedCount).toBe(3);
  });

  it('opens a fresh window and resets the summary count', () => {
    const decision = decideNotificationDelivery(
      {
        recentAlertTimes: [0, 1_000, 2_000, 3_000, 4_000],
        suppressedCount: 12,
      },
      65_000,
    );
    expect(decision).toEqual({
      kind: 'individual',
      state: { recentAlertTimes: [65_000], suppressedCount: 0 },
    });
  });
});

describe('isEventTypeEnabled', () => {
  it('returns true for every type when all prefs are enabled', () => {
    const prefs: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS };
    expect(isEventTypeEnabled(prefs, 'approval')).toBe(true);
    expect(isEventTypeEnabled(prefs, 'session_done')).toBe(true);
    expect(isEventTypeEnabled(prefs, 'session_failed')).toBe(true);
    expect(isEventTypeEnabled(prefs, 'device_offline')).toBe(true);
  });

  it('returns false only for the type the user switched off', () => {
    const prefs: NotificationPrefs = {
      ...DEFAULT_NOTIFICATION_PREFS,
      approval: false,
    };
    expect(isEventTypeEnabled(prefs, 'approval')).toBe(false);
    expect(isEventTypeEnabled(prefs, 'session_done')).toBe(true);
  });

  it('defaults to enabled when a type is missing from persisted prefs', () => {
    // Older persisted state may predate a newly-added event type. Missing must
    // never silently suppress — it should notify.
    const prefs = { approval: false } as unknown as NotificationPrefs;
    expect(isEventTypeEnabled(prefs, 'approval')).toBe(false);
    expect(isEventTypeEnabled(prefs, 'session_failed')).toBe(true);
  });
});
