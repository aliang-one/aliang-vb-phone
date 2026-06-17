export const ALIANG_ACCOUNT_BASE_URL = 'https://www.aliang.one';

export function normalizeAccountBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}
