/**
 * Local authentication hardening hub.
 *
 * The app used to scatter 401 handling: `isUnauthorizedApiError` existed in
 * `client.ts` but was never called, `restoreUser` failures were swallowed as a
 * `console.warn`, and an expired-but-non-null token left the UI stranded in a
 * half-broken workspace with no path back to Login. This module is the single
 * choke point for that: it classifies "session-invalid" errors, decodes a JWT's
 * `exp` for a local pre-check (no wasted round-trip), and fans a single
 * invalidation signal out to whoever registered a handler — with built-in
 * de-duplication so a burst of concurrent 401s collapses into one logout.
 *
 * It deliberately depends on NOTHING in `api/` (it duck-types ApiResponseError
 * structurally) so `client.ts` / `accountClient.ts` can import it without a
 * circular reference.
 */

/** Thrown by the local JWT-expiry pre-check so callers classify it as invalid. */
export class SessionExpiredError extends Error {
  constructor(message = 'Session expired.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/** Structural view of `ApiResponseError` (from `client.ts`) without importing it. */
interface ApiResponseErrorLike {
  name?: string;
  status?: number;
  code?: string;
  message?: string;
}

function asApiResponseError(error: unknown): ApiResponseErrorLike | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as ApiResponseErrorLike;
  // ApiResponseError sets `.status` (a number) and names itself 'ApiResponseError'.
  // Either signal is enough; together they are unambiguous without an import.
  if (candidate.name === 'ApiResponseError' || typeof candidate.status === 'number') {
    return candidate;
  }
  return null;
}

// Substrings — matched case-insensitively against the ApiResponseError code and
// message — that the aliang SaaS / local platform server emit when a token is no
// longer usable. Covers both the `www.aliang.one/api/auth/me` "Invalid token"
// body and the server's own ApiError codes (invalid_user_token, auth_expired,
// authentication_required, invalid_device_token, invalid_admin_token).
const INVALID_SESSION_PATTERNS: RegExp[] = [
  /invalid.{0,4}token/,
  /invalid_user_token/,
  /invalid_device_token/,
  /invalid_admin_token/,
  /authentication_required/,
  /auth_expired/,
  /\bunauthorized\b/,
  /session expired/,
];

/**
 * True when `error` means the local session is no longer usable and the app
 * should return to Login. Recognises HTTP 401/403, known auth error codes,
 * the "Invalid token" message body, and our own SessionExpiredError.
 */
export function isSessionInvalidError(error: unknown): boolean {
  if (error instanceof SessionExpiredError) return true;
  const apiError = asApiResponseError(error);
  if (!apiError) return false;
  if (apiError.status === 401 || apiError.status === 403) return true;
  const haystack = `${apiError.code ?? ''} ${apiError.message ?? ''}`.toLowerCase();
  return INVALID_SESSION_PATTERNS.some(pattern => pattern.test(haystack));
}

/**
 * Decode a JWT's `exp` claim (epoch seconds) into epoch milliseconds without
 * verifying the signature — this is a client-side convenience pre-check only;
 * the server remains authoritative via HS256 verification. Returns `undefined`
 * for anything that is not a decodable JWT carrying a numeric `exp`.
 */
export function decodeJwtExp(
  token: string | null | undefined,
): number | undefined {
  if (typeof token !== 'string' || !token.includes('.')) return undefined;
  const parts = token.split('.');
  if (parts.length < 2) return undefined;
  // `atob` is global in React Native (and in the jest preset). Reach it via
  // globalThis so TypeScript doesn't need a DOM lib; if it's somehow absent,
  // we can't decode and just return undefined (server stays authoritative).
  const globalAtob = (globalThis as { atob?: (input: string) => string }).atob;
  if (typeof globalAtob !== 'function') return undefined;
  try {
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64.padEnd(
      payloadB64.length + ((4 - (payloadB64.length % 4)) % 4),
      '=',
    );
    const payload = JSON.parse(globalAtob(padded)) as { exp?: unknown };
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
      return Math.floor(payload.exp * 1000);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when the given exp (epoch ms) is already in the past. `graceMs` lets a
 * just-expired token survive briefly to avoid a race at the boundary.
 */
export function isJwtExpired(expMs: number | undefined, graceMs = 0): boolean {
  if (typeof expMs !== 'number' || !Number.isFinite(expMs)) return false;
  return Date.now() >= expMs + graceMs;
}

/**
 * True when a WebSocket close event is the server rejecting our auth (policy
 * violation 1008 with an auth-flavoured reason). Used to STOP reconnecting — a
 * dead token would otherwise reconnect forever. Server closes with code 1008
 * and reasons like `invalid_user_token`, `auth_expired`, `invalid_device_token`,
 * `invalid_admin_token`, `authentication_required`.
 */
export function isAuthRejectionClose(
  code: number | undefined,
  reason?: string,
): boolean {
  const text = `${reason ?? ''}`.toLowerCase();
  if (INVALID_SESSION_PATTERNS.some(pattern => pattern.test(text))) return true;
  // 1008 = policy violation; treat it as auth rejection only when the reason
  // confirms it, to avoid misclassifying unrelated policy closes. Parenthesised
  // so the regex isn't read as a division operator.
  return code === 1008 && (/token|auth|invalid/).test(text);
}

// ---------------------------------------------------------------------------
// Invalidation hub
// ---------------------------------------------------------------------------

type InvalidationHandler = () => void;

let invalidationHandler: InvalidationHandler | null = null;
// Collapses a burst of concurrent 401s (e.g. several in-flight requests all
// failing at once) into a single logout. Reset shortly after the last fire so a
// fresh login can fail again normally.
let invalidationInFlight = false;
let invalidationResetTimer: ReturnType<typeof setTimeout> | null = null;
const INVALIDATION_DEDUPE_MS = 1500;

/** Register the single handler invoked when the session must be torn down. */
export function setSessionInvalidationHandler(
  handler: InvalidationHandler | null,
): void {
  invalidationHandler = handler;
}

/**
 * Fire the session-invalidation signal. Safe to call from anywhere (HTTP error
 * paths, WS close, local JWT pre-check). De-duplicated: within
 * `INVALIDATION_DEDUPE_MS` of a prior fire this is a no-op. No-op when no
 * handler is registered.
 */
export function notifySessionInvalidated(): void {
  if (!invalidationHandler || invalidationInFlight) return;
  invalidationInFlight = true;
  try {
    invalidationHandler();
  } finally {
    if (invalidationResetTimer) clearTimeout(invalidationResetTimer);
    invalidationResetTimer = setTimeout(() => {
      invalidationInFlight = false;
      invalidationResetTimer = null;
    }, INVALIDATION_DEDUPE_MS);
  }
}

// ---------------------------------------------------------------------------
// Session-refresh hub
// ---------------------------------------------------------------------------
//
// The HTTP clients (`client.ts`, `accountClient.ts`) and the WebSocket
// (`websocket.ts`) call `refreshSession()` on a 401 / auth rejection INSTEAD of
// immediately tearing the session down. The registered refresher (the session
// store) rotates the persisted `refresh_token` and extends the local session
// server-side; on success callers retry the request / reconnect, so a
// transiently-expired session (e.g. the phone was offline long enough for the
// local session to lapse) recovers instead of logging the user out. Only a
// refresh that itself fails falls back to `notifySessionInvalidated()`
// (genuinely unrecoverable — offline across ≥2 token rotations).
//
// Depends on nothing in `api/` (the store registers the handler), so the
// clients can import it without a cycle.

type SessionRefresher = () => Promise<boolean>;

let sessionRefresher: SessionRefresher | null = null;
// Single in-flight refresh: a burst of concurrent 401s collapses into one
// rotation. Mirrors `refreshInFlight` in `realtimeSlice.ts`.
let refreshInFlight: Promise<boolean> | null = null;

/** Register the store action that performs a refresh + refresh_token rotation. */
export function setSessionRefresher(handler: SessionRefresher | null): void {
  sessionRefresher = handler;
}

/**
 * Perform a single, de-duplicated session refresh. Concurrent callers (a burst
 * of failing requests) share one in-flight refresh and observe the same result.
 *
 * Returns `true` when the session is fresh and the caller should retry the
 * request / reconnect. Returns `false` — and fires `notifySessionInvalidated`
 * (the existing teardown → app returns to Login) — when refresh is impossible
 * (no handler / no refresh token) or the refresh itself failed. Callers
 * propagate the original error in the `false` case.
 */
export async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  if (!sessionRefresher) {
    notifySessionInvalidated();
    return false;
  }
  refreshInFlight = (async (): Promise<boolean> => {
    try {
      const ok = await sessionRefresher();
      if (!ok) notifySessionInvalidated();
      return ok;
    } catch {
      notifySessionInvalidated();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Test-only: reset hub state between cases. */
export function __resetSessionAuthHubForTest(): void {
  invalidationHandler = null;
  invalidationInFlight = false;
  if (invalidationResetTimer) {
    clearTimeout(invalidationResetTimer);
    invalidationResetTimer = null;
  }
  sessionRefresher = null;
  refreshInFlight = null;
}
