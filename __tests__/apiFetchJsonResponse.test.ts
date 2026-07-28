/**
 * Guards the success-path JSON parse in `requestJson`.
 *
 * When a platform-service host (or an intermediary proxy/CDN) returns HTTP 200
 * with a NON-JSON body — a 502 gateway HTML page, a truncated response, an empty
 * body that isn't 204 — the raw `JSON.parse(text)` used to throw `SyntaxError`.
 * That is NOT an `ApiResponseError`, so `apiFetch`'s recovery path mistook it
 * for a dead host: it marked the reachable host unreachable and re-discovered.
 * Worse, any caller without its own catch turned it into an unhandled rejection
 * → Hermes red screen. The parse must yield an `ApiResponseError` so it flows
 * through the same channel as every other bad-response case.
 */
import { apiFetch, ApiResponseError, setApiAuthTokenProvider } from '../src/api/client';

// Stub the platform-service URL discovery so apiFetch sends to a fixed host
// without doing real /health probes — the unit under test is response parsing.
jest.mock('../src/config/localService', () => ({
  isPlatformServiceReachable: () => true,
  getPlatformServiceBaseUrl: () => 'http://test.local',
  discoverReachableBaseUrl: () => 'http://test.local',
  rememberPlatformServiceBaseUrl: () => Promise.resolve(),
  markPlatformServiceUnreachable: () => {},
}));

const originalFetch = (globalThis as { fetch?: unknown }).fetch;

describe('apiFetch non-JSON 200 response', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    setApiAuthTokenProvider(null);
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    setApiAuthTokenProvider(null);
    (globalThis as { fetch: unknown }).fetch = originalFetch;
  });

  it('rejects with ApiResponseError (not raw SyntaxError) when a 200 body is not JSON', async () => {
    // Proxy returned 200 with an HTML error page.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html>502 Bad Gateway</html>'),
    });

    const error = await apiFetch('/anything').catch(e => e);

    expect(error).toBeInstanceOf(ApiResponseError);
    expect((error as ApiResponseError).status).toBe(200);
  });

  it('still parses a valid JSON 200 body unchanged', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ ok: true, value: 42 })),
    });

    await expect(apiFetch<{ value: number }>('/x')).resolves.toEqual({
      ok: true,
      value: 42,
    });
  });
});
