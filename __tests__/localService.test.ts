// Locks the platform-service base URL to a SINGLE config constant.
//
// Regression context: an earlier version cached the resolved host in
// AsyncStorage and raced multiple local candidates on every request. A stale
// http://127.0.0.1:4000 survived every config edit — discoverReachableBaseUrl
// re-inserted the cached "preferred" host as the first candidate and the local
// probe won the race, so changing the config had no effect. These tests enforce
// that the config constant is the ONLY source of the base URL, for both HTTP
// and WebSocket callers.

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

import {
  PLATFORM_SERVICE_BASE_URL,
  getPlatformServiceBaseUrl,
  discoverReachableBaseUrl,
  isPlatformServiceReachable,
  markPlatformServiceUnreachable,
} from '../src/config/localService';

describe('platform service base url — single source of truth', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    markPlatformServiceUnreachable();
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

  it('discoverReachableBaseUrl probes the single config host and returns it on 200', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

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
