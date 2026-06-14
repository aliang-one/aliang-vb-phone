import { getPlatformServiceBaseUrl, toWebSocketUrl } from '../config/localService';

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
    this.onStateChange?.('connecting');

    const baseUrl = await getPlatformServiceBaseUrl();
    const tokenQuery = this.token ? `?token=${encodeURIComponent(this.token)}` : '';
    const url = `${toWebSocketUrl(baseUrl)}/ws/mobile${tokenQuery}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      this._connected = true;
      this.reconnectAttempts = 0;
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

    ws.onclose = () => {
      this._connected = false;
      this.stopHeartbeat();
      this.onStateChange?.('disconnected');
      if (!this.intentionalClose) {
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

  private connectAsync(): void {
    this.doConnect().catch(() => {
      this._connected = false;
      this.stopHeartbeat();
      this.onStateChange?.('disconnected');
      if (!this.intentionalClose) {
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
