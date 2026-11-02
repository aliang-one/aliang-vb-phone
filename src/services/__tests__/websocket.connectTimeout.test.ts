// 主 WS 连接超时回归测试(2026-11-03 通道逃逸修复):
// upgrade 挂死时 RN WebSocket 可能永远停在 CONNECTING(无 onopen/onclose/
// onerror),既有重连/翻通道逻辑全部依赖 onclose——挂死即永久僵尸连接,
// send() 静默 false(2026-11-02 下午「消息发不出去」事故形态之一)。
// 超时哨兵必须:拆链、计入通道故障、排程重连;迟到 close 不得重复处理。
jest.mock('../../config/localService', () => ({
  getPlatformServiceBaseUrl: jest.fn(async () => 'https://svc.test'),
  toWebSocketUrl: (baseUrl: string) => baseUrl.replace(/^http/, 'ws'),
  reportChannelFailure: jest.fn(),
}));

jest.mock('../../api/client', () => ({
  getApiAuthToken: jest.fn(() => 'token-1'),
}));

jest.mock('../../api/sessionAuth', () => ({
  isAuthRejectionClose: jest.fn(() => false),
  notifySessionInvalidated: jest.fn(),
  refreshSession: jest.fn(async () => true),
}));

jest.mock('../commandGenEvents', () => ({
  dispatchCommandGenEvent: jest.fn(),
}));

import { MobileWebSocket } from '../websocket';
import { reportChannelFailure } from '../../config/localService';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    // 心跳自答:server 会回 pong;假 socket 不回会触发半开检测强制重连,
    // 混淆「超时哨兵」的本测目标。
    if (data.includes('"ping"')) {
      this.onmessage?.({ data: JSON.stringify({ type: 'pong' }) });
    }
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.onclose?.({ code, reason: reason ?? '' });
  }

  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
}

const mockedReportChannelFailure = reportChannelFailure as jest.MockedFunction<
  typeof reportChannelFailure
>;

describe('MobileWebSocket connect timeout sentinel', () => {
  let originalWebSocket: unknown;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    FakeWebSocket.instances = [];
    originalWebSocket = (global as { WebSocket?: unknown }).WebSocket;
    (global as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    (global as { WebSocket?: unknown }).WebSocket = originalWebSocket;
    jest.useRealTimers();
  });

  test('upgrade 挂死 6s:拆链 + reportChannelFailure + 重连出新 socket', async () => {
    const states: string[] = [];
    const wsClient = new MobileWebSocket(() => {}, {
      onStateChange: state => states.push(state),
    });

    wsClient.connect();
    await jest.advanceTimersByTimeAsync(0);

    expect(FakeWebSocket.instances).toHaveLength(1);
    const first = FakeWebSocket.instances[0];
    expect(first.url).toBe('wss://svc.test/ws/mobile?token=token-1');

    // 永不 open:6s 后哨兵接管。
    await jest.advanceTimersByTimeAsync(6_000);

    expect(first.closeCalls.length).toBeGreaterThan(0);
    expect(mockedReportChannelFailure).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['connecting', 'disconnected']);

    // 重连(指数退避首拍 1s)会创建新 socket。
    await jest.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  test('挂死后的迟到 onclose 不重复计数', async () => {
    const wsClient = new MobileWebSocket(() => {});
    wsClient.connect();
    await jest.advanceTimersByTimeAsync(0);
    const first = FakeWebSocket.instances[0];

    await jest.advanceTimersByTimeAsync(6_000);
    expect(mockedReportChannelFailure).toHaveBeenCalledTimes(1);

    // 哨兵拆链触发的 onclose(可能迟到)——必须走早退分支。
    first.onclose?.({ code: 1006, reason: '' });
    expect(mockedReportChannelFailure).toHaveBeenCalledTimes(1);
  });

  test('及时 open:哨兵解除,不误报通道故障', async () => {
    const wsClient = new MobileWebSocket(() => {});
    wsClient.connect();
    await jest.advanceTimersByTimeAsync(0);

    FakeWebSocket.instances[0].simulateOpen();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(mockedReportChannelFailure).not.toHaveBeenCalled();
  });
});
