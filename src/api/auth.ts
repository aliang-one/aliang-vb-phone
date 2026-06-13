import { apiFetch } from './client';

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token?: string;
  session_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  user?: Partial<PlatformUser>;
}

export const loginWithPassword = (input: LoginInput): Promise<LoginResponse> =>
  apiFetch<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
    skipAuth: true,
  });

export const fetchCurrentUser = (): Promise<PlatformUser> =>
  apiFetch<PlatformUser>('/api/me', { method: 'GET' });

export function normalizePlatformUser(raw: Partial<PlatformUser> | undefined, fallbackEmail: string): PlatformUser {
  const id = String(raw?.id || raw?.email || fallbackEmail);
  const email = String(raw?.email || fallbackEmail);
  const name = String(raw?.name || email);
  const role = String(raw?.role || 'user');

  return {
    id,
    email,
    name,
    role,
  };
}
