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

import { platformTransport } from '../platformTransport';

describe('platformTransport terminal.geometry_changed', () => {
  beforeEach(() => {
    socketHandler = undefined;
    jest.clearAllMocks();
  });

  afterEach(() => {
    platformTransport.disconnect();
  });

  it('normalizes terminal.geometry_changed frames with web origin', () => {
    const events: unknown[] = [];
    const frame = {
      type: 'terminal.geometry_changed',
      session_id: 't1',
      cols: 120,
      rows: 30,
      origin: 'web',
    };

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.(frame);

    expect(events).toEqual([
      {
        type: 'terminal.geometry_changed',
        sessionId: 't1',
        cols: 120,
        rows: 30,
        origin: 'web',
        raw: frame,
      },
    ]);
  });

  it('normalizes terminal.geometry_changed frames with phone origin', () => {
    const events: unknown[] = [];
    const frame = {
      type: 'terminal.geometry_changed',
      session_id: 't1',
      cols: 80,
      rows: 24,
      origin: 'phone',
    };

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.(frame);

    expect(events).toEqual([
      {
        type: 'terminal.geometry_changed',
        sessionId: 't1',
        cols: 80,
        rows: 24,
        origin: 'phone',
        raw: frame,
      },
    ]);
  });

  it('carries deferred:true on a browser-priority correction frame', () => {
    const events: unknown[] = [];
    const frame = {
      type: 'terminal.geometry_changed',
      session_id: 't1',
      cols: 132,
      rows: 43,
      origin: 'web',
      deferred: true,
    };

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.(frame);

    expect(events).toEqual([
      {
        type: 'terminal.geometry_changed',
        sessionId: 't1',
        cols: 132,
        rows: 43,
        origin: 'web',
        deferred: true,
        raw: frame,
      },
    ]);
  });

  it('leaves deferred off ordinary broadcasts (non-true values ignored)', () => {
    const events: unknown[] = [];
    const frame = {
      type: 'terminal.geometry_changed',
      session_id: 't1',
      cols: 120,
      rows: 30,
      origin: 'web',
      deferred: false,
    };

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.(frame);

    expect(events).toEqual([
      {
        type: 'terminal.geometry_changed',
        sessionId: 't1',
        cols: 120,
        rows: 30,
        origin: 'web',
        raw: frame,
      },
    ]);
  });

  it('drops malformed geometry frames to raw instead of the typed channel', () => {
    const events: unknown[] = [];
    const missingCols = {
      type: 'terminal.geometry_changed',
      session_id: 't1',
      rows: 30,
      origin: 'web',
    };
    const missingRows = {
      type: 'terminal.geometry_changed',
      session_id: 't1',
      cols: 120,
      origin: 'web',
    };
    const unknownOrigin = {
      type: 'terminal.geometry_changed',
      session_id: 't1',
      cols: 120,
      rows: 30,
      origin: 'x',
    };

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.(missingCols);
    socketHandler?.(missingRows);
    socketHandler?.(unknownOrigin);

    expect(events).toEqual([
      { type: 'raw', raw: missingCols },
      { type: 'raw', raw: missingRows },
      { type: 'raw', raw: unknownOrigin },
    ]);
  });
});
