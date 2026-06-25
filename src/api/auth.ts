import { accountGet, accountPost } from './accountClient';

export interface PlatformUser {
  id: string;
  username?: string;
  email: string;
  name: string;
  role: string;
}

export interface AuthSession {
  user: PlatformUser;
  token: string;
  /**
   * The sub2api refresh_token returned with the access/session token. The phone
   * rotates it via `/api/auth/refresh` to extend the local session past its
   * 24h TTL instead of forcing re-login. `null` when the server omits it
   * (degrades to the old no-refresh behavior).
   */
  refreshToken: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
    ? value as Record<string, unknown>
    : undefined;

const asString = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const unwrapData = (payload: unknown): Record<string, unknown> => {
  const root = asRecord(payload) ?? {};
  return asRecord(root.data) ?? root;
};

const extractUser = (payload: unknown): PlatformUser => {
  const root = asRecord(payload) ?? {};
  const data = unwrapData(payload);
  const rawUser = asRecord(data.user) ?? asRecord(root.user) ?? data;
  const id = asString(rawUser.id) ?? asString(rawUser.user_id) ?? asString(rawUser.uid);
  const email = asString(rawUser.email) ?? '';
  const name =
    asString(rawUser.name) ??
    asString(rawUser.nickname) ??
    asString(rawUser.username) ??
    email;

  if (!id && !email) {
    throw new Error('Login succeeded but user profile is missing.');
  }

  return {
    id: id ?? email,
    username: asString(rawUser.username) ?? (email ? email.split('@')[0] : undefined),
    email,
    name,
    role: asString(rawUser.role) ?? 'user',
  };
};

const extractToken = (payload: unknown): string => {
  const root = asRecord(payload) ?? {};
  const data = unwrapData(payload);
  const token =
    asString(root.session_token) ??
    asString(root.access_token) ??
    asString(data.session_token) ??
    asString(data.access_token) ??
    asString(data.token);
  if (!token) {
    throw new Error('Login succeeded but access token is missing.');
  }
  return token;
};

// Lenient: the refresh_token is optional for forward-compat (its absence just
// disables refresh and falls back to the legacy re-login-on-expiry behavior).
const extractRefreshToken = (payload: unknown): string | null =>
  asString((asRecord(payload) ?? {}).refresh_token) ??
  asString(unwrapData(payload).refresh_token) ??
  null;

export const fetchCurrentUser = async (): Promise<PlatformUser> => {
  const payload = await accountGet<unknown>('/api/auth/me');
  return extractUser(payload);
};

export const login = (
  email: string,
  password: string,
): Promise<AuthSession> =>
  accountPost<unknown>('/api/auth/login', { email, password }).then(payload => ({
    user: extractUser(payload),
    token: extractToken(payload),
    refreshToken: extractRefreshToken(payload),
  }));

export interface RefreshedSession {
  /** Fresh access JWT (~24h TTL) replacing the stale one that triggered refresh. */
  token: string;
  /** Rotated sub2api refresh_token for the next rotation. */
  refreshToken: string;
}

/**
 * Rotate the session via the multi-device-safe refresh arbiter. The aliang SaaS
 * `/api/auth/refresh` response carries BOTH a fresh `access_token` (a new ~24h
 * JWT with an updated `token_version`) and a rotated `refresh_token`. Both must
 * be persisted: the access token is NOT stable across refresh — keeping the
 * stale one strands the app on the main screen, because the post-refresh retry
 * reuses the dead token and 401s again while refresh keeps looking "successful".
 *
 * Carries `skipRefreshRetry` so the refresh request itself can't recurse into
 * another refresh. Throws on a non-2xx / malformed response, or when either
 * token is missing — the caller treats that as a failed refresh.
 */
export const refreshSessionTokens = (
  refreshToken: string,
): Promise<RefreshedSession> =>
  accountPost<unknown>(
    '/api/auth/refresh',
    { refresh_token: refreshToken },
    { skipRefreshRetry: true },
  ).then(payload => {
    const root = asRecord(payload) ?? {};
    const data = unwrapData(payload);
    const accessToken =
      asString(root.access_token) ?? asString(data.access_token);
    const rotated =
      asString(root.refresh_token) ?? asString(data.refresh_token);
    if (!accessToken) {
      throw new Error('Refresh succeeded but no access_token was returned.');
    }
    if (!rotated) {
      throw new Error('Refresh succeeded but no refresh_token was returned.');
    }
    return { token: accessToken, refreshToken: rotated };
  });

// The Aliang SaaS backend uses stateless JWT auth, so sign-out is purely local:
// there is no server session to invalidate, and a network call would only 404.
export const logout = (): Promise<{ status: string }> =>
  Promise.resolve({ status: 'ok' });
