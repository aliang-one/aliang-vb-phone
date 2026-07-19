import { resolveNotificationTapTarget } from '../notificationTap';

describe('resolveNotificationTapTarget', () => {
  it('opens an approval in its session', () => {
    expect(
      resolveNotificationTapTarget({
        type: 'approval',
        sessionId: 's1',
        approvalId: 'a1',
      }),
    ).toEqual({
      route: 'VibeCodingSession',
      params: { sessionId: 's1', approvalId: 'a1' },
    });
  });

  it('opens a terminal session update without unrelated approval data', () => {
    expect(
      resolveNotificationTapTarget({
        type: 'session_done',
        sessionId: 's1',
        approvalId: 'a1',
      }),
    ).toEqual({
      route: 'VibeCodingSession',
      params: { sessionId: 's1', approvalId: undefined },
    });
  });

  it('opens an offline device directly', () => {
    expect(
      resolveNotificationTapTarget({
        type: 'device_offline',
        deviceId: 'd1',
      }),
    ).toEqual({ route: 'DeviceDetail', params: { deviceId: 'd1' } });
  });

  it('opens the notification center for a burst summary', () => {
    expect(resolveNotificationTapTarget({ type: 'summary' })).toEqual({
      route: 'NotificationCenter',
      params: undefined,
    });
  });

  it('rejects malformed or missing target IDs', () => {
    expect(
      resolveNotificationTapTarget({ type: 'approval', approvalId: 'a1' }),
    ).toBeNull();
    expect(
      resolveNotificationTapTarget({ type: 'device_offline', deviceId: ' ' }),
    ).toBeNull();
    expect(resolveNotificationTapTarget(null)).toBeNull();
  });
});
