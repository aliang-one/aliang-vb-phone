// 通道逃逸修复(2026-11-03)回归测试:
// 1) discover 不得清零 consecutiveFailures——否则 HTTP 失败计数永远够不到
//    翻转阈值,坏通道翻不出去(2026-11-02 nat0 钉死事故的逃逸缺口);
// 2) 数据面逐出:被翻离的通道在 TTL 内禁止在选举中连任,到期回归候选池。
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  discoverReachableBaseUrl,
  getActiveEndpointId,
  reportChannelFailure,
  __resetChannelStateForTests,
} from '../localService';

const fetchMock = jest.fn();

let fakeNow = 1_700_000_000_000;

const endpoointUrlById: Record<string, string> = {
  primary: 'https://ws-vb-phone.aliang.one',
  nat0: 'https://ws-vb-phone.aliang.xin:40557',
  hk: 'https://ws-vb-phone-hk.nat.aliang.one',
};

function urlHostOf(url: string): string {
  return url.replace(/^https:\/\//, '').replace(/\/health$/, '');
}

/** 让指定通道的 /health 探测 200,其余按 slowlist 判定(默认失败=null)。 */
function mockProbeReachable(reachable: string[], failing: string[] = []) {
  // 传入值是 base URL(与 localService 的 ENDPOINTS 同源),统一折算成 host 再比。
  const reachableHosts = reachable.map(urlHostOf);
  const failingHosts = failing.map(urlHostOf);
  fetchMock.mockImplementation((url: string) => {
    const host = urlHostOf(url);
    if (reachableHosts.includes(host)) {
      return Promise.resolve({ ok: true, status: 200 });
    }
    if (failingHosts.includes(host)) {
      return Promise.resolve({ ok: false, status: 502 });
    }
    return Promise.reject(new Error('probe unreachable'));
  });
}

describe('channel escape (2026-11-03 fixes)', () => {
  let dateNowSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    __resetChannelStateForTests();
    fetchMock.mockReset();
    (global as { fetch?: unknown }).fetch = fetchMock;
    fakeNow = 1_700_000_000_000;
    dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);
    await AsyncStorage.clear();
    // 先验钉 primary,避免依赖测试机的地理先验(Intl 时区)。
    await AsyncStorage.setItem('nat.channel.prior', 'primary');
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    __resetChannelStateForTests();
  });

  test('discover 不清零失败计数:两次失败+discover+一次失败 = 触发翻转', async () => {
    // 全部通道探测可达且近似同速:滞回带内由先验(primary)裁决。
    mockProbeReachable(Object.values(endpoointUrlById));

    reportChannelFailure();
    reportChannelFailure();
    expect(getActiveEndpointId()).toBe('primary');

    // 关键断言:discover 之后计数仍是 2——下一次失败必须翻转。
    // (修复前:discover 无条件清零,再失败也只是回到 1,永远翻不出去。)
    await expect(discoverReachableBaseUrl()).resolves.toBe(
      endpoointUrlById.primary,
    );
    expect(getActiveEndpointId()).toBe('primary');

    reportChannelFailure();
    expect(getActiveEndpointId()).toBe('nat0');
  });

  test('数据面逐出:被翻离通道 TTL 内不参与选举,到期回归', async () => {
    mockProbeReachable(Object.values(endpoointUrlById));

    // 3 连败:primary → nat0,primary 被逐出 10 分钟。
    reportChannelFailure();
    reportChannelFailure();
    reportChannelFailure();
    expect(getActiveEndpointId()).toBe('nat0');

    // 让 primary 成为探测冠军(修复前:假赢即可在锁过期后连任;修复后:
    // 逐出 TTL 内根本不进候选池)。滞回带内先验= primary 也会被池过滤挡住。
    await AsyncStorage.setItem('nat.channel.prior', 'primary');
    await expect(discoverReachableBaseUrl()).resolves.not.toBe(
      endpoointUrlById.primary,
    );
    expect(getActiveEndpointId()).not.toBe('primary');

    // TTL 到期:primary 回归候选池并可重新当选。
    fakeNow += 11 * 60 * 1000;
    await expect(discoverReachableBaseUrl()).resolves.toBe(
      endpoointUrlById.primary,
    );
    expect(getActiveEndpointId()).toBe('primary');
  });
});

