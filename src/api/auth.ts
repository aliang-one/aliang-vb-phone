import { apiFetch } from './client';

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

export const fetchCurrentUser = (): Promise<PlatformUser> =>
  apiFetch<PlatformUser>('/api/me', { method: 'GET' });

export const login = (
  username: string,
  password: string,
): Promise<AuthSession> =>
  apiFetch<AuthSession>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

export const logout = (): Promise<{ status: string }> =>
  apiFetch<{ status: string }>('/api/auth/logout', { method: 'POST' });
