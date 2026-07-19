import { decideNotificationDelivery } from '../notificationDeliveryPolicy';

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
