import { getPlatformServiceBaseUrl, toWebSocketUrl } from '../config/localService';
import {
  isAuthRejectionClose,
  notifySessionInvalidated,
  refreshSession,
} from '../api/sessionAuth';

export type WsMessageHandler = (message: Record<string, unknown>) => void;
export type WsConnectionState = 'connecting' | 'connected' | 'disconnected';

interface MobileWebSocketOptions {
  onStateChange?: (state: WsConnectionState) => void;
  token?: string;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 25000;

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
    const tokenQuery = this.token ? `?token=${encodeURIComponent(this.token)}` : '';
    const url = `${toWebSocketUrl(baseUrl)}/ws/mobile${tokenQuery}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      this._connected = true;
      this.reconnectAttempts = 0;
      // A successful open starts a fresh open cycle: we may refresh once more
      // if the server rejects us again later.
      this.refreshedSinceLastOpen = false;
      this.startHeartbeat();
      this.onStateChange?.('connected');
    };

    ws.onmessage = (event: WebSocketMessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as Record<string, unknown>;
        if (parsed) {
          this.handler(parsed);
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    ws.onclose = (event: WebSocketCloseEvent) => {
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
      // onclose will fire after onerror
    };

    this.ws = ws;
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
    // Refresh extended the session server-side. The local-session token value
    // is stable across refresh, so reconnecting with this.token works. Mark our
    // one refresh spent so a still-rejected reconnect tears down instead of loop.
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
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, HEARTBEAT_INTERVAL_MS);
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
