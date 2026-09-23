// iOS-side contract of the notification wrapper. Historically load() was gated
// to Android-only, which made the Settings notification panel permanently
// disabled on iPhones ("当前平台或安装包不支持") even though the iOS pod
// (RNNotifee) is linked and the library implements permission status/request
// natively. These tests pin the cross-platform behavior; Android behavior
// lives in localNotifications.test.ts (which forces Platform.OS = 'android').
jest.mock('react-native-notify-kit', () => ({
  default: {
    createChannel: jest.fn(),
    getNotificationSettings: jest.fn(),
    requestPermission: jest.fn(),
    openNotificationSettings: jest.fn(),
    displayNotification: jest.fn(),
    getDisplayedNotifications: jest.fn(),
    cancelNotification: jest.fn(),
    getInitialNotification: jest.fn(),
    onForegroundEvent: jest.fn(() => () => undefined),
  },
  AndroidImportance: { HIGH: 'high' },
  AuthorizationStatus: { AUTHORIZED: 'authorized', NOT_DETERMINED: 'not_determined' },
  EventType: { PRESS: 1, ACTION_PRESS: 2 },
}));

import { Linking, Platform } from 'react-native';
import {
  openNotificationSettings,
  getNotificationPermissionStatus,
  displayNotification,
} from '../src/services/localNotifications';

const NotifyKit = require('react-native-notify-kit') as {
  default: {
    getNotificationSettings: jest.Mock;
    openNotificationSettings: jest.Mock;
    displayNotification: jest.Mock;
    createChannel: jest.Mock;
  };
  AuthorizationStatus: { AUTHORIZED: string };
};

const savedOS = Platform.OS;
beforeAll(() => {
  Platform.OS = 'ios';
});
afterAll(() => {
  Platform.OS = savedOS;
});
beforeEach(() => {
  jest.clearAllMocks();
});

describe('getNotificationPermissionStatus on iOS', () => {
  test('maps native settings → "authorized" instead of hard-coded "unsupported"', async () => {
    (NotifyKit.default.getNotificationSettings as jest.Mock).mockResolvedValue({
      authorizationStatus: NotifyKit.AuthorizationStatus.AUTHORIZED,
    });

    await expect(getNotificationPermissionStatus()).resolves.toBe('authorized');
  });
});

describe('openNotificationSettings on iOS', () => {
  test('opens the app system settings page via Linking (notify-kit is a no-op there)', async () => {
    const openSettingsSpy = jest
      .spyOn(Linking, 'openSettings')
      .mockResolvedValue(undefined);

    const ok = await openNotificationSettings();

    expect(ok).toBe(true);
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
    // The native openNotificationSettings resolves(nil) on iOS without doing
    // anything — it must NOT be the code path used here.
    expect(NotifyKit.default.openNotificationSettings).not.toHaveBeenCalled();
  });

  test('reports failure (false) when Linking.openSettings rejects', async () => {
    jest
      .spyOn(Linking, 'openSettings')
      .mockRejectedValue(new Error('no settings url'));

    const ok = await openNotificationSettings();

    expect(ok).toBe(false);
  });
});

describe('displayNotification on iOS', () => {
  test('delivers through notify-kit and returns {ok:true} (channel call is Android-only and best-effort)', async () => {
    (NotifyKit.default.createChannel as jest.Mock).mockResolvedValue(undefined);
    (NotifyKit.default.displayNotification as jest.Mock).mockResolvedValue(undefined);

    const result = await displayNotification({ id: 'x', title: 't', body: 'b' });

    expect(result).toEqual({ ok: true });
    expect(NotifyKit.default.displayNotification).toHaveBeenCalledTimes(1);
  });
});
