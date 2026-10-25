// Locks the platform-service URL source of truth to the dual-channel model.
//
// Regression context: an earlier version cached the resolved host in
// AsyncStorage and raced multiple local candidates on every request. A stale
// http://127.0.0.1:4000 survived every config edit — discoverReachableBaseUrl
// re-inserted the cached "preferred" host as the first candidate and the local
// probe won the race, so changing the config had no effect. Dual-channel keeps
// the candidate table a compile-time constant; AsyncStorage stores ONLY the
// tie-break prior ('primary' | 'nat0'). The ghost mock below proves a stale
// non-channel value still can't steer traffic.
//
// These tests lock: (a) the config constants stay the only hardcoded hosts,
// (b) selection = real dual-channel probe + 30% hysteresis + prior only on a
// tie, (c) failure-driven channel flip and its reset-on-success semantics.

// AsyncStorage is mocked to return the exact ghost address that used to haunt
// this flow. If anyone reintroduces a persisted-host cache, this mock makes the
// regression test fail loudly instead of silently reviving 127.0.0.1:4000.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('http://127.0.0.1:4000'),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const fetchMock = jest.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PLATFORM_SERVICE_BASE_URL,
  getPlatformServiceBaseUrl,
  getActiveEndpointId,
  discoverReachableBaseUrl,
  isPlatformServiceReachable,
  markPlatformServiceUnreachable,
  rememberPlatformServiceBaseUrl,
  reportChannelFailure,
  __stopBackgroundReprobeForTests,
} from '../src/config/localService';

const NAT0_BASE_URL = 'https://ws-vb-phone.nat.aliang.one:16749';
const PRIOR_STORAGE_KEY = 'nat.channel.prior';

const delay = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

/**
 * 按通道注入 /health 探测延迟:'fail' = 该通道探测即拒(与超时走同一条
 * 样本作废路径,免去 3s×2 样本的真实等待)。缺省 0ms 立即 200。
 */
function mockHealthByChannel(spec: {
  primary?: number | 'fail';
  nat0?: number | 'fail';
}): void {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const isNat0 = String(input).includes('nat.aliang.one');
    const channel = isNat0 ? spec.nat0 : spec.primary;
    if (channel === 'fail') throw new Error('probe failed');
    await delay(channel ?? 0);
    return { ok: true, status: 200 };
  });
}

function resetMocks(): void {
  fetchMock.mockReset();
  // 逐测试重建幽灵回归哨兵:getItem 默认永远吐 127.0.0.1:4000,
  // 非通道值不得影响任何选择;单测可用 mockResolvedValueOnce 覆盖一次。
  jest
    .mocked(AsyncStorage.getItem)
    .mockReset()
    .mockResolvedValue('http://127.0.0.1:4000');
  jest.mocked(AsyncStorage.setItem).mockClear();
  markPlatformServiceUnreachable();
}

describe('platform service base url — single source of truth', () => {
  beforeEach(resetMocks);

  afterEach(() => {
    // discoverReachableBaseUrl 会挂 10 分钟后台重探定时器,
    // 不清理 jest 会报 open handle。
    __stopBackgroundReprobeForTests();
  });

  it('the single config is the remote host, never a local address', () => {
    expect(PLATFORM_SERVICE_BASE_URL).toBe('https://ws-vb-phone.aliang.one');
    expect(PLATFORM_SERVICE_BASE_URL).not.toContain('127.0.0.1');
  });

  it('getPlatformServiceBaseUrl always returns the single config, ignoring any stale cache', async () => {
    // AsyncStorage is mocked to hand back a stale 127.0.0.1:4000; the config
    // constant must win regardless.
    await expect(getPlatformServiceBaseUrl()).resolves.toBe(PLATFORM_SERVICE_BASE_URL);
    await expect(getPlatformServiceBaseUrl()).resolves.toBe(PLATFORM_SERVICE_BASE_URL);
  });

  it('discoverReachableBaseUrl probes the config host and returns it on 200', async () => {
    // 双通道语义:primary 快 30% 以上(primary 0ms vs nat0 120ms)时必选 primary。
    mockHealthByChannel({ primary: 0, nat0: 120 });

    const url = await discoverReachableBaseUrl();

    expect(url).toBe(PLATFORM_SERVICE_BASE_URL);
    expect(fetchMock).toHaveBeenCalledWith(
      `${PLATFORM_SERVICE_BASE_URL}/health`,
      { method: 'GET' },
    );
    expect(isPlatformServiceReachable()).toBe(true);
  });

  it('discoverReachableBaseUrl throws and marks unreachable when the host is down', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(discoverReachableBaseUrl()).rejects.toThrow(/Unable to reach/);
    expect(isPlatformServiceReachable()).toBe(false);
  });
});

describe('双通道探测与选择', () => {
  beforeEach(resetMocks);

  afterEach(() => {
    __stopBackgroundReprobeForTests();
  });

  it('双通道均成功且 nat0 更快 30%+ → 选 nat0,先验落盘 nat0', async () => {
    mockHealthByChannel({ primary: 120, nat0: 0 });

    const url = await discoverReachableBaseUrl();

    expect(url).toBe(NAT0_BASE_URL);
    await expect(getPlatformServiceBaseUrl()).resolves.toBe(NAT0_BASE_URL);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(PRIOR_STORAGE_KEY, 'nat0');
    expect(isPlatformServiceReachable()).toBe(true);
  });

  it('primary 更快 30%+ → 保持 primary', async () => {
    mockHealthByChannel({ primary: 0, nat0: 120 });

    const url = await discoverReachableBaseUrl();

    expect(url).toBe(PLATFORM_SERVICE_BASE_URL);
    await expect(getPlatformServiceBaseUrl()).resolves.toBe(PLATFORM_SERVICE_BASE_URL);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(PRIOR_STORAGE_KEY, 'primary');
  });

  it('nat0 探测全失败(超时/拒绝同一作废路径)→ 回 primary 且不抛错', async () => {
    mockHealthByChannel({ primary: 0, nat0: 'fail' });

    const url = await discoverReachableBaseUrl();

    expect(url).toBe(PLATFORM_SERVICE_BASE_URL);
    await expect(getPlatformServiceBaseUrl()).resolves.toBe(PLATFORM_SERVICE_BASE_URL);
  });

  it('双通道均不可达 → throw /Unable to reach/ 且标记不可达', async () => {
    mockHealthByChannel({ primary: 'fail', nat0: 'fail' });

    await expect(discoverReachableBaseUrl()).rejects.toThrow(/Unable to reach/);
    expect(isPlatformServiceReachable()).toBe(false);
  });

  it('平手(30% 滞回带内)→ 用 AsyncStorage 先验裁决:存 nat0 则选 nat0', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('nat0');
    mockHealthByChannel({ primary: 40, nat0: 40 });

    const url = await discoverReachableBaseUrl();

    expect(url).toBe(NAT0_BASE_URL);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(PRIOR_STORAGE_KEY, 'nat0');
  });

  it('连续 3 次 reportChannelFailure → 翻转通道,getPlatformServiceBaseUrl 立即返回新通道', async () => {
    // 先清零失败计数,隔离 beforeEach 里 markPlatformServiceUnreachable 的 +1。
    await rememberPlatformServiceBaseUrl('warmup');
    const before = getActiveEndpointId();

    reportChannelFailure();
    reportChannelFailure();
    expect(getActiveEndpointId()).toBe(before); // 2 次不翻

    reportChannelFailure();
    expect(getActiveEndpointId()).not.toBe(before); // 第 3 次翻转

    const urlAfterFlip = before === 'nat0' ? PLATFORM_SERVICE_BASE_URL : NAT0_BASE_URL;
    await expect(getPlatformServiceBaseUrl()).resolves.toBe(urlAfterFlip);
  });

  it('成功上报清零失败计数:2 败 + 1 成功 + 2 败 → 不切换', async () => {
    await rememberPlatformServiceBaseUrl('warmup');
    const before = getActiveEndpointId();

    reportChannelFailure();
    reportChannelFailure();
    await rememberPlatformServiceBaseUrl('any');
    reportChannelFailure();
    reportChannelFailure();

    expect(getActiveEndpointId()).toBe(before);
    const urlUnchanged = before === 'nat0' ? NAT0_BASE_URL : PLATFORM_SERVICE_BASE_URL;
    await expect(getPlatformServiceBaseUrl()).resolves.toBe(urlUnchanged);
  });
});
