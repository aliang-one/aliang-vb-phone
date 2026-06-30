import { Platform } from 'react-native';

/**
 * react-native-notify-kit(notifee 归档后的维护 fork,v10)封装。
 *
 * 平台守卫 + 懒加载:iOS、或 Android 未 rebuild(原生模块未注册)→ 降级为 no-op,
 * 绝不抛、不崩核心屏。镜像本仓 voiceRecorder.ts 的懒 require + try/catch 范式。
 *
 * notify-kit 的方法在**默认导出**上(`mod.default.createChannel` …),枚举
 * (EventType / AuthorizationStatus / AndroidImportance)是**具名导出**。
 */

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
let channelEnsured = false;

/** 创建(幂等)heads-up 通知渠道。不可用 / 已建 → no-op。 */
export async function ensureChannel(): Promise<void> {
  const lib = load();
  if (!lib || channelEnsured) return;
  try {
    await lib.default.createChannel({
      id: CHANNEL_ID,
      name: 'Vibe 后台通知',
      importance: lib.AndroidImportance.HIGH,
    });
    channelEnsured = true;
  } catch {
    /* ignore — best-effort */
  }
}

/** 申请通知权限(Android 13+ POST_NOTIFICATIONS)。返回是否已授权;不可用 → false。 */
export async function requestPermission(): Promise<boolean> {
  const lib = load();
  if (!lib) return false;
  try {
    const settings = await lib.default.requestPermission();
    return settings.authorizationStatus === lib.AuthorizationStatus.AUTHORIZED;
  } catch {
    return false;
  }
}

export interface LocalNotificationInput {
  title: string;
  body: string;
  /** notifee 要求 data 值为 string(与 Android Bundle 对齐)。 */
  data?: Record<string, string>;
}

/** 弹一条本地通知。best-effort:任何失败静默吞掉,不影响主流程。 */
export async function displayNotification(n: LocalNotificationInput): Promise<void> {
  const lib = load();
  if (!lib) return;
  await ensureChannel();
  try {
    await lib.default.displayNotification({
      title: n.title,
      body: n.body,
      data: n.data,
      android: {
        channelId: CHANNEL_ID,
        smallIcon: 'ic_launcher',
        pressAction: { id: 'default' },
      },
    });
  } catch {
    /* ignore — best-effort */
  }
}

type PressEvent = {
  type: number;
  detail?: { notification?: { data?: Record<string, unknown> } };
};

/**
 * 订阅前台通知事件:用户点通知把 app 从后台拉起 / 冷启动后回到前台时触发。
 * 仅 PRESS 时回调,传出该通知的 data。返回取消订阅函数;不可用 → no-op。
 */
export function onNotificationPress(
  cb: (data: Record<string, unknown> | undefined) => void,
): () => void {
  const lib = load();
  if (!lib) return () => undefined;
  try {
    return lib.default.onForegroundEvent(event => {
      const e = event as unknown as PressEvent;
      if (e.type === lib.EventType.PRESS) {
        cb(e.detail?.notification?.data);
      }
    });
  } catch {
    return () => undefined;
  }
}

/** 冷启动被通知拉起 → 返回那条通知的 data;否则 / 不可用 → undefined。 */
export async function getInitialNotificationData(): Promise<
  Record<string, unknown> | undefined
> {
  const lib = load();
  if (!lib) return undefined;
  try {
    const initial = await lib.default.getInitialNotification();
    return initial?.notification?.data as Record<string, unknown> | undefined;
  } catch {
    return undefined;
  }
}
