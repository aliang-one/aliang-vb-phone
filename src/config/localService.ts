import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const PLATFORM_SERVICE_STORAGE_KEY = 'aliang.platformServiceBaseUrl';
const DEFAULT_DESKTOP_HOST = '172.16.0.123';

export const LOCAL_SERVICE_HOST = DEFAULT_DESKTOP_HOST;
export const LOCAL_SERVICE_PORT = 5174;
export const PLATFORM_SERVICE_HOST = LOCAL_SERVICE_HOST;
export const PLATFORM_SERVICE_PORT = 4000;
export const LOCAL_SERVICE_BASE_URL = `http://${LOCAL_SERVICE_HOST}:${LOCAL_SERVICE_PORT}`;

export const PLATFORM_SERVICE_CANDIDATES = Array.from(
  new Set(
    [
      `http://127.0.0.1:${PLATFORM_SERVICE_PORT}`,
      Platform.OS === 'android'
        ? `http://10.0.2.2:${PLATFORM_SERVICE_PORT}`
        : undefined,
      `http://${PLATFORM_SERVICE_HOST}:${PLATFORM_SERVICE_PORT}`,
    ].filter(Boolean) as string[],
  ),
);

export const PLATFORM_SERVICE_BASE_URL = PLATFORM_SERVICE_CANDIDATES[0];
export const PLATFORM_SERVICE_WS_URL = toWebSocketUrl(PLATFORM_SERVICE_BASE_URL);

export interface PlatformServiceHealth {
  ok: boolean;
  status?: number;
  latencyMs: number;
  checkedAt: string;
  message: string;
  baseUrl: string;
}

const timeout = (ms: number) =>
  new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });

let resolvedPlatformServiceBaseUrl: string | null = null;

export function normalizeServiceBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function toWebSocketUrl(baseUrl: string): string {
  return normalizeServiceBaseUrl(baseUrl).replace(/^http/, 'ws');
}

export async function rememberPlatformServiceBaseUrl(
  baseUrl: string,
): Promise<void> {
  const normalized = normalizeServiceBaseUrl(baseUrl);
  resolvedPlatformServiceBaseUrl = normalized;
  try {
    await AsyncStorage.setItem(PLATFORM_SERVICE_STORAGE_KEY, normalized);
  } catch {
    // Cache misses should not block platform requests.
  }
}

export async function getPlatformServiceBaseUrl(): Promise<string> {
  if (resolvedPlatformServiceBaseUrl) {
    return resolvedPlatformServiceBaseUrl;
  }

  try {
    const saved = await AsyncStorage.getItem(PLATFORM_SERVICE_STORAGE_KEY);
    if (saved) {
      resolvedPlatformServiceBaseUrl = normalizeServiceBaseUrl(saved);
      return resolvedPlatformServiceBaseUrl;
    }
  } catch {
    // Fall through to the USB/localhost default.
  }

  return PLATFORM_SERVICE_BASE_URL;
}

async function probePlatformService(
  baseUrl: string,
  timeoutMs: number,
): Promise<PlatformServiceHealth> {
  const normalized = normalizeServiceBaseUrl(baseUrl);
  const startedAt = Date.now();
  const healthUrl = `${normalized}/health`;

  try {
    const response = await Promise.race([
      fetch(healthUrl, { method: 'GET' }),
      timeout(timeoutMs),
    ]);
    const latencyMs = Date.now() - startedAt;

    return {
      ok: response.ok,
      status: response.status,
      latencyMs,
      checkedAt: new Date().toLocaleTimeString(),
      baseUrl: normalized,
      message: response.ok
        ? `Connected to ${normalized}`
        : `Service responded with HTTP ${response.status}`,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    return {
      ok: false,
      latencyMs,
      checkedAt: new Date().toLocaleTimeString(),
      baseUrl: normalized,
      message:
        error instanceof Error
          ? error.message
          : `Unable to reach ${normalized}`,
    };
  }
}

export const checkPlatformService = async (
  timeoutMs = 5000,
): Promise<PlatformServiceHealth> => {
  const preferred = await getPlatformServiceBaseUrl();
  const candidates = Array.from(
    new Set([preferred, ...PLATFORM_SERVICE_CANDIDATES].map(normalizeServiceBaseUrl)),
  );
  let lastResult: PlatformServiceHealth | null = null;

  for (const baseUrl of candidates) {
    const result = await probePlatformService(baseUrl, timeoutMs);
    if (result.ok) {
      await rememberPlatformServiceBaseUrl(result.baseUrl);
      return result;
    }
    lastResult = result;
  }

  return lastResult ?? {
    ok: false,
    latencyMs: 0,
    checkedAt: new Date().toLocaleTimeString(),
    baseUrl: preferred,
    message: `Unable to reach platform service. Tried ${candidates.join(', ')}`,
  };
};
