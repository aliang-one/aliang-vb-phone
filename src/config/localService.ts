// Platform service — single source of truth.
//
// All platform-service traffic — HTTP (client.ts), realtime WebSocket
// (websocket.ts) and STT WebSocket (sttSocket.ts) — targets ONE configured
// URL. Change PLATFORM_SERVICE_BASE_URL below and every request + socket
// reconnect picks it up. Nothing else needs editing.
//
// There is deliberately NO candidate list and NO persisted-host cache. An
// earlier version had both: AsyncStorage cached whichever local host last won
// a /health race, and discoverReachableBaseUrl() re-inserted that cached
// "preferred" host on every call. A stale http://127.0.0.1:4000 therefore
// survived every config edit — the local probe kept winning the race, so
// editing the config did nothing. Removing both is the fix: the config
// constant is the only source of the base URL.

// ---------------------------------------------------------------------------
// Local service (device-binding helper on port 5174) — separate concern.
// ---------------------------------------------------------------------------
const DEFAULT_DESKTOP_HOST = '172.16.0.123';
export const LOCAL_SERVICE_HOST = DEFAULT_DESKTOP_HOST;
export const LOCAL_SERVICE_PORT = 5174;
export const LOCAL_SERVICE_BASE_URL = `http://${LOCAL_SERVICE_HOST}:${LOCAL_SERVICE_PORT}`;

// ---------------------------------------------------------------------------
// Platform service — THE single config. Edit this one line to retarget.
// ---------------------------------------------------------------------------
export function normalizeServiceBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function toWebSocketUrl(baseUrl: string): string {
  return normalizeServiceBaseUrl(baseUrl).replace(/^http/, 'ws');
}

/** The one place to change where platform-service traffic goes. */
export const PLATFORM_SERVICE_BASE_URL = normalizeServiceBaseUrl(
  'https://ws-vb-phone.aliang.one',
);
export const PLATFORM_SERVICE_WS_URL = toWebSocketUrl(PLATFORM_SERVICE_BASE_URL);

export interface PlatformServiceHealth {
  ok: boolean;
  status?: number;
  latencyMs: number;
  checkedAt: string;
  message: string;
  baseUrl: string;
}

const DISCOVERY_TIMEOUT_MS = 2500;
const DEFAULT_CHECK_TIMEOUT_MS = 5000;

/** Race a promise against a timeout. Clears the timer when either side
 * settles (promise wins OR timeout wins) so Jest doesn't report an open
 * handle. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Session flag: confirmed reachable at least once this session so the HTTP
// client can skip re-probing /health on every request once the host answered.
let platformServiceReachable = false;

export function isPlatformServiceReachable(): boolean {
  return platformServiceReachable;
}

// Mark the host unreachable (a request just failed with a network error) so
// the next apiFetch re-probes instead of trusting the stale session flag.
export function markPlatformServiceUnreachable(): void {
  platformServiceReachable = false;
}

// Retained for the HTTP client's call site (client.ts marks a host reachable
// after a successful request). With a single fixed host there is nothing to
// cache, so this only flips the session flag.
export async function rememberPlatformServiceBaseUrl(
  _baseUrl: string,
): Promise<void> {
  platformServiceReachable = true;
}

/** Always the single config — no cache, no candidates, no AsyncStorage. */
export async function getPlatformServiceBaseUrl(): Promise<string> {
  return PLATFORM_SERVICE_BASE_URL;
}

async function probeHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const normalized = normalizeServiceBaseUrl(baseUrl);
  const response = await withTimeout(
    fetch(`${normalized}/health`, { method: 'GET' }),
    timeoutMs,
  );
  if (!response.ok) {
    throw new Error(`${normalized} responded HTTP ${response.status}`);
  }
}

async function probePlatformService(
  baseUrl: string,
  timeoutMs: number,
): Promise<PlatformServiceHealth> {
  const normalized = normalizeServiceBaseUrl(baseUrl);
  const startedAt = Date.now();
  try {
    const response = await withTimeout(
      fetch(`${normalized}/health`, { method: 'GET' }),
      timeoutMs,
    );
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
        error instanceof Error ? error.message : `Unable to reach ${normalized}`,
    };
  }
}

/**
 * Probe the single configured host. Resolves to PLATFORM_SERVICE_BASE_URL when
 * it answers /health; throws a friendly "Unable to reach" error otherwise.
 * Bounded by `timeoutMs` (default ~2.5s).
 */
export async function discoverReachableBaseUrl(
  timeoutMs: number = DISCOVERY_TIMEOUT_MS,
): Promise<string> {
  try {
    await probeHealth(PLATFORM_SERVICE_BASE_URL, timeoutMs);
    platformServiceReachable = true;
    return PLATFORM_SERVICE_BASE_URL;
  } catch {
    platformServiceReachable = false;
    throw new Error(`Unable to reach platform service at ${PLATFORM_SERVICE_BASE_URL}`);
  }
}

/** Connectivity check for the single host (diagnostics use). */
export const checkPlatformService = async (
  timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS,
): Promise<PlatformServiceHealth> => {
  const result = await probePlatformService(PLATFORM_SERVICE_BASE_URL, timeoutMs);
  if (result.ok) {
    platformServiceReachable = true;
  }
  return result;
};
