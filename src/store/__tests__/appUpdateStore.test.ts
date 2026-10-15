/**
 * appUpdateStore — 检查更新状态机。核心约束:
 * ①强制判定只在本地复算通过时成立 ②断网/失败绝不锁人(保留上次快照)
 * ③软提醒"稍后再说"按版本落盘,同版不再自动弹,手动检查强制可见
 * ④本机版本读不到时完全静默 ⑤防重入 ⑥前台恢复节流。
 */
import { jest } from '@jest/globals';

const mockAsyncStorage = new Map<string, string>();
let mockVersionName: string | null = 'v1.0.6';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockAsyncStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockAsyncStorage.set(key, value);
  }),
}));

jest.mock('../../api/appUpdate', () => ({
  APP_UPDATE_SOFTWARE_NAME: 'aliang-vibe-phone',
  fetchUpdateCheck: jest.fn(),
}));

jest.mock('../../native/AppVersion', () => ({
  getInstalledAppVersion: jest.fn(() =>
    mockVersionName
      ? { versionName: mockVersionName, versionCode: '3' }
      : null,
  ),
}));

import {
  useAppUpdateStore,
  resetAppUpdateStoreForTest,
} from '../appUpdateStore';
import { fetchUpdateCheck } from '../../api/appUpdate';
import { getInstalledAppVersion } from '../../native/AppVersion';

const mockedFetch = fetchUpdateCheck as jest.MockedFunction<typeof fetchUpdateCheck>;
const mockedGetVersion = getInstalledAppVersion as jest.MockedFunction<typeof getInstalledAppVersion>;

const latest = (over: Partial<{ version: string; force: boolean; changelog: string; url: string }> = {}) => ({
  latestVersion: over.version ?? 'v1.0.7',
  downloadUrl: over.url ?? 'https://www.aliang.one/download',
  changelog: over.changelog ?? '- 修复若干问题',
  serverForceFlag: over.force ?? false,
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-09T12:00:00Z'));
  mockAsyncStorage.clear();
  mockVersionName = 'v1.0.6';
  mockedFetch.mockReset();
  mockedGetVersion.mockClear();
  resetAppUpdateStoreForTest();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('appUpdateStore', () => {
  it('落后 + 服务端 force → forced,且不写任何 dismiss 存储', async () => {
    mockedFetch.mockResolvedValue(latest({ force: true }));
    await useAppUpdateStore.getState().checkNow();
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe('forced');
    expect(s.info?.latestVersion).toBe('v1.0.7');
    expect(mockAsyncStorage.size).toBe(0);
    expect(mockedFetch).toHaveBeenCalledWith('ios', 'v1.0.6', expect.anything());
  });

  it('落后 + 非 force → available 可弹;dismiss 落盘并抑制自动弹窗', async () => {
    mockedFetch.mockResolvedValue(latest());
    await useAppUpdateStore.getState().checkNow();
    expect(useAppUpdateStore.getState().status).toBe('available');
    expect(useAppUpdateStore.getState().promptSuppressed).toBe(false);

    useAppUpdateStore.getState().dismiss();
    const s = useAppUpdateStore.getState();
    expect(s.promptSuppressed).toBe(true);
    expect(mockAsyncStorage.get('appUpdate.dismissedVersion')).toBe('v1.0.7');

    // 同版本再查(自动):仍 available,但保持抑制——不弹。
    mockedFetch.mockResolvedValue(latest());
    await useAppUpdateStore.getState().checkNow();
    expect(useAppUpdateStore.getState().status).toBe('available');
    expect(useAppUpdateStore.getState().promptSuppressed).toBe(true);
  });

  it('dismiss 后手动检查 → 强制可见(promptSuppressed=false)', async () => {
    mockedFetch.mockResolvedValue(latest());
    await useAppUpdateStore.getState().checkNow();
    useAppUpdateStore.getState().dismiss();
    await useAppUpdateStore.getState().checkNow({ manual: true });
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe('available');
    expect(s.promptSuppressed).toBe(false);
  });

  it('已最新 → upToDate,info 清空', async () => {
    mockVersionName = 'v1.0.7';
    mockedFetch.mockResolvedValue(latest({ version: 'v1.0.7', force: true }));
    await useAppUpdateStore.getState().checkNow();
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe('upToDate');
    expect(s.info).toBeNull();
  });

  it('检查失败 → error 但保留上次快照,绝不 forced', async () => {
    mockedFetch.mockResolvedValue(latest());
    await useAppUpdateStore.getState().checkNow();
    expect(useAppUpdateStore.getState().info).not.toBeNull();

    mockedFetch.mockRejectedValue(new Error('network down'));
    await useAppUpdateStore.getState().checkNow();
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe('error');
    expect(s.info?.latestVersion).toBe('v1.0.7');
    expect(s.lastError).toBeTruthy();
  });

  it('forced 后重查失败 → 保持 forced(断网/失败不可绕过强制更新)', async () => {
    mockedFetch.mockResolvedValue(latest({ force: true }));
    await useAppUpdateStore.getState().checkNow();
    expect(useAppUpdateStore.getState().status).toBe('forced');

    mockedFetch.mockRejectedValue(new Error('airplane mode'));
    await useAppUpdateStore.getState().checkNow();
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe('forced');
    expect(s.info?.latestVersion).toBe('v1.0.7');
    expect(s.lastError).toBeTruthy();
  });

  it('forced 期间重查进行中 → status 保持 forced(Gate 不闪断)', async () => {
    mockedFetch.mockResolvedValue(latest({ force: true }));
    await useAppUpdateStore.getState().checkNow();
    expect(useAppUpdateStore.getState().status).toBe('forced');

    let resolveRetry!: (v: ReturnType<typeof latest>) => void;
    mockedFetch.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRetry = resolve;
        }),
    );
    void useAppUpdateStore.getState().checkNow({ manual: true });
    for (let i = 0; i < 10 && !resolveRetry; i += 1) {
      await Promise.resolve();
    }
    // 重查在途:状态不得翻成 checking(否则全屏 Gate 卸载,用户瞬间逃逸)。
    expect(useAppUpdateStore.getState().status).toBe('forced');
    resolveRetry?.(latest({ force: true }));
    await Promise.resolve();
    expect(useAppUpdateStore.getState().status).toBe('forced');
  });

  it('本机版本读不到 → 完全静默,不发起请求', async () => {
    mockVersionName = null;
    await useAppUpdateStore.getState().checkNow();
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe('idle');
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('防重入:并发 checkNow 只发一次请求', async () => {
    let resolveFetch: ((v: ReturnType<typeof latest>) => void) | undefined;
    mockedFetch.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveFetch = resolve;
        }),
    );
    const p1 = useAppUpdateStore.getState().checkNow();
    const p2 = useAppUpdateStore.getState().checkNow();
    // checkNow 先 await 水合才走到 fetch——排空微任务等 fetch 真正发起。
    for (let i = 0; i < 10 && !resolveFetch; i += 1) {
      await Promise.resolve();
    }
    resolveFetch?.(latest());
    await Promise.all([p1, p2]);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('前台恢复节流:30 分钟内不再查,超时后恢复', async () => {
    mockedFetch.mockResolvedValue(latest());
    await useAppUpdateStore.getState().checkNow();
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-10-09T12:20:00Z'));
    await useAppUpdateStore.getState().maybeCheckOnForeground();
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-10-09T12:31:00Z'));
    await useAppUpdateStore.getState().maybeCheckOnForeground();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('软提醒 dismissed 版本升级后(新 latest)恢复弹窗', async () => {
    mockedFetch.mockResolvedValue(latest({ version: 'v1.0.7' }));
    await useAppUpdateStore.getState().checkNow();
    useAppUpdateStore.getState().dismiss();
    expect(useAppUpdateStore.getState().promptSuppressed).toBe(true);

    mockedFetch.mockResolvedValue(latest({ version: 'v1.0.8' }));
    await useAppUpdateStore.getState().checkNow();
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe('available');
    expect(s.promptSuppressed).toBe(false);
    expect(s.info?.latestVersion).toBe('v1.0.8');
  });

  it('dismiss 记忆从 AsyncStorage 恢复:重启后同版本自动检查不弹', async () => {
    mockAsyncStorage.set('appUpdate.dismissedVersion', 'v1.0.7');
    mockedFetch.mockResolvedValue(latest({ version: 'v1.0.7' }));
    await useAppUpdateStore.getState().checkNow();
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe('available');
    expect(s.promptSuppressed).toBe(true);
  });

  it('检查硬死线:响应体悬挂 30s 判失败、abort 底层请求且 inFlight 解锁', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockedFetch.mockImplementation(
      (_platform: unknown, _version: unknown, signal?: AbortSignal) => {
        capturedSignal = signal;
        return new Promise(() => {});
      },
    );
    const pending = useAppUpdateStore.getState().checkNow();
    await jest.advanceTimersByTimeAsync(30_000);
    await pending;
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe('error');
    expect(s.lastError).toContain('timed out');
    // 死线必须真正取消底层请求(不留悬挂 fetch 累积)。
    expect(capturedSignal?.aborted).toBe(true);

    // inFlight 必须已清:下一次检查真正发起(软提醒可达)。
    mockedFetch.mockResolvedValue(latest());
    await useAppUpdateStore.getState().checkNow();
    expect(useAppUpdateStore.getState().status).toBe('available');
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('版本读不到的检查不得锁死 inFlight:恢复后检查照常发起', async () => {
    mockVersionName = null;
    await useAppUpdateStore.getState().checkNow();
    expect(useAppUpdateStore.getState().status).toBe('idle');

    // 版本恢复可读后(原生桥延迟就绪/测试注入),下一次检查必须真正执行——
    // 提前 return 跳过 finally 的旧实现会让 inFlight 永久挂死,后续全部 no-op。
    mockVersionName = 'v1.0.6';
    mockedFetch.mockResolvedValue(latest());
    await useAppUpdateStore.getState().checkNow();
    expect(useAppUpdateStore.getState().status).toBe('available');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('手动点击撞上进行中的自动检查:加入并发且视为手动(不被「稍后再说」吞掉)', async () => {
    mockAsyncStorage.set('appUpdate.dismissedVersion', 'v1.0.7');
    let resolveFetch: ((v: ReturnType<typeof latest>) => void) | undefined;
    mockedFetch.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveFetch = resolve;
        }),
    );

    const auto = useAppUpdateStore.getState().checkNow();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    const joined = useAppUpdateStore.getState().checkNow({ manual: true });
    resolveFetch?.(latest());
    await Promise.all([auto, joined]);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe('available');
    // 关键: dismissed 记忆命中,但因为是手动检查,抑制必须不生效(强制可见)。
    expect(s.promptSuppressed).toBe(false);
  });

  it('forced + 404/不可判定 → 保持 forced 且 info 不丢(运维修行不得成为绕过通道)', async () => {
    mockedFetch.mockResolvedValue(latest({ force: true }));
    await useAppUpdateStore.getState().checkNow();
    expect(useAppUpdateStore.getState().status).toBe('forced');

    // 404:官网配置行被删/不可判 → null。Gate 的渲染条件是 forced && info,
    // info 一并保留,门不得卸载。
    mockedFetch.mockResolvedValue(null as never);
    await useAppUpdateStore.getState().checkNow();
    expect(useAppUpdateStore.getState().status).toBe('forced');
    expect(useAppUpdateStore.getState().info?.latestVersion).toBe('v1.0.7');

    // latest_version 非法格式(resolveUpdateDecision → null)同理粘滞。
    mockedFetch.mockResolvedValue({
      ...latest(),
      latestVersion: 'not-a-version',
    } as ReturnType<typeof latest>);
    await useAppUpdateStore.getState().checkNow({ manual: true });
    expect(useAppUpdateStore.getState().status).toBe('forced');
    expect(useAppUpdateStore.getState().info).not.toBeNull();
  });

  it('非 forced + 404 → 静默 upToDate 且 lastCheckDecided=false(没查成不说成已最新)', async () => {
    mockedFetch.mockResolvedValue(null as never);
    await useAppUpdateStore.getState().checkNow({ manual: true });
    const s = useAppUpdateStore.getState();
    expect(s.status).toBe('upToDate');
    expect(s.lastCheckDecided).toBe(false);

    // 真实比较做出的 upToDate 才算 decided(手动反馈据此区分两种文案)。
    mockVersionName = 'v1.0.7';
    mockedFetch.mockResolvedValue(latest({ version: 'v1.0.7' }));
    await useAppUpdateStore.getState().checkNow({ manual: true });
    expect(useAppUpdateStore.getState().lastCheckDecided).toBe(true);
  });
});
