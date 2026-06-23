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
// Whether the resolved base URL has been confirmed reachable this session
// (via a /health probe or a successful request). Reset on network failure so
// the next call re-discovers instead of blocking on a dead host.
let platformServiceReachable = false;

export function isPlatformServiceReachable(): boolean {
  return platformServiceReachable;
}

// Mark the cached host unreachable (e.g. a request just failed with a network
// error). The next apiFetch will re-run discovery instead of reusing it.
export function markPlatformServiceUnreachable(): void {
  platformServiceReachable = false;
}

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

// Per-candidate probe timeout for discovery. Kept short (and parallel) so a
// dead platform service fails fast instead of blocking the UI for the full
// per-host request timeout on every candidate sequentially (~24s before).
const DISCOVERY_TIMEOUT_MS = 2500;

// Dependency-free Promise.any: resolves with the first fulfilled promise,
// rejects only when ALL reject. Avoids relying on Promise.any (ES2021) being
// available on every RN JS engine.
function anyResolve<T>(promises: Array<Promise<T>>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let pending = promises.length;
    if (pending === 0) {
      reject(new Error('no platform service candidates'));
      return;
    }
    promises.forEach(promise => {
      promise.then(resolve, () => {
        pending -= 1;
        if (pending === 0) {
          reject(new Error('all platform service candidates unreachable'));
        }
      });
    });
  });
}

// Probe ONE candidate's /health. Resolves to the base URL when reachable,
// rejects otherwise. GET /health is side-effect-free and unauthenticated, so
// it is safe to fire across every candidate in parallel.
async function probeHealth(baseUrl: string, timeoutMs: number): Promise<string> {
  const normalized = normalizeServiceBaseUrl(baseUrl);
  const response = await Promise.race([
    fetch(`${normalized}/health`, { method: 'GET' }),
    timeout(timeoutMs),
  ]);
  if (!response.ok) {
    throw new Error(`${normalized} responded HTTP ${response.status}`);
  }
  return normalized;
}

// Discover a reachable platform service by racing /health across every
// candidate IN PARALLEL. The fastest reachable host wins and is cached for
// subsequent calls. Throws a friendly "Unable to reach platform service"
// error if none respond — bounded by `timeoutMs` (default ~2.5s) rather than
// the old sequential per-host real-request timeout.
//
// This is discovery ONLY: the real (possibly POST) request is sent to the
// single winner afterwards by the caller, so non-idempotent requests are
// never fanned out to multiple hosts.
export async function discoverReachableBaseUrl(
  timeoutMs: number = DISCOVERY_TIMEOUT_MS,
): Promise<string> {
  const preferred = await getPlatformServiceBaseUrl();
  const candidates = Array.from(
    new Set([preferred, ...PLATFORM_SERVICE_CANDIDATES].map(normalizeServiceBaseUrl)),
  );
  try {
    const winner = await anyResolve(
      candidates.map(base => probeHealth(base, timeoutMs)),
    );
    await rememberPlatformServiceBaseUrl(winner);
    platformServiceReachable = true;
    return winner;
  } catch {
    platformServiceReachable = false;
    throw new Error(`Unable to reach platform service. Tried ${candidates.join(', ')}`);
  }
}
