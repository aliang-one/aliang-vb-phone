import { apiFetch } from './client';

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export const fetchCurrentUser = (): Promise<PlatformUser> =>
  apiFetch<PlatformUser>('/api/me', { method: 'GET' });
