import { resolveNotificationTapTarget } from '../src/utils/notificationTap';

describe('device_online tap routing', () => {
  test('routes to DeviceDetail with the deviceId (same as offline)', () => {
    expect(
      resolveNotificationTapTarget({ type: 'device_online', deviceId: 'd1' }),
    ).toEqual({ route: 'DeviceDetail', params: { deviceId: 'd1' } });
  });

  test('without deviceId falls through to the session/none path (no crash)', () => {
    expect(resolveNotificationTapTarget({ type: 'device_online' })).toBeNull();
  });
});
