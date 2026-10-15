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
  /**
   * 最近一次检查是否做出了真实判定(取到 latest 且本地可比)。手动检查的
   * 反馈据此区分「已是最新」与「没查成」——404 无行/版本不可判不再被说成
   * 已是最新。
   */
  lastCheckDecided: boolean;
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
 * 进行中的 run 被手动「检查更新」点击加入时置位:run 在出结果时消费它,
 * 把「稍后再说」抑制视为手动检查(强制可见)。不这样做的话,自动检查与
 * 手动点击并发时,点击会被单飞去重静默吞掉——用户点了却毫无反应。
 */
let manualHint = false;

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

/** 总预算死线:响应体阶段不受 HTTP 客户端超时保护,这里兜底;到点同时
 * abort 底层 fetch(不留悬挂请求累积)。 */
async function withDeadline<T>(
  promise: Promise<T>,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error('app update check timed out'));
    }, CHECK_HARD_DEADLINE_MS);
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
  lastCheckDecided: false,

  checkNow: async (opts = {}) => {
    if (inFlight) {
      if (opts.manual) manualHint = true;
      return inFlight;
    }
    const run = (async () => {
      const dismissedVersion = await loadDismissedVersion();
      set({ dismissedVersion });

      const controller = new AbortController();
      try {
        const installed = getInstalledAppVersion();
        if (!installed) {
          // 版本单源缺失:完全静默,连请求都不发(绝不因读不到版本而误判)。
          // 必须落在 try 内——否则提前 return 跳过 finally,inFlight 永不
          // 清空,本进程内所有后续检查(含手动)全部死锁成 no-op。
          set({ status: 'idle', lastCheckDecided: false });
          return;
        }

        // 粘滞强制:已判定 forced 后的重查,过程态不得翻 checking/失败不得翻
        // error——否则全屏 Gate 卸载,断网/失败反而成了绕过强制更新的通道。
        set(state => ({
          status: state.status === 'forced' ? 'forced' : 'checking',
          lastError: null,
        }));
        const result = await withDeadline(
          fetchUpdateCheck(
            updatePlatform(),
            installed.versionName,
            controller.signal,
          ),
          () => controller.abort(),
        );
        if (!result) {
          // 404 无行/格式不可判:无行 ≠ 无更新。非 forced 按已最新静默处理
          // (不提示);forced 下绝不解锁——解锁的唯一路径是「取到 latest 且
          // 本地复算通过」,否则运维修掉配置行就成了绕过强制更新的通道
          // (2026-10-15 审计:forced 粘滞只护住了 checking/error,漏了这里)。
          set(state =>
            state.status === 'forced'
              ? {}
              : { status: 'upToDate', info: null, lastCheckDecided: false },
          );
          return;
        }
        const decision = resolveUpdateDecision(
          installed.versionName,
          result.latestVersion,
          result.serverForceFlag,
        );
        if (!decision) {
          // 服务端版本格式非法等不可判定:同 404,forced 粘滞、非 forced 静默。
          set(state =>
            state.status === 'forced'
              ? {}
              : { status: 'upToDate', info: null, lastCheckDecided: false },
          );
          return;
        }
        if (!decision.needsUpdate) {
          // 本地复算通过(装上新版后版本号反超):强制更新的唯一合法解除路径。
          set({ status: 'upToDate', info: null, lastCheckDecided: true });
          return;
        }
        const info: AppUpdateInfo = {
          latestVersion: result.latestVersion,
          downloadUrl: result.downloadUrl,
          changelog: result.changelog,
        };
        if (decision.forceUpdate) {
          // 强制更新无视 dismiss 记忆(也不允许 dismiss)。
          set({
            status: 'forced',
            info,
            promptSuppressed: false,
            lastCheckDecided: true,
          });
          return;
        }
        set({
          status: 'available',
          info,
          // 出结果时才解析 manual:并发加入的手动点击(manualHint)在此时生效。
          promptSuppressed:
            !(opts.manual === true || manualHint) &&
            dismissedVersion === result.latestVersion,
          lastCheckDecided: true,
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
            lastCheckDecided: false,
          };
        });
      } finally {
        lastCheckedAtMs = Date.now();
        inFlight = null;
        manualHint = false;
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
  manualHint = false;
  useAppUpdateStore.setState({
    status: 'idle',
    info: null,
    lastError: null,
    dismissedVersion: null,
    promptSuppressed: false,
    lastCheckDecided: false,
  });
}
