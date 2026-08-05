import {
  ApiResponseError,
  getApiAuthToken,
  type ApiFetchOptions,
} from './client';
import {
  ALIANG_ACCOUNT_BASE_URL,
  normalizeAccountBaseUrl,
} from '../config/accountService';
import {
  isSessionInvalidError,
  notifySessionInvalidated,
  refreshSession,
} from './sessionAuth';

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
  const { headers: optionHeaders, skipRefreshRetry, baseUrl, ...fetchOptions } = options;
  // Build headers FRESH per runCandidates call: the access token is NOT stable
  // across a refresh — refreshSession rotates it in the store — so a retry must
  // re-read the provider. Capturing the token once and reusing the headers on
  // the post-refresh retry sends the now-dead token, which 401s again and
  // strands the app "logged in but no data" instead of recovering.
  const buildHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...normalizeHeaders(optionHeaders),
    };
    const token = getApiAuthToken();
    if (token && !headers.Authorization && !headers.authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };
  let lastError: unknown;

  // An explicit baseUrl overrides the candidate list (scan-login targets the Go
  // backend directly, which isn't proxied by the www frontend). Otherwise try
  // each candidate base URL; an ApiResponseError propagates immediately to the
  // retry wrapper, a network error falls through to the next candidate.
  const baseCandidates = baseUrl
    ? [normalizeAccountBaseUrl(baseUrl)]
    : ACCOUNT_BASE_URL_CANDIDATES;
  const runCandidates = async (): Promise<T> => {
    const headers = buildHeaders();
    for (const candidate of baseCandidates) {
      try {
        const url = `${candidate}${path}`;
        const response = await Promise.race([
          fetch(url, { ...fetchOptions, headers }),
          timeout(REQUEST_TIMEOUT_MS),
        ]);

        if (!response.ok) {
          let errorMessage = `${fetchOptions.method ?? 'GET'} ${url} failed with HTTP ${response.status}`;
          let errorCode: string | undefined;
          try {
            const payload = (await response.json()) as Record<string, unknown> | null;
            if (typeof payload?.error === 'string') {
              errorMessage = `${fetchOptions.method ?? 'GET'} ${url}: ${payload.error}`;
              errorCode = payload.error;
            } else if (typeof payload?.message === 'string') {
              errorMessage = `${fetchOptions.method ?? 'GET'} ${url}: ${payload.message}`;
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
        if (error instanceof ApiResponseError) throw error;
        lastError = error;
      }
    }

    const detail = lastError instanceof Error ? lastError.message : 'unknown error';
    throw new Error(
      `Unable to reach aliang.one. Tried ${ACCOUNT_BASE_URL_CANDIDATES.join(', ')}. ${detail}`,
    );
  };

  try {
    return await runCandidates();
  } catch (error) {
    // Recoverable session expiry: rotate the refresh_token once (extends the
    // session server-side and rotates the access token in the store), then retry
    // with the fresh token (runCandidates → buildHeaders re-reads the provider).
    // `refreshSession` tears down itself on failure; `skipRefreshRetry` (set by
    // the refresh request) prevents recursion.
    if (skipRefreshRetry || !isSessionInvalidError(error)) throw error;
    const refreshed = await refreshSession();
    if (!refreshed) throw error;
    try {
      return await runCandidates();
    } catch (retryError) {
      // Refresh succeeded but the retried request STILL failed auth → the
      // rotated token is also rejected (genuinely dead session / hard-expiry).
      // Tear down to Login instead of leaving the app stuck.
      if (isSessionInvalidError(retryError)) {
        notifySessionInvalidated();
      }
      throw retryError;
    }
  }
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
