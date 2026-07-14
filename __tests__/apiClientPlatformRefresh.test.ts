// Exercises apiFetch (client.ts) — the platform-service HTTP client — against a
// mocked localService so we can drive the refresh-then-retry wrapper without a
// real /health probe. Mirrors apiClientRefresh.test.ts (which covers
// accountFetch) so BOTH HTTP clients are pinned for the rotation + escalation
// contract.

jest.mock('../src/config/localService', () => ({
  isPlatformServiceReachable: () => true,
  getPlatformServiceBaseUrl: async () => 'https://platform.test',
  discoverReachableBaseUrl: async () => 'https://platform.test',
  markPlatformServiceUnreachable: jest.fn(),
  rememberPlatformServiceBaseUrl: jest.fn(),
  normalizeServiceBaseUrl: (url: string) => url.replace(/\/+$/, ''),
}));

import { apiFetch, setApiAuthTokenProvider } from '../src/api/client';
import {
  setSessionRefresher,
  setSessionInvalidationHandler,
  __resetSessionAuthHubForTest,
} from '../src/api/sessionAuth';

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(JSON.stringify(body)),
  json: () => Promise.resolve(body),
});

describe('apiFetch refresh-then-retry', () => {
  let fetchMock: jest.Mock;
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;

  beforeEach(() => {
    __resetSessionAuthHubForTest();
    setSessionInvalidationHandler(() => {});
    setApiAuthTokenProvider(null);
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    setApiAuthTokenProvider(null);
    (globalThis as { fetch: unknown }).fetch = originalFetch;
  });

  it('rebuilds Authorization with the rotated token on retry (soft-expiry recovery)', async () => {
    let currentToken = 'T_OLD';
    setApiAuthTokenProvider(() => currentToken);
    const refresher = jest.fn(async () => {
      currentToken = 'T_NEW';
      return true;
    });
    setSessionRefresher(refresher);
    fetchMock.mockImplementation(async (_url: unknown, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>)?.Authorization ?? '';
      if (auth === 'Bearer T_OLD') {
        return jsonResponse(401, { error: 'authentication_required' });
      }
      if (auth === 'Bearer T_NEW') {
        return jsonResponse(200, { ok: true });
      }
      throw new Error(`unexpected Authorization header: ${auth}`);
    });

    const result = await apiFetch<{ ok: boolean }>('/api/test');

    expect(result).toEqual({ ok: true });
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it('escalates to session-invalidation when the post-refresh retry still fails auth', async () => {
    setApiAuthTokenProvider(() => 'T_WHATEVER');
    const refresher = jest.fn(async () => true);
    setSessionRefresher(refresher);
    const invalidation = jest.fn();
    setSessionInvalidationHandler(invalidation);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'authentication_required' }));

    await expect(apiFetch('/api/test')).rejects.toThrow();
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(invalidation).toHaveBeenCalledTimes(1);
  });
});
