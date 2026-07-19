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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cache = require('react-native-notify-kit');
    return cache;
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
    return false;
  }
}

export async function openNotificationSettings(): Promise<boolean> {
  const lib = load();
  if (!lib) return false;
  try {
    await lib.default.openNotificationSettings(CHANNEL_ID);
    return true;
  } catch {
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

/** Displays or replaces one local notification and reports actual success. */
export async function displayNotification(
  notification: LocalNotificationInput,
): Promise<boolean> {
  const lib = load();
  if (!lib) return false;
  await ensureChannel();
  try {
    await lib.default.displayNotification({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      android: {
        channelId: CHANNEL_ID,
        smallIcon: 'ic_launcher',
        groupId: GROUP_ID,
        groupSummary: notification.summary,
        pressAction: { id: 'default' },
      },
    });
    return true;
  } catch {
    return false;
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
    const displayed = await displayNotification({
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
    if (displayed) {
      deliveryState = decision.state;
      await trimDisplayedNotifications();
    }
    return displayed;
  }

  const displayed = await displayNotification({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    data: {
      ...notification.data,
      nativeId: notification.id,
      createdAt: notification.createdAt,
    },
  });
  if (!displayed) return false;
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
  } catch {
    // Trimming is defensive and must not make a successful display look failed.
  }
}

type PressEvent = {
  type: number;
  detail?: {
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
  } catch {
    return () => undefined;
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
  } catch {
    return undefined;
  }
}

/** Test-only reset for deterministic rate-limit tests. */
export function resetNotificationDeliveryStateForTests(): void {
  deliveryState = { recentAlertTimes: [], suppressedCount: 0 };
}
