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

import { Platform } from 'react-native';
import {
  openNotificationSettings,
  getNotificationPermissionStatus,
  displayNotification,
} from '../src/services/localNotifications';

// Match how the service itself reads the lib (`require(...).default`). `import * as`
// loses the `.default` shape under Babel CJS interop with this mock.
const NotifyKit = require('react-native-notify-kit') as {
  default: {
    createChannel: jest.Mock;
    getNotificationSettings: jest.Mock;
    requestPermission: jest.Mock;
    openNotificationSettings: jest.Mock;
    displayNotification: jest.Mock;
  };
  AuthorizationStatus: { AUTHORIZED: string; NOT_DETERMINED: string };
};

// localNotifications.load() short-circuits to `unavailable` off-Android. The
// notification feature is Android-only, so force the platform for this file.
const savedOS = Platform.OS;
beforeAll(() => {
  Platform.OS = 'android';
});
afterAll(() => {
  Platform.OS = savedOS;
});
beforeEach(() => {
  jest.clearAllMocks();
});

describe('openNotificationSettings', () => {
  test('opens APP-LEVEL settings — no channelId (denied users re-enable the master toggle; avoids the not-yet-created channel)', async () => {
    (NotifyKit.default.openNotificationSettings as jest.Mock).mockResolvedValue(true);

    const ok = await openNotificationSettings();

    expect(ok).toBe(true);
    expect(NotifyKit.default.openNotificationSettings).toHaveBeenCalledTimes(1);
    // App-level: zero arguments. Passing 'vibe_background' opens per-channel
    // settings, which is the wrong destination for a denied app AND fails when
    // the channel was never created (it is only created inside displayNotification).
    expect(NotifyKit.default.openNotificationSettings).toHaveBeenCalledWith();
  });

  test('reports failure (false) when the native call rejects, instead of throwing', async () => {
    (NotifyKit.default.openNotificationSettings as jest.Mock).mockRejectedValue(
      new Error('boom'),
    );

    const ok = await openNotificationSettings();

    expect(ok).toBe(false);
  });
});

describe('getNotificationPermissionStatus', () => {
  test('maps authorized settings → "authorized"', async () => {
    (NotifyKit.default.getNotificationSettings as jest.Mock).mockResolvedValue({
      authorizationStatus: NotifyKit.AuthorizationStatus.AUTHORIZED,
    });
    await expect(getNotificationPermissionStatus()).resolves.toBe('authorized');
  });

  test('maps non-authorized settings → "denied" (real OS refusal, surfaces as warning)', async () => {
    (NotifyKit.default.getNotificationSettings as jest.Mock).mockResolvedValue({
      authorizationStatus: 'something_else',
    });
    await expect(getNotificationPermissionStatus()).resolves.toBe('denied');
  });
});

// displayNotification returns a result object (not a bare boolean) so the
// Settings test button can show WHY a display failed instead of a generic toast.
describe('displayNotification result contract', () => {
  test('returns {ok:true} when the native display succeeds', async () => {
    (NotifyKit.default.createChannel as jest.Mock).mockResolvedValue(undefined);
    (NotifyKit.default.displayNotification as jest.Mock).mockResolvedValue(undefined);
    const result = await displayNotification({ id: 'x', title: 't', body: 'b' });
    expect(result).toEqual({ ok: true });
  });

  test('returns {ok:false, error} with the native message on rejection (NOT a bare false)', async () => {
    (NotifyKit.default.createChannel as jest.Mock).mockResolvedValue(undefined);
    (NotifyKit.default.displayNotification as jest.Mock).mockRejectedValue(
      new Error('channel vibe_background does not exist'),
    );
    const result = await displayNotification({ id: 'x', title: 't', body: 'b' });
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain(
      'channel vibe_background does not exist',
    );
  });

  // Regression: passing `groupSummary: undefined` (notification without a
  // summary) makes Notifee's validator reject with "expected a boolean value",
  // which silently broke EVERY non-summary notification — the Settings test
  // button and all background server notifications. Assert the native call
  // never receives an undefined groupSummary.
  test('omits groupSummary when the notification has no summary', async () => {
    (NotifyKit.default.createChannel as jest.Mock).mockResolvedValue(undefined);
    (NotifyKit.default.displayNotification as jest.Mock).mockResolvedValue(undefined);
    await displayNotification({ id: 'x', title: 't', body: 'b' });
    const passed = (NotifyKit.default.displayNotification as jest.Mock).mock
      .calls[0][0] as { android: Record<string, unknown> };
    expect(passed.android).not.toHaveProperty('groupSummary');
  });

  test('still passes groupSummary when the notification IS a summary', async () => {
    (NotifyKit.default.createChannel as jest.Mock).mockResolvedValue(undefined);
    (NotifyKit.default.displayNotification as jest.Mock).mockResolvedValue(undefined);
    await displayNotification({ id: 'x', title: 't', body: 'b', summary: true });
    const passed = (NotifyKit.default.displayNotification as jest.Mock).mock
      .calls[0][0] as { android: Record<string, unknown> };
    expect(passed.android.groupSummary).toBe(true);
  });
});
