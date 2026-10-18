/**
 * apiFetch 超时语义(2026-10-18 审计 C3 守卫测试)。
 *
 * 审计实录:超时曾被当作"主机死"处理 —— ①markPlatformServiceUnreachable
 * 污染全局可达性(之后所有请求先付 /health 探测延迟);②同一个非幂等请求
 * (典型:?refresh=true 的 detail GET,server 侧是 12s agent RPC)被整段盲
 * 重发 = 双倍 agent 往返,家宽拥塞下自我加剧,失败链最长 ~32.5s。修复后:
 * 超时 = ApiTimeoutError 直接上抛;网络层错误才 mark + 重发。
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

import { apiGet, ApiTimeoutError } from '../client';
import {
  discoverReachableBaseUrl,
  markPlatformServiceUnreachable,
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
});

describe('apiFetch 超时语义(C3)', () => {
  it('超时 → ApiTimeoutError 上抛,不重发、不污染可达性标记', async () => {
    // fetch 挂起直到 abort:mock 必须监听 signal,否则 AbortController 对 mock
    // 无效、requestJson 永远等不到 fetch 的 rejection。
    fetchMock.mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('Aborted')),
          );
        }),
    );
    await expect(
      apiGet('/api/ai/sessions/s1?refresh=true', { timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(ApiTimeoutError);
    // 单次请求:没有把非幂等 refresh GET 盲重发。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 超时 ≠ 主机死:不许 mark。
    expect(markPlatformServiceUnreachable).not.toHaveBeenCalled();
    // discover 只发生一次(初始 resolveBaseUrl),没有超时后的二次发现。
    expect(discoverReachableBaseUrl).toHaveBeenCalledTimes(1);
  });

  it('网络层错误仍走 mark + 重发一次的既有恢复语义(防修复回归)', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(okResponse({ ok: 1 }));
    await expect(apiGet('/api/x')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(markPlatformServiceUnreachable).toHaveBeenCalledTimes(1);
    expect(discoverReachableBaseUrl).toHaveBeenCalledTimes(2);
  });
});
