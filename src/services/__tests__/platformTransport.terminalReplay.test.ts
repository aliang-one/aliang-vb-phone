type SocketHandler = (message: Record<string, unknown>) => void;

let socketHandler: SocketHandler | undefined;

jest.mock('../websocket', () => ({
  connectMobileSocket: jest.fn((handler: SocketHandler) => {
    socketHandler = handler;
    return { connected: true };
  }),
  disconnectMobileSocket: jest.fn(() => {
    socketHandler = undefined;
  }),
  getActiveSocket: jest.fn(() => ({ connected: true, send: jest.fn() })),
}));

jest.mock('../../api/client', () => ({
  ApiResponseError: class ApiResponseError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
  apiFetch: jest.fn(),
  apiGet: jest.fn(),
  apiPatch: jest.fn(),
  apiPost: jest.fn(),
}));

import { apiPost } from '../../api/client';
import type { ServerTerminalSession } from '../../api/sessions';
import { platformTransport } from '../platformTransport';

const mockedPost = apiPost as jest.MockedFunction<typeof apiPost>;

const attachedSession: ServerTerminalSession = {
  session_id: 'term-1',
  kind: 'terminal',
  user_id: 'user-1',
  device_id: 'device-1',
  status: 'active',
  cols: 100,
  rows: 30,
  created_at: '2026-09-20T08:00:00.000Z',
  last_active_at: '2026-09-20T08:00:00.000Z',
  resumed: true,
  exited: false,
};

describe('platformTransport terminal replay', () => {
  beforeEach(() => {
    socketHandler = undefined;
    jest.clearAllMocks();
  });

  afterEach(() => {
    platformTransport.disconnect();
  });

  it('normalizes terminal.replay chunk frames with seq and data', () => {
    const events: unknown[] = [];

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.({
      type: 'terminal.replay',
      session_id: 'term-1',
      encoding: 'text',
      data: '$ ls\r\n',
      seq: 0,
      final: false,
    });

    expect(events).toEqual([
      {
        type: 'terminal.replay',
        sessionId: 'term-1',
        data: '$ ls\r\n',
        encoding: 'text',
        seq: 0,
        final: false,
        status: undefined,
        truncated: undefined,
        raw: {
          type: 'terminal.replay',
          session_id: 'term-1',
          encoding: 'text',
          data: '$ ls\r\n',
          seq: 0,
          final: false,
        },
      },
    ]);
  });

  it('normalizes terminal.replay final frames carrying status and truncated', () => {
    const events: unknown[] = [];

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.({
      type: 'terminal.replay',
      session_id: 'term-1',
      encoding: 'text',
      data: '',
      seq: 3,
      final: true,
      status: 'live',
      truncated: false,
    });

    expect(events).toEqual([
      {
        type: 'terminal.replay',
        sessionId: 'term-1',
        data: '',
        encoding: 'text',
        seq: 3,
        final: true,
        status: 'live',
        truncated: false,
        raw: {
          type: 'terminal.replay',
          session_id: 'term-1',
          encoding: 'text',
          data: '',
          seq: 3,
          final: true,
          status: 'live',
          truncated: false,
        },
      },
    ]);
  });

  it('attachTerminalSession posts rows/cols to the attach endpoint', async () => {
    mockedPost.mockResolvedValue(attachedSession);

    await expect(
      platformTransport.attachTerminalSession('term-1', { rows: 30, cols: 100 }),
    ).resolves.toEqual(attachedSession);

    expect(mockedPost).toHaveBeenCalledWith(
      '/api/terminal/sessions/term-1/attach',
      { rows: 30, cols: 100 },
    );
  });
});
