import {
  getPlatformServiceBaseUrl,
  normalizeServiceBaseUrl,
  PLATFORM_SERVICE_CANDIDATES,
  rememberPlatformServiceBaseUrl,
} from '../config/localService';
import {
  isSessionInvalidError,
  refreshSession,
} from './sessionAuth';

const REQUEST_TIMEOUT_MS = 8000;

export class ApiResponseError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiResponseError';
    this.status = status;
    this.code = code;
  }
}

export type ApiFetchOptions = RequestInit & {
  timeoutMs?: number;
  /**
   * Internal: skip the refresh-then-retry path. Set on the refresh request
   * itself so a 401 from `/api/auth/refresh` can't recurse into another refresh.
   */
  skipRefreshRetry?: boolean;
};

// React Native's type definitions expose `Headers` but not the `HeadersInit`
// alias from the DOM lib, so declare a compatible union locally.
type HeadersInitLike = Record<string, string> | [string, string][] | Headers;

let authTokenProvider: (() => string | null | undefined) | null = null;

export function setApiAuthTokenProvider(provider: (() => string | null | undefined) | null) {
  authTokenProvider = provider;
}

export function getApiAuthToken() {
  return authTokenProvider?.() ?? null;
}

export function isUnauthorizedApiError(error: unknown) {
  return error instanceof ApiResponseError && (error.status === 401 || error.status === 403);
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const controller = new AbortController();
  const inputSignal = options.signal;
  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();

  if (inputSignal) {
    if (inputSignal.aborted) {
      controller.abort();
    } else {
      inputSignal.addEventListener('abort', abortFromCaller, { once: true });
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (didTimeout) {
      throw new Error(`Timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    inputSignal?.removeEventListener('abort', abortFromCaller);
  }

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
      // Ignore non-JSON responses.
    }
    throw new ApiResponseError(errorMessage, response.status, errorCode);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { headers: optionHeaders, timeoutMs, skipRefreshRetry, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...normalizeHeaders(optionHeaders),
  };
  const token = authTokenProvider?.();
  if (token && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  const requestOptions = {
    ...fetchOptions,
    headers
  };
  const preferred = await getPlatformServiceBaseUrl();
  const candidates = Array.from(
    new Set([preferred, ...PLATFORM_SERVICE_CANDIDATES].map(normalizeServiceBaseUrl)),
  );
  let lastError: unknown;

  // Try every candidate base URL. An ApiResponseError (an HTTP status)
  // propagates immediately to the retry wrapper below; a network error falls
  // through to the next candidate and only surfaces if all are unreachable.
  const runCandidates = async (): Promise<T> => {
    for (const baseUrl of candidates) {
      try {
        const payload = await requestJson<T>(baseUrl, path, requestOptions, timeoutMs);
        await rememberPlatformServiceBaseUrl(baseUrl);
        return payload;
      } catch (error) {
        if (error instanceof ApiResponseError) throw error;
        lastError = error;
      }
    }
    const detail = lastError instanceof Error ? lastError.message : 'unknown error';
    throw new Error(
      `Unable to reach platform service. Tried ${candidates.join(', ')}. ${detail}`,
    );
  };

  try {
    return await runCandidates();
  } catch (error) {
    // A session-invalid response (expired local session — e.g. the phone was
    // offline past the session TTL) is recoverable: rotate the refresh_token
    // once, which extends the session server-side, then retry the whole
    // request. The token value is stable across refresh, so the retry re-reads
    // the same (now-valid) token from the provider. `refreshSession` fires the
    // teardown itself when refresh fails, so here we just rethrow. The refresh
    // request sets `skipRefreshRetry` so a 401 from it can't recurse.
    if (skipRefreshRetry || !isSessionInvalidError(error)) throw error;
    const refreshed = await refreshSession();
    if (!refreshed) throw error;
    return runCandidates();
  }
}

export async function apiGet<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, method: 'GET' });
}

export async function apiPost<T = unknown>(path: string, body?: unknown, options: ApiFetchOptions = {}): Promise<T> {
  return apiFetch<T>(path, {
    ...options,
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined
  });
}

export async function apiPatch<T = unknown>(path: string, body?: unknown, options: ApiFetchOptions = {}): Promise<T> {
  return apiFetch<T>(path, {
    ...options,
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined
  });
}

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
