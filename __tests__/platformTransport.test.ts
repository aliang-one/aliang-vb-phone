type SocketHandler = (message: Record<string, unknown>) => void;

let socketHandler: SocketHandler | undefined;

jest.mock('../src/services/websocket', () => ({
  connectMobileSocket: jest.fn((handler: SocketHandler) => {
    socketHandler = handler;
    return { connected: true };
  }),
  disconnectMobileSocket: jest.fn(() => {
    socketHandler = undefined;
  }),
  getActiveSocket: jest.fn(() => ({ connected: true, send: jest.fn() })),
}));

import { platformTransport } from '../src/services/platformTransport';

describe('platformTransport realtime events', () => {
  beforeEach(() => {
    socketHandler = undefined;
    jest.clearAllMocks();
  });

  afterEach(() => {
    platformTransport.disconnect();
  });

  it('normalizes server terminal.closed messages', () => {
    const events: unknown[] = [];

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.({
      type: 'terminal.closed',
      session_id: 'term-1',
    });

    expect(events).toEqual([
      {
        type: 'terminal.closed',
        sessionId: 'term-1',
        raw: {
          type: 'terminal.closed',
          session_id: 'term-1',
        },
      },
    ]);
  });
});
