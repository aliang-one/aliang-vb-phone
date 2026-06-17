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
  }));

// The Aliang SaaS backend uses stateless JWT auth, so sign-out is purely local:
// there is no server session to invalidate, and a network call would only 404.
export const logout = (): Promise<{ status: string }> =>
  Promise.resolve({ status: 'ok' });
