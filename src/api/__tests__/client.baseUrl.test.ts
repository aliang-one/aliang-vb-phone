/**
 * apiFetch 的显式 baseUrl 语义(P0-1 守卫测试)。
 *
 * 2026-10-09 对抗审计实录:apiFetch 曾不解构 baseUrl(静默落进 fetchOptions
 * 被原生 fetch 丢弃),跨域请求实际打到主平台服务器,404 又被调用方"未配置
 * →静默"防御吞掉——无声断裂。这里锁死修复行为:
 * ①显式 baseUrl 直连目标 host;
 * ②不触发主平台发现、不 remember/mark 平台 host 状态(双向不污染);
 * ③无 baseUrl 时主平台发现语义原样保留(防修复回归成"全网直连")。
 */
jest.mock('../../config/localService', () => ({
  discoverReachableBaseUrl: jest.fn(),
  getPlatformServiceBaseUrl: jest.fn(() => 'https://ws-vb-phone.aliang.one'),
  isPlatformServiceReachable: jest.fn(() => false),
  markPlatformServiceUnreachable: jest.fn(),
  rememberPlatformServiceBaseUrl: jest.fn(),
}));

jest.mock('../sessionAuth', () => ({
  isSessionInvalidError: jest.fn(() => false),
  notifySessionInvalidated: jest.fn(),
  refreshSession: jest.fn(),
}));

import { apiGet } from '../client';
import {
  discoverReachableBaseUrl,
  markPlatformServiceUnreachable,
  rememberPlatformServiceBaseUrl,
} from '../../config/localService';

const fetchMock = jest.fn();
const okResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  fetchMock.mockReset();
  (global as { fetch?: unknown }).fetch = fetchMock;
  jest
    .mocked(discoverReachableBaseUrl)
    .mockReset()
    .mockResolvedValue('https://ws-vb-phone.aliang.one');
  jest.mocked(markPlatformServiceUnreachable).mockClear();
  jest.mocked(rememberPlatformServiceBaseUrl).mockClear();
});

describe('apiFetch 显式 baseUrl', () => {
  it('直连目标 host:URL 正确、单次请求、零平台发现', async () => {
    fetchMock.mockResolvedValue(okResponse({ latest_version: 'v1.0.7' }));
    await apiGet('/api/public/downloads/check?platform=ios&version=v1.0.6&software=aliang-vibe-phone', {
      baseUrl: 'https://www.aliang.one',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://www.aliang.one/api/public/downloads/check?platform=ios&version=v1.0.6&software=aliang-vibe-phone',
    );
    expect(discoverReachableBaseUrl).not.toHaveBeenCalled();
  });

  it('不污染平台 host 状态:成功不 remember、网络失败不 mark', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network dead'));
    await expect(
      apiGet('/api/public/downloads/check', { baseUrl: 'https://www.aliang.one' }),
    ).rejects.toThrow('network dead');
    expect(rememberPlatformServiceBaseUrl).not.toHaveBeenCalled();
    expect(markPlatformServiceUnreachable).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(okResponse({ ok: true }));
    await apiGet('/api/public/downloads/check', { baseUrl: 'https://www.aliang.one' });
    expect(rememberPlatformServiceBaseUrl).not.toHaveBeenCalled();
  });

  it('无 baseUrl 时主平台发现语义原样保留(对照)', async () => {
    fetchMock.mockResolvedValue(okResponse({ ok: true }));
    await apiGet('/api/ping');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ws-vb-phone.aliang.one/api/ping');
    expect(rememberPlatformServiceBaseUrl).toHaveBeenCalledWith(
      'https://ws-vb-phone.aliang.one',
    );
  });
});
