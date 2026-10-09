/**
 * 检查更新状态机(独立 zustand store,样板=toastStore)。
 *
 * 硬约束(与 alianggate 参考客户端对齐、修掉其缺陷):
 * - 判定只信本地复算(resolveUpdateDecision);失败/断网绝不锁人,保留上次
 *   成功快照供 UI 展示。
 * - 软提醒"稍后再说"按 latestVersion 落盘 AsyncStorage(gateway 只存内存、
 *   重启复弹是缺陷);同版本自动检查不再弹,手动检查(设置页入口)强制可见。
 * - 强制更新不可 dismiss——唯一解除方式是装上新版本,下次检查本地复算通过。
 * - 本机版本读不到 → 全程静默,不发起请求。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { Platform } from 'react-native';
import {
  fetchUpdateCheck,
  type AppUpdatePlatform,
} from '../api/appUpdate';
import { getInstalledAppVersion } from '../native/AppVersion';
import { resolveUpdateDecision } from '../utils/appUpdateSemver';

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'forced'
  | 'error';

export interface AppUpdateInfo {
  latestVersion: string;
  downloadUrl: string;
  changelog: string;
}

interface AppUpdateState {
  status: AppUpdateStatus;
  info: AppUpdateInfo | null;
  lastError: string | null;
  /** 软提醒"稍后再说"记忆的版本(v 前缀);null=没有抑制 */
  dismissedVersion: string | null;
  /** 自动弹窗是否被抑制(dismiss 或恢复的 dismissed 记忆命中) */
  promptSuppressed: boolean;
  checkNow: (opts?: { manual?: boolean }) => Promise<void>;
  maybeCheckOnForeground: () => void;
  dismiss: () => void;
}

const DISMISS_STORAGE_KEY = 'appUpdate.dismissedVersion';
/** 前台恢复重查的最小间隔。 */
export const FOREGROUND_RECHECK_INTERVAL_MS = 30 * 60 * 1000;
/**
 * 单次检查的硬死线:HTTP 客户端的超时只护到响应头,慢速滴漏的响应体可以让
 * await 永不 settle → inFlight 单飞锁永久锁死(检查更新永远卡 checking)。
 */
const CHECK_HARD_DEADLINE_MS = 30_000;

function updatePlatform(): AppUpdatePlatform {
  return Platform.OS === 'android' ? 'android' : 'ios';
}

let lastCheckedAtMs = 0;
let dismissedVersionCache: string | null = null;
let dismissalHydrated = false;
let inFlight: Promise<void> | null = null;

/**
 * dismiss 记忆的进程内缓存:首次检查时从 AsyncStorage 水合一次,此后以缓存
 * 为准(dismiss 同步更新缓存)。不能永久 memoize 读 promise——否则 dismiss
 * 落盘后同进程内的后续检查永远读到旧值。
 */
function loadDismissedVersion(): Promise<string | null> {
  if (dismissalHydrated) return Promise.resolve(dismissedVersionCache);
  return AsyncStorage.getItem(DISMISS_STORAGE_KEY)
    .then(value => {
      dismissedVersionCache = value;
      dismissalHydrated = true;
      return value;
    })
    .catch(() => {
      dismissalHydrated = true;
      return null;
    });
}

async function persistDismissed(version: string) {
  dismissedVersionCache = version;
  dismissalHydrated = true;
  try {
    await AsyncStorage.setItem(DISMISS_STORAGE_KEY, version);
  } catch {
    // 存储失败只影响下次启动的记忆,不阻断本次 dismiss。
  }
}

/** 总预算死线:响应体阶段不受 HTTP 客户端超时保护,这里兜底。 */
async function withDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('app update check timed out')),
      CHECK_HARD_DEADLINE_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  status: 'idle',
  info: null,
  lastError: null,
  dismissedVersion: null,
  promptSuppressed: false,

  checkNow: async (opts = {}) => {
    if (inFlight) return inFlight;
    const run = (async () => {
      const manual = opts.manual === true;
      const dismissedVersion = await loadDismissedVersion();
      set({ dismissedVersion });

      const installed = getInstalledAppVersion();
      if (!installed) {
        // 版本单源缺失:完全静默,连请求都不发(绝不因读不到版本而误判)。
        set({ status: 'idle' });
        return;
      }

      // 粘滞强制:已判定 forced 后的重查,过程态不得翻 checking/失败不得翻
      // error——否则全屏 Gate 卸载,断网/失败反而成了绕过强制更新的通道。
      set(state => ({
        status: state.status === 'forced' ? 'forced' : 'checking',
        lastError: null,
      }));
      try {
        const result = await withDeadline(
          fetchUpdateCheck(updatePlatform(), installed.versionName),
        );
        if (!result) {
          // 404 无行/格式不可判:按已最新处理(不提示)。
          set({ status: 'upToDate', info: null });
          return;
        }
        const decision = resolveUpdateDecision(
          installed.versionName,
          result.latestVersion,
          result.serverForceFlag,
        );
        if (!decision || !decision.needsUpdate) {
          set({ status: 'upToDate', info: null });
          return;
        }
        const info: AppUpdateInfo = {
          latestVersion: result.latestVersion,
          downloadUrl: result.downloadUrl,
          changelog: result.changelog,
        };
        if (decision.forceUpdate) {
          // 强制更新无视 dismiss 记忆(也不允许 dismiss)。
          set({ status: 'forced', info, promptSuppressed: false });
          return;
        }
        set({
          status: 'available',
          info,
          promptSuppressed:
            !manual && dismissedVersion === result.latestVersion,
        });
      } catch (error) {
        // 失败保留上次成功快照。非 forced 落 error 仅驱动设置页文案,绝不锁
        // UI;forced 保持 forced——失败/断网不能把已锁定的用户放出去,唯一
        // 解除方式仍是一次"成功的检查"判定无需更新。
        set(state => {
          if (state.status === 'forced') {
            return {
              lastError: error instanceof Error ? error.message : String(error),
            };
          }
          return {
            status: 'error',
            lastError: error instanceof Error ? error.message : String(error),
          };
        });
      } finally {
        lastCheckedAtMs = Date.now();
        inFlight = null;
      }
    })();
    inFlight = run;
    return run;
  },

  maybeCheckOnForeground: () => {
    if (Date.now() - lastCheckedAtMs < FOREGROUND_RECHECK_INTERVAL_MS) return;
    void get().checkNow();
  },

  dismiss: () => {
    const { info, status } = get();
    if (status === 'forced') return; // 强制更新不可 dismiss
    if (!info) return;
    set({ promptSuppressed: true, dismissedVersion: info.latestVersion });
    void persistDismissed(info.latestVersion);
  },
}));

/** 测试辅助:恢复初始状态与模块级节流/水合记忆。仅测试使用。 */
export function resetAppUpdateStoreForTest() {
  lastCheckedAtMs = 0;
  dismissedVersionCache = null;
  dismissalHydrated = false;
  inFlight = null;
  useAppUpdateStore.setState({
    status: 'idle',
    info: null,
    lastError: null,
    dismissedVersion: null,
    promptSuppressed: false,
  });
}
