export const ALIANG_ACCOUNT_BASE_URL = 'http://www.aliang.one';

export function normalizeAccountBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}
