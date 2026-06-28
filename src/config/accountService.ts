export const ALIANG_ACCOUNT_BASE_URL = 'https://www.aliang.one';

/**
 * The Go backend (official-website API) base. Scan-login's `/auth/scan/*`
 * endpoints live HERE, not on the www frontend — www (Next.js) only proxies
 * `/api/*`; `/auth/scan/*` falls through to a Next.js page (HTML). The phone's
 * access_token vault is in this same Go DB (www's `/api/*` is proxied to it),
 * so authenticating + scanning against this base works.
 */
export const ALIANG_API_BASE_URL = 'https://backend.aliang.one';

export function normalizeAccountBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}
