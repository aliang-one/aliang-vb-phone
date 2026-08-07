import { Platform } from 'react-native';
import i18n from '../i18n';
import {
  decideNotificationDelivery,
  type NotificationDeliveryState,
} from '../utils/notificationDeliveryPolicy';

type NotifyKit = typeof import('react-native-notify-kit');

let cache: NotifyKit | null = null;
let unavailable = false;

function load(): NotifyKit | null {
  if (unavailable) return null;
  if (cache) return cache;
  if (Platform.OS !== 'android') {
    unavailable = true;
    return null;
  }
  try {
    cache = require('react-native-notify-kit');
    return cache;
  } catch (error) {
    // require failures used to be silently swallowed, which hid the root cause
    // of "notifications never appear" on builds where notify-kit's native
    // module was missing. Surface it.
    console.warn('[localNotifications] notify-kit require failed', error);
    unavailable = true;
    return null;
  }
}

const CHANNEL_ID = 'vibe_background';
const GROUP_ID = 'vibe_background_updates';
const SUMMARY_ID = 'vibe_background_summary';
const RATE_WINDOW_MS = 60_000;
const MAX_ALERTS_PER_WINDOW = 5;
const MAX_DISPLAYED_NOTIFICATIONS = 12;
const SMALL_ICON = 'ic_notification';

let channelEnsured = false;
let deliveryState: NotificationDeliveryState = {
  recentAlertTimes: [],
  suppressedCount: 0,
};

export type LocalNotificationPermissionStatus =
  | 'unsupported'
  | 'not_determined'
  | 'denied'
  | 'authorized';

export async function ensureChannel(): Promise<void> {
  const lib = load();
  if (!lib || channelEnsured) return;
  try {
    await lib.default.createChannel({
      id: CHANNEL_ID,
      name: i18n.t('common:notification.channelName'),
      importance: lib.AndroidImportance.HIGH,
    });
    channelEnsured = true;
  } catch (error) {
    console.warn('[localNotifications] ensureChannel failed', error);
    // Best effort. displayNotification reports failure to its caller.
  }
}

export async function getNotificationPermissionStatus(): Promise<
  LocalNotificationPermissionStatus
> {
  const lib = load();
  if (!lib) return 'unsupported';
  try {
    const settings = await lib.default.getNotificationSettings();
    if (settings.authorizationStatus === lib.AuthorizationStatus.AUTHORIZED) {
      return 'authorized';
    }
    if (
      settings.authorizationStatus === lib.AuthorizationStatus.NOT_DETERMINED
    ) {
      return 'not_determined';
    }
    return 'denied';
  } catch (error) {
    console.warn(
      '[localNotifications] getNotificationPermissionStatus failed',
      error,
    );
    return 'unsupported';
  }
}

/** Requests only an undecided permission. A previous denial is never re-prompted. */
export async function requestPermission(): Promise<boolean> {
  const lib = load();
  if (!lib) return false;
  const current = await getNotificationPermissionStatus();
  if (current === 'authorized') return true;
  if (current !== 'not_determined') return false;
  try {
    const settings = await lib.default.requestPermission();
    return settings.authorizationStatus === lib.AuthorizationStatus.AUTHORIZED;
  } catch (error) {
    console.warn('[localNotifications] requestPermission failed', error);
    return false;
  }
}

export async function openNotificationSettings(): Promise<boolean> {
  const lib = load();
  if (!lib) return false;
  try {
    // Open APP-LEVEL notification settings (no channelId). A user whose
    // permission is `denied` needs the app's master notification toggle to
    // re-enable — per-channel settings can't even be reached while the app is
    // off. Passing a channelId ALSO breaks when the channel was never created
    // (it is only created lazily inside displayNotification), which made this
    // call silently fail and left the Settings button looking dead.
    await lib.default.openNotificationSettings();
    return true;
  } catch (error) {
    console.warn('[localNotifications] openNotificationSettings failed', error);
    return false;
  }
}

export interface LocalNotificationInput {
  id: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  summary?: boolean;
}

export type DisplayResult = { ok: true } | { ok: false; error: string };

/**
 * Displays or replaces one local notification. Returns a result object (not a
 * bare boolean) so callers can surface WHY a display failed — the Settings
 * "send test" button shows `error` in its toast, which is what lets us diagnose
 * a silent failure (e.g. channel-not-created, invalid icon) without logcat.
 */
export async function displayNotification(
  notification: LocalNotificationInput,
): Promise<DisplayResult> {
  const lib = load();
  if (!lib) {
    return { ok: false, error: 'notify-kit unavailable on this platform' };
  }
  await ensureChannel();
  const isApproval = notification.data?.type === 'approval';
  try {
    await lib.default.displayNotification({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      android: {
        channelId: CHANNEL_ID,
        smallIcon: SMALL_ICON,
        groupId: GROUP_ID,
        // Only set for actual group-summary notifications. Passing `undefined`
        // here makes Notifee's validator reject ("'notification.android.groupSummary'
        // expected a boolean value") — which silently broke every non-summary
        // display (the Settings test button AND all background notifications).
        ...(notification.summary !== undefined
          ? { groupSummary: notification.summary }
          : {}),
        pressAction: { id: 'default' },
        // Approval notifications carry inline 批准/拒绝 actions so the user can
        // resolve without opening the app. Other types fall back to body-tap.
        ...(isApproval
          ? {
              actions: [
                {
                  title: i18n.t('common:notification.approve'),
                  pressAction: { id: 'approve' },
                },
                {
                  title: i18n.t('common:notification.deny'),
                  pressAction: { id: 'deny' },
                },
              ],
            }
          : {}),
      },
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[localNotifications] displayNotification failed', error);
    return { ok: false, error: message };
  }
}

export interface ManagedNotificationInput {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  data: Record<string, string>;
}

/**
 * Bounds notification storms. The first five updates per minute are displayed
 * individually; overflow replaces one stable summary notification.
 */
export async function displayManagedNotification(
  notification: ManagedNotificationInput,
  now = Date.now(),
): Promise<boolean> {
  const decision = decideNotificationDelivery(
    deliveryState,
    now,
    RATE_WINDOW_MS,
    MAX_ALERTS_PER_WINDOW,
  );
  if (decision.kind === 'summary') {
    const result = await displayNotification({
      id: SUMMARY_ID,
      title: i18n.t('common:notification.summaryTitle'),
      body: i18n.t('common:notification.summaryBody', {
        count: decision.state.suppressedCount,
      }),
      summary: true,
      data: {
        type: 'summary',
        nativeId: SUMMARY_ID,
        userId: notification.data.userId ?? '',
        createdAt: String(now),
      },
    });
    if (result.ok) {
      deliveryState = decision.state;
      await trimDisplayedNotifications();
    }
    return result.ok;
  }

  const result = await displayNotification({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    data: {
      ...notification.data,
      nativeId: notification.id,
      createdAt: notification.createdAt,
    },
  });
  if (!result.ok) return false;
  deliveryState = decision.state;
  await trimDisplayedNotifications();
  return true;
}

async function trimDisplayedNotifications(): Promise<void> {
  const lib = load();
  if (!lib) return;
  try {
    const displayed = (await lib.default.getDisplayedNotifications())
      .filter(item => item.id?.startsWith('vibe_'))
      .sort((left, right) => {
        const timestamp = (value: unknown) => {
          const numeric = Number(value);
          if (Number.isFinite(numeric)) return numeric;
          const parsed = Date.parse(String(value ?? ''));
          return Number.isFinite(parsed) ? parsed : 0;
        };
        const leftAt = timestamp(left.notification.data?.createdAt);
        const rightAt = timestamp(right.notification.data?.createdAt);
        return rightAt - leftAt;
      });
    const overflow = displayed.slice(MAX_DISPLAYED_NOTIFICATIONS);
    await Promise.all(
      overflow.map(item =>
        item.id ? lib.default.cancelNotification(item.id) : Promise.resolve(),
      ),
    );
  } catch (error) {
    console.warn('[localNotifications] trimDisplayedNotifications failed', error);
    // Trimming is defensive and must not make a successful display look failed.
  }
}

type PressEvent = {
  type: number;
  detail?: {
    pressAction?: { id?: string };
    notification?: {
      id?: string;
      data?: Record<string, unknown>;
    };
  };
};

const withNativeId = (
  data: Record<string, unknown> | undefined,
  nativeId: string | undefined,
) => (nativeId ? { ...data, nativeId } : data);

export function onNotificationPress(
  callback: (data: Record<string, unknown> | undefined) => void,
): () => void {
  const lib = load();
  if (!lib) return () => undefined;
  try {
    return lib.default.onForegroundEvent(event => {
      const current = event as unknown as PressEvent;
      if (current.type === lib.EventType.PRESS) {
        callback(
          withNativeId(
            current.detail?.notification?.data,
            current.detail?.notification?.id,
          ),
        );
      }
    });
  } catch (error) {
    console.warn('[localNotifications] onNotificationPress failed', error);
    return () => undefined;
  }
}

/**
 * Subscribes to notification *action* button presses (e.g. 批准/拒绝 on an
 * approval notification), as opposed to a body tap. `actionId` is the
 * `pressAction.id` of the pressed action (e.g. 'approve' / 'deny'). Returns an
 * unsubscribe. No-op on non-Android / when notify-kit is unavailable.
 */
export function onNotificationAction(
  callback: (
    data: Record<string, unknown> | undefined,
    actionId: string,
  ) => void,
): () => void {
  const lib = load();
  if (!lib) return () => undefined;
  try {
    return lib.default.onForegroundEvent(event => {
      const current = event as unknown as PressEvent;
      if (current.type === lib.EventType.ACTION_PRESS) {
        const actionId = current.detail?.pressAction?.id;
        if (actionId) {
          callback(
            withNativeId(
              current.detail?.notification?.data,
              current.detail?.notification?.id,
            ),
            actionId,
          );
        }
      }
    });
  } catch (error) {
    console.warn('[localNotifications] onNotificationAction failed', error);
    return () => undefined;
  }
}

/** Cancels a displayed notification by its native id (best effort). */
export async function cancelNotification(nativeId: string): Promise<void> {
  const lib = load();
  if (!lib) return;
  try {
    await lib.default.cancelNotification(nativeId);
  } catch (error) {
    console.warn('[localNotifications] cancelNotification failed', error);
  }
}

export async function getInitialNotificationData(): Promise<
  Record<string, unknown> | undefined
> {
  const lib = load();
  if (!lib) return undefined;
  try {
    const initial = await lib.default.getInitialNotification();
    return withNativeId(
      initial?.notification?.data as Record<string, unknown> | undefined,
      initial?.notification?.id,
    );
  } catch (error) {
    console.warn('[localNotifications] getInitialNotificationData failed', error);
    return undefined;
  }
}

/** Test-only reset for deterministic rate-limit tests. */
export function resetNotificationDeliveryStateForTests(): void {
  deliveryState = { recentAlertTimes: [], suppressedCount: 0 };
}
