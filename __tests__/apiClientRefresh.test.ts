import { accountFetch } from '../src/api/accountClient';
import {
  setSessionRefresher,
  setSessionInvalidationHandler,
  __resetSessionAuthHubForTest,
} from '../src/api/sessionAuth';

// accountFetch exercises the same refresh-then-retry wrapper as apiFetch, but
// against a static candidate list + global fetch, so it is the cleanest place
// to verify the retry behaviour without standing up the platform-service config.

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(JSON.stringify(body)),
  json: () => Promise.resolve(body),
});

describe('accountFetch refresh-then-retry', () => {
  let fetchMock: jest.Mock;
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;

  beforeEach(() => {
    __resetSessionAuthHubForTest();
    setSessionInvalidationHandler(() => {});
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
  });

  it('retries once and succeeds after a refresh when the first call is session-invalid', async () => {
    const refresher = jest.fn(() => Promise.resolve(true));
    setSessionRefresher(refresher);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'authentication_required' }))
      .mockResolvedValueOnce(jsonResponse(200, { hello: 'world' }));

    const result = await accountFetch<{ hello: string }>('/api/test');

    expect(result).toEqual({ hello: 'world' });
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + 1 retry
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it('throws (and does not retry) when the refresh fails', async () => {
    const refresher = jest.fn(() => Promise.resolve(false));
    setSessionRefresher(refresher);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'authentication_required' }));

    await expect(accountFetch('/api/test')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry after failed refresh
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it('does not attempt a refresh on a non-auth HTTP error', async () => {
    const refresher = jest.fn(() => Promise.resolve(true));
    setSessionRefresher(refresher);
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'server_error' }));

    await expect(accountFetch('/api/test')).rejects.toThrow();
    expect(refresher).not.toHaveBeenCalled();
  });

  it('does not attempt a refresh when skipRefreshRetry is set (no recursion)', async () => {
    const refresher = jest.fn(() => Promise.resolve(true));
    setSessionRefresher(refresher);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'authentication_required' }));

    await expect(
      accountFetch('/api/auth/refresh', { method: 'POST', skipRefreshRetry: true }),
    ).rejects.toThrow();
    expect(refresher).not.toHaveBeenCalled();
  });

  it('de-dupes concurrent session-invalid calls into one refresh', async () => {
    // Deferred created up front so the refresher can return a promise we
    // control; the refresh hub only calls it once even with two racing calls.
    let resolveRefresh!: (value: boolean) => void;
    const refreshPromise = new Promise<boolean>(resolve => {
      resolveRefresh = resolve;
    });
    const refresher = jest.fn(() => refreshPromise);
    setSessionRefresher(refresher);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'authentication_required' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'authentication_required' }));
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    const a = accountFetch('/api/a');
    const b = accountFetch('/api/b');
    // Let both calls advance through their 401s into the (single) refresh.
    await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    expect(refresher).toHaveBeenCalledTimes(1);
    resolveRefresh(true);
    await expect(a).resolves.toEqual({ ok: true });
    await expect(b).resolves.toEqual({ ok: true });
  });
});
