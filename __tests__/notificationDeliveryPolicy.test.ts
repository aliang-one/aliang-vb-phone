import {
  DEFAULT_NOTIFICATION_PREFS,
  isEventTypeEnabled,
  type NotificationPrefs,
} from '../src/utils/notificationDeliveryPolicy';

describe('device_online pref', () => {
  test('default prefs include device_online: true', () => {
    expect(DEFAULT_NOTIFICATION_PREFS.device_online).toBe(true);
  });

  // 旧持久化状态没有 device_online 键 —— isEventTypeEnabled 的
  // `!== false` 兜底必须视为开启，升级不能静默吞通知（spec §4.4）。
  test('missing key (pre-device_online persisted state) defaults to enabled', () => {
    const legacy = {
      approval: true,
      session_done: true,
      session_failed: true,
      device_offline: false,
    } as unknown as NotificationPrefs;
    expect(isEventTypeEnabled(legacy, 'device_online')).toBe(true);
  });
});
