import { getPlatformServiceBaseUrl, toWebSocketUrl } from '../config/localService';
import {
  isAuthRejectionClose,
  notifySessionInvalidated,
  refreshSession,
} from '../api/sessionAuth';
import { getApiAuthToken } from '../api/client';
import {
  dispatchCommandGenEvent,
  type CommandGenLiveEvent,
} from './commandGenEvents';

export type WsMessageHandler = (message: Record<string, unknown>) => void;
export type WsConnectionState = 'connecting' | 'connected' | 'disconnected';

interface MobileWebSocketOptions {
  onStateChange?: (state: WsConnectionState) => void;
  token?: string;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 25000;
// Force a reconnect after this many consecutive heartbeat pings go unanswered.
// The server replies to `{"type":"ping"}` with `{"type":"pong"}` (and to
// `presence.alive` with `presence.ack`); a missed reply means the socket is
// half-open — the peer restarted/killed without a clean close, which React
// Native never surfaces as onclose. One tolerated miss avoids false positives
// from a momentarily-delayed pong; two silent beats (~50s) => dead => reconnect.
const HEARTBEAT_MAX_MISSES = 1;

export class MobileWebSocket {
  private ws: WebSocket | null = null;
  private handler: WsMessageHandler;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;
  // Set when the server closed the socket over an auth rejection (1008 +
  // token/auth reason). Stops the reconnect loop — a dead token would otherwise
  // reconnect forever — and fires the session-invalidation hub so the app
  // returns to Login.
  private authRejected = false;
  // True once we've already spent our one refresh for the current open cycle.
  // Allows exactly one refresh→reconnect after an auth-rejected close; if the
  // server STILL rejects the (refreshed) token, it's genuinely dead and we tear
  // down instead of looping refresh→reconnect→reject.
  private refreshedSinceLastOpen = false;
  private _connected = false;
  private onStateChange?: (state: WsConnectionState) => void;
  private token?: string;
  // Liveness tracking. `awaitingPong` is set when a heartbeat ping is sent and
  // cleared when its pong/ack arrives; `heartbeatMisses` counts consecutive
  // unanswered pings. Together they detect a half-open socket (peer gone, no
  // close frame) that React Native otherwise leaves reported as "connected".
  private awaitingPong = false;
  private heartbeatMisses = 0;

  constructor(handler: WsMessageHandler, options: MobileWebSocketOptions = {}) {
    this.handler = handler;
    this.onStateChange = options.onStateChange;
    this.token = options.token;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    this.intentionalClose = false;
    this.connectAsync();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close(1000, 'client_disconnect');
      this.ws = null;
    }
    this._connected = false;
    this.onStateChange?.('disconnected');
  }

  send(message: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify(message));
    return true;
  }

  private async doConnect(): Promise<void> {
    this.cleanup();
    // A fresh connect attempt is no longer auth-rejected (e.g. user re-logged in
    // with a valid token). This flag is only meaningful across a close cycle.
    this.authRejected = false;
    this.onStateChange?.('connecting');

    const baseUrl = await getPlatformServiceBaseUrl();
    // Read the token LIVE: the access token rotates across a refresh, so both
    // the initial connect and any post-refresh reconnect must use whatever the
    // provider holds NOW — not this.token, which is frozen at construction and
    // goes stale the moment refreshSession rotates the token (reconnecting with
    // a dead token makes a refreshable soft-expiry escalate to a logout).
    const liveToken = getApiAuthToken() ?? this.token;
    const tokenQuery = liveToken ? `?token=${encodeURIComponent(liveToken)}` : '';
    const url = `${toWebSocketUrl(baseUrl)}/ws/mobile${tokenQuery}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      // Guard against a stale socket firing after forceReconnect() replaced it.
      if (this.ws !== ws) return;
      this._connected = true;
      this.reconnectAttempts = 0;
      // A successful open starts a fresh open cycle: we may refresh once more
      // if the server rejects us again later.
      this.refreshedSinceLastOpen = false;
      this.startHeartbeat();
      this.onStateChange?.('connected');
    };

    ws.onmessage = (event: WebSocketMessageEvent) => {
      if (this.ws !== ws) return;
      try {
        const parsed = JSON.parse(event.data as string) as Record<string, unknown>;
        if (!parsed) return;
        // Liveness acks: the server replies to our heartbeat `ping` with `pong`
        // (and to `presence.alive` with `presence.ack`). Both prove the socket is
        // carrying traffic, so they clear the half-open detector. They're infra,
        // not domain events — never forward them to the store handler.
        if (parsed.type === 'pong' || parsed.type === 'presence.ack') {
          this.markAlive();
          return;
        }
        // Transient command-generation live-loop timeline. This is a parallel,
        // lightweight tap: the store handler below still receives every message
        // (including these). The registry is for short-lived, view-scoped
        // consumers (e.g. VoiceToBashModal) that don't want full WS ownership.
        if (typeof parsed.type === 'string' && parsed.type.startsWith('commandGen.')) {
          dispatchCommandGenEvent(parsed as CommandGenLiveEvent);
        }
        this.handler(parsed);
      } catch {
        // Ignore non-JSON messages
      }
    };

    ws.onclose = (event: WebSocketCloseEvent) => {
      // A newer socket already replaced this one (forceReconnect) — ignore the
      // abandoned socket's late close so it can't clobber the fresh connection.
      if (this.ws !== ws) return;
      this._connected = false;
      this.stopHeartbeat();
      this.onStateChange?.('disconnected');
      // The server rejected our token (1008 + auth reason). Before tearing the
      // session down (which logs the user out), try one refresh: a token that
      // expired while the phone was offline can be renewed without re-login.
      // Network blips use other close codes (1006/1011/1000) and reconnect below.
      if (isAuthRejectionClose(event.code ?? 0, event.reason)) {
        void this.handleAuthRejectionClose();
        return;
      }
      if (!this.intentionalClose && !this.authRejected) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror; the identity guard above ignores any
      // close from a socket we've already replaced.
    };

    this.ws = ws as unknown as WebSocket;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectAsync();
    }, delay);
  }

  // Called from onclose when the server rejected our token. Allows exactly one
  // refresh per open cycle: refresh → reconnect with the same (now-extended)
  // token. If we already refreshed this cycle and the server STILL rejects, the
  // token is genuinely dead → tear down so the app returns to Login.
  private async handleAuthRejectionClose(): Promise<void> {
    if (this.refreshedSinceLastOpen) {
      this.authRejected = true;
      notifySessionInvalidated();
      return;
    }
    const ok = await refreshSession();
    if (!ok) {
      // refreshSession already fired notifySessionInvalidated.
      this.authRejected = true;
      return;
    }
    // Refresh rotated the access token in the store. Reconnect — doConnect reads
    // the provider live, so the reconnect carries the fresh token. Mark our one
    // refresh spent so a still-rejected reconnect tears down instead of looping.
    this.refreshedSinceLastOpen = true;
    this.connectAsync();
  }

  private connectAsync(): void {
    this.doConnect().catch(() => {
      this._connected = false;
      this.stopHeartbeat();
      this.onStateChange?.('disconnected');
      if (!this.intentionalClose && !this.authRejected) {
        this.scheduleReconnect();
      }
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.awaitingPong = false;
    this.heartbeatMisses = 0;
    this.heartbeatTimer = setInterval(() => {
      const socket = this.ws;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      // Liveness probe. If the ping we sent on the previous beat never came
      // back (no pong/ack), the socket is most likely half-open: the server
      // restarted or was killed without emitting a close frame, and React
      // Native keeps reporting readyState OPEN indefinitely. Force a reconnect
      // instead of silently losing every push published while we were stranded.
      if (this.awaitingPong) {
        this.heartbeatMisses += 1;
      } else {
        this.heartbeatMisses = 0;
      }
      if (this.heartbeatMisses >= HEARTBEAT_MAX_MISSES) {
        this.forceReconnect('liveness_timeout');
        return;
      }
      this.awaitingPong = true;
      try {
        socket.send(JSON.stringify({ type: 'ping' }));
      } catch {
        // A failed send surfaces as a liveness miss on the next beat.
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private markAlive(): void {
    this.awaitingPong = false;
    this.heartbeatMisses = 0;
  }

  // Half-open/dead socket recovery. onclose may never fire for such a socket,
  // so don't wait for it: drop this socket synchronously and open a fresh one.
  // The abandoned socket's eventual close/error is ignored by the identity guard
  // (`this.ws !== ws`) in each handler, so it can't disrupt the new connection.
  private forceReconnect(reason: string): void {
    const stale = this.ws;
    this.ws = null;
    this._connected = false;
    this.cleanup();
    this.onStateChange?.('disconnected');
    try {
      stale?.close(1000, reason);
    } catch {
      /* already torn down */
    }
    if (!this.intentionalClose && !this.authRejected) {
      this.connectAsync();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// Singleton instance — created after connecting to the platform
let activeSocket: MobileWebSocket | null = null;

export function connectMobileSocket(
  handler: WsMessageHandler,
  options: MobileWebSocketOptions = {},
): MobileWebSocket {
  if (activeSocket) {
    activeSocket.disconnect();
  }
  activeSocket = new MobileWebSocket(handler, options);
  activeSocket.connect();
  return activeSocket;
}

export function getActiveSocket(): MobileWebSocket | null {
  return activeSocket;
}

export function disconnectMobileSocket(): void {
  if (activeSocket) {
    activeSocket.disconnect();
    activeSocket = null;
  }
}
