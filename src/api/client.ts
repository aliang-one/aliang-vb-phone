import {
  getPlatformServiceBaseUrl,
  normalizeServiceBaseUrl,
  PLATFORM_SERVICE_CANDIDATES,
  rememberPlatformServiceBaseUrl,
} from '../config/localService';

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

export type ApiFetchOptions = RequestInit;

// React Native's type definitions expose `Headers` but not the `HeadersInit`
// alias from the DOM lib, so declare a compatible union locally.
type HeadersInitLike = Record<string, string> | [string, string][] | Headers;

export function isUnauthorizedApiError(error: unknown) {
  return error instanceof ApiResponseError && (error.status === 401 || error.status === 403);
}

const timeout = (ms: number) =>
  new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });

async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: RequestInit,
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const response = await Promise.race([
    fetch(url, options),
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
  const { headers: optionHeaders, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...normalizeHeaders(optionHeaders),
  };
  const requestOptions = {
    ...fetchOptions,
    headers
  };
  const preferred = await getPlatformServiceBaseUrl();
  const candidates = Array.from(
    new Set([preferred, ...PLATFORM_SERVICE_CANDIDATES].map(normalizeServiceBaseUrl)),
  );
  let lastError: unknown;

  for (const baseUrl of candidates) {
    try {
      const payload = await requestJson<T>(baseUrl, path, requestOptions);
      await rememberPlatformServiceBaseUrl(baseUrl);
      return payload;
    } catch (error) {
      if (error instanceof ApiResponseError) {
        throw error;
      }
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : 'unknown error';
  throw new Error(
    `Unable to reach platform service. Tried ${candidates.join(', ')}. ${detail}`,
  );
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
