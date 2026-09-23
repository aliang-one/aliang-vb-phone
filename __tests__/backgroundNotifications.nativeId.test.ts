import { nativeNotificationId } from '../src/utils/backgroundNotifications';
import type { PushNotificationItem } from '../src/store/types';

const item = (over: Partial<PushNotificationItem>): PushNotificationItem =>
  ({ id: 'n1', createdAt: 't', read: false, ...over }) as PushNotificationItem;

describe('nativeNotificationId for device presence', () => {
  test('device_online groups by device → vibe_device_<id>_online', () => {
    expect(
      nativeNotificationId(item({ type: 'device_online', deviceId: 'dev/A' })),
    ).toBe('vibe_device_dev_A_online');
  });

  test('device_offline keeps its existing grouping (regression)', () => {
    expect(
      nativeNotificationId(item({ type: 'device_offline', deviceId: 'dev/A' })),
    ).toBe('vibe_device_dev_A_offline');
  });
});
