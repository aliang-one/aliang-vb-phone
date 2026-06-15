import {
  ApiResponseError,
  getApiAuthToken,
  type ApiFetchOptions,
} from './client';
import {
  ALIANG_ACCOUNT_BASE_URL,
  normalizeAccountBaseUrl,
} from '../config/accountService';

const REQUEST_TIMEOUT_MS = 10000;
const ACCOUNT_BASE_URL_CANDIDATES = [
  normalizeAccountBaseUrl(ALIANG_ACCOUNT_BASE_URL),
  'https://www.aliang.one',
];

type HeadersInitLike = Record<string, string> | [string, string][] | Headers;

const timeout = (ms: number) =>
  new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });

function normalizeHeaders(headers?: HeadersInitLike): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((result, [key, value]) => {
      result[key] = value;
      return result;
    }, {});
  }
  return headers as Record<string, string>;
}

export async function accountFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { headers: optionHeaders, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...normalizeHeaders(optionHeaders),
  };
  const token = getApiAuthToken();
  if (token && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  let lastError: unknown;

  for (const baseUrl of ACCOUNT_BASE_URL_CANDIDATES) {
    try {
      const url = `${baseUrl}${path}`;
      const response = await Promise.race([
        fetch(url, { ...fetchOptions, headers }),
        timeout(REQUEST_TIMEOUT_MS),
      ]);

      if (!response.ok) {
        let errorMessage = `Request failed with HTTP ${response.status}`;
        let errorCode: string | undefined;
        try {
          const payload = await response.json();
          if (typeof payload?.error === 'string') {
            errorMessage = payload.error;
            errorCode = payload.error;
          } else if (typeof payload?.message === 'string') {
            errorMessage = payload.message;
          }
        } catch {
          // Keep the generic HTTP error for non-JSON responses.
        }
        throw new ApiResponseError(errorMessage, response.status, errorCode);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (error) {
      if (error instanceof ApiResponseError) {
        throw error;
      }
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : 'unknown error';
  throw new Error(
    `Unable to reach aliang.one. Tried ${ACCOUNT_BASE_URL_CANDIDATES.join(', ')}. ${detail}`,
  );
}

export const accountGet = <T = unknown>(path: string, options: ApiFetchOptions = {}) =>
  accountFetch<T>(path, { ...options, method: 'GET' });

export const accountPost = <T = unknown>(
  path: string,
  body?: unknown,
  options: ApiFetchOptions = {},
) =>
  accountFetch<T>(path, {
    ...options,
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
