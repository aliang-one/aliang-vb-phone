import {
  SessionExpiredError,
  isSessionInvalidError,
  decodeJwtExp,
  isJwtExpired,
  isAuthRejectionClose,
  setSessionInvalidationHandler,
  notifySessionInvalidated,
  setSessionRefresher,
  refreshSession,
  __resetSessionAuthHubForTest,
} from '../src/api/sessionAuth';

// Minimal ambient declaration: Buffer exists under the jest/node test runtime,
// but @types/node isn't installed in this RN project. Scoped to this test file.
declare const Buffer: {
  from(input: string, encoding?: string): { toString(encoding: string): string };
};

// Mirrors ApiResponseError's shape without importing it (the module duck-types
// it, so this is the exact contract it must recognise).
function apiError(status: number, message: string, code?: string) {
  const error = new Error(message);
  Object.assign(error, { name: 'ApiResponseError', status, code });
  return error;
}

function makeJwt(payload: Record<string, unknown>): string {
  // header.payload.signature — only payload matters here; signature is a dummy.
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('isSessionInvalidError', () => {
  it('treats 401 and 403 as invalid', () => {
    expect(isSessionInvalidError(apiError(401, 'no'))).toBe(true);
    expect(isSessionInvalidError(apiError(403, 'no'))).toBe(true);
  });

  it('treats 404 / 500 as transient (not invalid)', () => {
    expect(isSessionInvalidError(apiError(404, 'missing'))).toBe(false);
    expect(isSessionInvalidError(apiError(500, 'boom'))).toBe(false);
  });

  it('recognises the aliang "Invalid token" message body even on non-401 status', () => {
    // The reported error: GET /api/auth/me -> "Invalid token"
    expect(isSessionInvalidError(apiError(401, 'GET .../api/auth/me: Invalid token'))).toBe(true);
    // Defensive: some gateways return 400/200-style bodies with the same text.
    expect(isSessionInvalidError(apiError(400, 'Invalid token'))).toBe(true);
  });

  it('recognises known server auth error codes', () => {
    expect(isSessionInvalidError(apiError(401, 'x', 'invalid_user_token'))).toBe(true);
    expect(isSessionInvalidError(apiError(401, 'x', 'invalid_device_token'))).toBe(true);
    expect(isSessionInvalidError(apiError(401, 'x', 'auth_expired'))).toBe(true);
    expect(isSessionInvalidError(apiError(401, 'x', 'authentication_required'))).toBe(true);
  });

  it('recognises our own SessionExpiredError', () => {
    expect(isSessionInvalidError(new SessionExpiredError())).toBe(true);
  });

  it('returns false for unrelated errors and non-errors', () => {
    expect(isSessionInvalidError(new Error('network down'))).toBe(false);
    expect(isSessionInvalidError({})).toBe(false);
    expect(isSessionInvalidError(null)).toBe(false);
    expect(isSessionInvalidError(undefined)).toBe(false);
    expect(isSessionInvalidError('Invalid token')).toBe(false);
  });
});

describe('decodeJwtExp', () => {
  it('decodes exp seconds -> epoch ms', () => {
    const expSeconds = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt({ exp: expSeconds, sub: 'u1' });
    expect(decodeJwtExp(token)).toBe(expSeconds * 1000);
  });

  it('returns undefined when there is no exp claim', () => {
    expect(decodeJwtExp(makeJwt({ sub: 'u1' }))).toBeUndefined();
  });

  it('returns undefined for non-JWT / garbage', () => {
    expect(decodeJwtExp('not-a-token')).toBeUndefined();
    expect(decodeJwtExp('onlyonepart')).toBeUndefined();
    expect(decodeJwtExp('')).toBeUndefined();
    expect(decodeJwtExp(null)).toBeUndefined();
    expect(decodeJwtExp(undefined)).toBeUndefined();
  });
});

describe('isJwtExpired', () => {
  it('is true when exp is in the past', () => {
    expect(isJwtExpired(Date.now() - 1000)).toBe(true);
  });

  it('is false when exp is in the future', () => {
    expect(isJwtExpired(Date.now() + 1000)).toBe(false);
  });

  it('honours a grace window', () => {
    const exp = Date.now() - 500; // expired 500ms ago
    expect(isJwtExpired(exp, 1000)).toBe(false); // within 1s grace
    expect(isJwtExpired(exp, 0)).toBe(true);
  });

  it('is false when exp is unknown (do not force logout on non-JWT tokens)', () => {
    expect(isJwtExpired(undefined)).toBe(false);
  });
});

describe('isAuthRejectionClose', () => {
  it('matches server auth-rejection reasons', () => {
    expect(isAuthRejectionClose(1008, 'invalid_user_token')).toBe(true);
    expect(isAuthRejectionClose(1008, 'auth_expired')).toBe(true);
    expect(isAuthRejectionClose(1008, 'invalid_device_token')).toBe(true);
    expect(isAuthRejectionClose(1008, 'authentication_required')).toBe(true);
  });

  it('does not match a normal client disconnect', () => {
    expect(isAuthRejectionClose(1000, 'client_disconnect')).toBe(false);
    expect(isAuthRejectionClose(1006, '')).toBe(false);
  });

  it('does not misclassify an unrelated 1008 policy close', () => {
    expect(isAuthRejectionClose(1008, 'message_too_big')).toBe(false);
  });
});

describe('invalidation hub', () => {
  beforeEach(() => __resetSessionAuthHubForTest());
  beforeAll(() => jest.useFakeTimers());
  afterAll(() => jest.useRealTimers());

  it('invokes the registered handler once per burst', () => {
    const handler = jest.fn();
    setSessionInvalidationHandler(handler);
    notifySessionInvalidated();
    notifySessionInvalidated();
    notifySessionInvalidated();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no handler is registered', () => {
    expect(() => notifySessionInvalidated()).not.toThrow();
  });

  it('fires again after the de-dupe window elapses', () => {
    const handler = jest.fn();
    setSessionInvalidationHandler(handler);
    notifySessionInvalidated();
    expect(handler).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2000);
    notifySessionInvalidated();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('refresh hub', () => {
  beforeEach(() => __resetSessionAuthHubForTest());

  it('returns true and does NOT tear down when the refresher succeeds', async () => {
    const teardown = jest.fn();
    setSessionInvalidationHandler(teardown);
    setSessionRefresher(() => Promise.resolve(true));
    await expect(refreshSession()).resolves.toBe(true);
    expect(teardown).not.toHaveBeenCalled();
  });

  it('fires teardown and returns false when the refresher returns false', async () => {
    const teardown = jest.fn();
    setSessionInvalidationHandler(teardown);
    setSessionRefresher(() => Promise.resolve(false));
    await expect(refreshSession()).resolves.toBe(false);
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('fires teardown and returns false when the refresher throws', async () => {
    const teardown = jest.fn();
    setSessionInvalidationHandler(teardown);
    setSessionRefresher(() => Promise.reject(new Error('network down')));
    await expect(refreshSession()).resolves.toBe(false);
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('fires teardown and returns false when no refresher is registered', async () => {
    const teardown = jest.fn();
    setSessionInvalidationHandler(teardown);
    await expect(refreshSession()).resolves.toBe(false);
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('de-dupes concurrent calls into a single refresh (same result for all)', async () => {
    let resolveRefresh!: (value: boolean) => void;
    const refresher = jest.fn(
      () => new Promise<boolean>(resolve => { resolveRefresh = resolve; }),
    );
    setSessionRefresher(refresher);

    const a = refreshSession();
    const b = refreshSession();
    const c = refreshSession();
    expect(refresher).toHaveBeenCalledTimes(1);

    resolveRefresh(true);
    await expect(Promise.all([a, b, c])).resolves.toEqual([true, true, true]);
  });

  it('runs a fresh refresh after the previous one settles (no sticky de-dupe)', async () => {
    const refresher = jest.fn(() => Promise.resolve(true));
    setSessionRefresher(refresher);
    await refreshSession();
    await refreshSession();
    expect(refresher).toHaveBeenCalledTimes(2);
  });
});
