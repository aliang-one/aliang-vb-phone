// Lightweight, short-lived WebSocket client for the /ws/stt endpoint.
//
// Unlike services/websocket.ts (MobileWebSocket), this is intentionally minimal:
// a recording is a one-shot interaction, so there is no reconnect loop or
// heartbeat. connect() resolves once the socket is open so the caller can send
// stt.start; sendBinary() forwards PCM frames; close() tears it down.
import { getPlatformServiceBaseUrl, toWebSocketUrl } from '../config/localService';
import { isSttControlOut, type SttControlIn, type SttControlOut } from './sttTypes';

export interface SttSocketHandlers {
  onMessage: (msg: SttControlOut) => void;
  onClose?: (code: number, reason: string) => void;
  onError?: () => void;
}

export class SttSocket {
  private ws: WebSocket | null = null;
  private readonly token: string;
  private readonly handlers: SttSocketHandlers;
  private intentionalClose = false;

  constructor(token: string, handlers: SttSocketHandlers) {
    this.token = token;
    this.handlers = handlers;
  }

  get isOpen(): boolean {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  /** Open the socket. Resolves once open; rejects on connect failure. */
  async connect(): Promise<void> {
    const baseUrl = await getPlatformServiceBaseUrl();
    const url = `${toWebSocketUrl(baseUrl)}/ws/stt?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('stt_socket_connect_failed'));
    });

    ws.onmessage = (event: WebSocketMessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string);
        if (isSttControlOut(parsed)) {
          this.handlers.onMessage(parsed);
        }
      } catch {
        // Ignore non-JSON frames.
      }
    };
    ws.onclose = (event: WebSocketCloseEvent) => {
      if (this.intentionalClose) return;
      this.handlers.onClose?.(event.code ?? 0, event.reason ?? '');
    };
    ws.onerror = () => {
      // onclose will follow; surface the error for UI feedback.
      this.handlers.onError?.();
    };
  }

  sendJson(msg: SttControlIn): boolean {
    if (!this.isOpen) return false;
    this.ws!.send(JSON.stringify(msg));
    return true;
  }

  /** Forward a PCM frame as a binary WebSocket frame. */
  sendBinary(data: ArrayBuffer | ArrayBufferView): boolean {
    if (!this.isOpen) return false;
    this.ws!.send(data as ArrayBuffer);
    return true;
  }

  close(): void {
    this.intentionalClose = true;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close(1000, 'client_done');
      } catch {
        // ignore
      }
    }
  }
}
