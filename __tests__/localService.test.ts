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
  getChannelMode,
  getChannelStatus,
  setChannelMode,
  discoverReachableBaseUrl,
  isPlatformServiceReachable,
  rememberPlatformServiceBaseUrl,
  reportChannelFailure,
  __stopBackgroundReprobeForTests,
  __resetChannelStateForTests,
} from '../src/config/localService';

const NAT0_BASE_URL = 'https://ws-vb-phone.aliang.xin:40557';
const HK_BASE_URL = 'https://ws-vb-phone-hk.nat.aliang.one';
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
  hk?: number | 'fail';
}): void {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const u = String(input);
    const channel = u.includes('aliang.xin:40557')
      ? spec.nat0
      : u.includes('ws-vb-phone-hk.nat.aliang.one')
        ? spec.hk
        : spec.primary;
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
  // 注意:这里不再调 markPlatformServiceUnreachable()——它如今兼任通道
  // 失败计数,每测试 +1 会让第 3 个测试的 beforeEach 触发通道翻转 + 防横
  // 跳锁,把后面的择优断言搅成时区相关的烂泥。所有 reachable 断言都在
  // discover 之后读状态,不依赖测试前的标记复位。
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
  beforeEach(() => {
    resetMocks();
    __resetChannelStateForTests();
  });

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
    mockHealthByChannel({ primary: 'fail', nat0: 'fail', hk: 'fail' });

    await expect(discoverReachableBaseUrl()).rejects.toThrow(/Unable to reach/);
    expect(isPlatformServiceReachable()).toBe(false);
  });

  it('平手(30% 滞回带内)→ 用 AsyncStorage 先验裁决:存 nat0 则选 nat0', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('nat0');
    // 150ms 对称:滞回带是相对带宽(0.7×~1.43×),太短的延迟下 CI 一次
    // ~18ms 的不对称事件循环停顿就能把平手挤出带外。hk 同延迟:先验裁决。
    mockHealthByChannel({ primary: 150, nat0: 150, hk: 150 });

    const url = await discoverReachableBaseUrl();

    expect(url).toBe(NAT0_BASE_URL);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(PRIOR_STORAGE_KEY, 'nat0');
  });

  it('连续 3 次 reportChannelFailure → 翻转通道,getPlatformServiceBaseUrl 立即返回新通道', async () => {
    // 钉定起点为 primary(排除前序用例状态耦合),验证三通道循环翻转。
    mockHealthByChannel({ primary: 0, nat0: 120, hk: 'fail' });
    await discoverReachableBaseUrl();
    __stopBackgroundReprobeForTests();
    expect(getActiveEndpointId()).toBe('primary');

    reportChannelFailure();
    reportChannelFailure();
    reportChannelFailure();
    // 循环:primary → nat0;防横跳锁锁住 primary
    expect(getActiveEndpointId()).toBe('nat0');
    await expect(getPlatformServiceBaseUrl()).resolves.toBe(NAT0_BASE_URL);
  });

  it('成功上报清零失败计数:2 败 + 1 成功 + 2 败 → 不切换', async () => {
    // 钉定起点 primary,隔离前序用例状态。
    mockHealthByChannel({ primary: 0, nat0: 'fail', hk: 'fail' });
    await discoverReachableBaseUrl();
    __stopBackgroundReprobeForTests();
    await rememberPlatformServiceBaseUrl('warmup');
    const before = getActiveEndpointId();

    reportChannelFailure();
    reportChannelFailure();
    await rememberPlatformServiceBaseUrl('any');
    reportChannelFailure();
    reportChannelFailure();

    expect(getActiveEndpointId()).toBe('primary');
    await expect(getPlatformServiceBaseUrl()).resolves.toBe(PLATFORM_SERVICE_BASE_URL);
  });

  it('防横跳锁:故障切到 nat0 后,primary 探测快得多也不得立即切回', async () => {
    await rememberPlatformServiceBaseUrl('warmup');
    // 先把 activeId 钉到 primary(顺带清掉前序用例遗留的锁)。
    mockHealthByChannel({ primary: 0, nat0: 120 });
    await discoverReachableBaseUrl();
    expect(getActiveEndpointId()).toBe('primary');

    // 3 连败 → 切到 nat0,同时对 primary 上 5 分钟防横跳锁。
    reportChannelFailure();
    reportChannelFailure();
    reportChannelFailure();
    expect(getActiveEndpointId()).toBe('nat0');

    // primary 探测快得多(winner=primary),但锁内 effective 保持 nat0。
    mockHealthByChannel({ primary: 0, nat0: 120 });
    const url = await discoverReachableBaseUrl();
    expect(url).toBe(NAT0_BASE_URL);
    expect(getActiveEndpointId()).toBe('nat0');
  });

  it('防横跳锁过期后:重探让 primary 赢回(自包含前置)', async () => {
    // 自建前置:钉 primary → 3 连败切 nat0(对 primary 上 5 分钟锁)。
    mockHealthByChannel({ primary: 0, nat0: 120, hk: 'fail' });
    await discoverReachableBaseUrl();
    __stopBackgroundReprobeForTests();
    expect(getActiveEndpointId()).toBe('primary');
    reportChannelFailure();
    reportChannelFailure();
    reportChannelFailure();
    expect(getActiveEndpointId()).toBe('nat0');

    // 锁窗口内:primary 探测最快也不得切回(锁语义)。
    mockHealthByChannel({ primary: 0, nat0: 120, hk: 'fail' });
    const urlLocked = await discoverReachableBaseUrl();
    expect(urlLocked).toBe(NAT0_BASE_URL);
    expect(getActiveEndpointId()).toBe('nat0');

    // 把时钟推过 lockUntil(FLIP_LOCK_MS=5min,取 6min 余量)。
    // 用 spy 前捕获的真 Date.now 做偏移基点,保留 TTFB 真实差值
    // (primary 0ms vs nat0 120ms 的择优依据不受时钟平移影响)。
    const realDateNow = Date.now.bind(Date);
    const clockSpy = jest
      .spyOn(Date, 'now')
      .mockImplementation(() => realDateNow() + 6 * 60 * 1000);
    try {
      mockHealthByChannel({ primary: 0, nat0: 120, hk: 'fail' });
      const url = await discoverReachableBaseUrl();
      expect(url).toBe(PLATFORM_SERVICE_BASE_URL);
      expect(getActiveEndpointId()).toBe('primary');
    } finally {
      clockSpy.mockRestore();
    }
  });
});


/**
 * 通道模式用例专用:带内存 Map 的存储 mock——setChannelMode 写入后
 * getChannelMode 能读回(真实回环语义);未声明的 key 仍吐幽灵地址,
 * 保住 stale-host 哨兵。
 */
function useStorageMap(seed: Record<string, string> = {}): void {
  jest
    .mocked(AsyncStorage.getItem)
    .mockImplementation(
      async (key: string) => seed[key] ?? 'http://127.0.0.1:4000',
    );
  jest
    .mocked(AsyncStorage.setItem)
    .mockImplementation(async (key: string, value: string) => {
      seed[key] = value;
    });
}

describe('channel mode — auto/manual(线路面板语义)', () => {
  beforeEach(resetMocks);

  afterEach(() => {
    __stopBackgroundReprobeForTests();
  });

  it('手动模式:discover 不探测直接返回手选通道,3 连败不翻转', async () => {
    useStorageMap();
    await setChannelMode('manual', 'nat0');
    fetchMock.mockRejectedValue(new Error('manual 模式不该发起探测'));

    await expect(discoverReachableBaseUrl()).resolves.toBe(NAT0_BASE_URL);
    expect(fetchMock).not.toHaveBeenCalled();

    reportChannelFailure();
    reportChannelFailure();
    reportChannelFailure();
    expect(getActiveEndpointId()).toBe('nat0');
    await expect(getPlatformServiceBaseUrl()).resolves.toBe(NAT0_BASE_URL);
  });

  it('手动切回自动:恢复探测择优(nat0 快 30% 以上则选 nat0)', async () => {
    useStorageMap();
    await setChannelMode('manual', 'primary');
    await setChannelMode('auto');

    mockHealthByChannel({ primary: 120, nat0: 0 });
    const url = await discoverReachableBaseUrl();

    expect(url).toBe(NAT0_BASE_URL);
    expect(getActiveEndpointId()).toBe('nat0');
  });

  it('模式与手选通道都持久化', async () => {
    useStorageMap();
    await setChannelMode('manual', 'nat0');
    expect(jest.mocked(AsyncStorage.setItem)).toHaveBeenCalledWith(
      'nat.channel.mode',
      'manual',
    );
    expect(jest.mocked(AsyncStorage.setItem)).toHaveBeenCalledWith(
      'nat.channel.manual',
      'nat0',
    );

    await setChannelMode('auto');
    expect(jest.mocked(AsyncStorage.setItem)).toHaveBeenCalledWith(
      'nat.channel.mode',
      'auto',
    );
  });

  it('冷启动读取持久化的手动模式:不探测直接用', async () => {
    // 模块态此刻是 auto(上一测试收尾);冷启语义 = 每次从存储读模式。
    jest
      .mocked(AsyncStorage.getItem)
      .mockImplementation(async (key: string) => {
        if (key === 'nat.channel.mode') return 'manual';
        if (key === 'nat.channel.manual') return 'nat0';
        return 'http://127.0.0.1:4000';
      });
    fetchMock.mockRejectedValue(new Error('manual 冷启不该探测'));

    await expect(discoverReachableBaseUrl()).resolves.toBe(NAT0_BASE_URL);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getChannelStatus 返回双通道实时探测(面板展示用)', async () => {
    mockHealthByChannel({ primary: 0, nat0: 'fail' });

    const status = await getChannelStatus();

    expect(status.find(s => s.id === 'primary')?.ttfbMs).not.toBeNull();
    expect(status.find(s => s.id === 'nat0')?.ttfbMs).toBeNull();
  });
});
