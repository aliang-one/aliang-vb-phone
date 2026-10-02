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

describe('platformTransport terminal quota challenge events', () => {
  beforeEach(() => {
    socketHandler = undefined;
    jest.clearAllMocks();
  });

  afterEach(() => {
    platformTransport.disconnect();
  });

  it('normalizes terminal.quota.challenge carrying every camelCase field plus raw', () => {
    const events: unknown[] = [];

    platformTransport.connect(event => {
      events.push(event);
    });
    const frame = {
      type: 'terminal.quota.challenge',
      challengeId: 'chg_x',
      sessionId: 'ts_1',
      seq: 1,
      usedBytes: 134217728,
      killAtBytes: 268435456,
      maxBytes: 536870912,
      terminalName: 'zsh',
    };
    socketHandler?.(frame);

    expect(events).toEqual([
      {
        type: 'terminal.quota.challenge',
        challengeId: 'chg_x',
        sessionId: 'ts_1',
        seq: 1,
        usedBytes: 134217728,
        killAtBytes: 268435456,
        maxBytes: 536870912,
        terminalName: 'zsh',
        raw: frame,
      },
    ]);
  });

  it('normalizes terminal.quota.challenge without terminalName (optional field absent)', () => {
    const events: unknown[] = [];

    platformTransport.connect(event => {
      events.push(event);
    });
    const frame = {
      type: 'terminal.quota.challenge',
      challengeId: 'chg_x',
      sessionId: 'ts_1',
      seq: 1,
      usedBytes: 134217728,
      killAtBytes: 268435456,
      maxBytes: 536870912,
    };
    socketHandler?.(frame);

    expect(events).toEqual([
      {
        type: 'terminal.quota.challenge',
        challengeId: 'chg_x',
        sessionId: 'ts_1',
        seq: 1,
        usedBytes: 134217728,
        killAtBytes: 268435456,
        maxBytes: 536870912,
        raw: frame,
      },
    ]);
  });

  it('normalizes terminal.quota.challenge_resolved with verdict only', () => {
    const events: unknown[] = [];

    platformTransport.connect(event => {
      events.push(event);
    });
    const frame = {
      type: 'terminal.quota.challenge_resolved',
      challengeId: 'chg_x',
      verdict: 'granted',
    };
    socketHandler?.(frame);

    expect(events).toEqual([
      {
        type: 'terminal.quota.challenge_resolved',
        challengeId: 'chg_x',
        verdict: 'granted',
        raw: frame,
      },
    ]);
  });

  it('keeps unknown terminal.quota.* types on the raw fallback', () => {
    const events: unknown[] = [];

    platformTransport.connect(event => {
      events.push(event);
    });
    const frame = {
      type: 'terminal.quota.whatever_else',
      challengeId: 'chg_x',
    };
    socketHandler?.(frame);

    expect(events).toEqual([{ type: 'raw', raw: frame }]);
  });
});
