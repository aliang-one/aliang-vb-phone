import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { PlatformTransportEvent } from '../src/services/platformTransport';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
    loadDeviceTerminalCommands: jest.fn(),
    loadTerminalSessionCommands: jest.fn(),
    closeTerminalSession: jest.fn(),
    send: jest.fn(),
  },
}));

type QuotaChallengeEvent = Extract<
  PlatformTransportEvent,
  { type: 'terminal.quota.challenge' }
>;

function challengeEvent(
  overrides: Partial<QuotaChallengeEvent> = {},
): QuotaChallengeEvent {
  return {
    type: 'terminal.quota.challenge',
    challengeId: 'chal-1',
    sessionId: 'term-1',
    seq: 3,
    terminalName: 'zsh build',
    usedBytes: 900 * 1024,
    killAtBytes: 1024 * 1024,
    maxBytes: 2 * 1024 * 1024,
    raw: {},
    ...overrides,
  };
}

function handle(event: PlatformTransportEvent) {
  useControlCenterStore.getState().handleTransportEvent(event);
}

describe('terminal quota challenge queue (store)', () => {
  beforeEach(() => {
    useControlCenterStore.setState({
      serverMode: true,
      terminalSessions: [
        {
          id: 'term-1',
          deviceId: 'device-1',
          directory: '~/project',
          shell: 'zsh',
          status: 'running',
          lines: [],
          createdAt: '2026-10-02T10:00:00.000Z',
          updatedAt: '2026-10-02T10:00:00.000Z',
        },
        {
          id: 'term-2',
          deviceId: 'device-1',
          directory: '~/other',
          shell: 'zsh',
          status: 'running',
          lines: [],
          createdAt: '2026-10-02T10:00:00.000Z',
          updatedAt: '2026-10-02T10:00:00.000Z',
        },
      ],
      pendingChallenges: [],
      events: [],
    });
  });

  it('enqueues a terminal.quota.challenge with every field preserved', () => {
    handle(challengeEvent());

    expect(useControlCenterStore.getState().pendingChallenges).toEqual([
      {
        challengeId: 'chal-1',
        sessionId: 'term-1',
        seq: 3,
        terminalName: 'zsh build',
        usedBytes: 900 * 1024,
        killAtBytes: 1024 * 1024,
        maxBytes: 2 * 1024 * 1024,
      },
    ]);
  });

  it('ignores a duplicate challenge with the same challengeId', () => {
    handle(challengeEvent({ usedBytes: 950 * 1024 }));
    handle(challengeEvent({ usedBytes: 980 * 1024 }));

    const queue = useControlCenterStore.getState().pendingChallenges;
    expect(queue).toHaveLength(1);
    // First arrival wins: the replayed frame must not refresh the payload.
    expect(queue[0]).toMatchObject({
      challengeId: 'chal-1',
      usedBytes: 950 * 1024,
    });
  });

  it('dequeues on terminal.quota.challenge_resolved by challengeId', () => {
    handle(challengeEvent({ challengeId: 'chal-1' }));
    handle(challengeEvent({ challengeId: 'chal-2', sessionId: 'term-2' }));

    handle({
      type: 'terminal.quota.challenge_resolved',
      challengeId: 'chal-1',
      verdict: 'resolved',
      raw: {},
    });

    expect(useControlCenterStore.getState().pendingChallenges).toEqual([
      expect.objectContaining({ challengeId: 'chal-2' }),
    ]);
  });

  it('keeps coexisting challenges when only one is resolved', () => {
    handle(challengeEvent({ challengeId: 'chal-1', seq: 1 }));
    handle(challengeEvent({ challengeId: 'chal-2', sessionId: 'term-2', seq: 2 }));
    handle(challengeEvent({ challengeId: 'chal-3', seq: 3 }));

    handle({
      type: 'terminal.quota.challenge_resolved',
      challengeId: 'chal-2',
      verdict: 'timeout',
      raw: {},
    });

    const queue = useControlCenterStore.getState().pendingChallenges;
    expect(queue.map(item => item.challengeId)).toEqual(['chal-1', 'chal-3']);
  });

  it('clears all challenges of the session on terminal.closed without disturbing the existing close logic', () => {
    handle(challengeEvent({ challengeId: 'chal-1' }));
    handle(challengeEvent({ challengeId: 'chal-2', seq: 4 }));

    handle({ type: 'terminal.closed', sessionId: 'term-1', raw: {} });

    const state = useControlCenterStore.getState();
    // Challenge queue: term-1's challenges are gone.
    expect(state.pendingChallenges).toEqual([]);
    // Pre-existing terminal.closed behavior is untouched.
    expect(
      state.terminalSessions.find(item => item.id === 'term-1'),
    ).toMatchObject({ status: 'completed' });
    expect(state.events[0]).toMatchObject({
      type: 'command.completed',
      title: 'Terminal session closed',
      terminalId: 'term-1',
    });
  });

  it('clears only the closing session’s challenges on terminal.exit (other sessions survive)', () => {
    handle(challengeEvent({ challengeId: 'chal-1' }));
    handle(challengeEvent({ challengeId: 'chal-other', sessionId: 'term-2' }));

    handle({
      type: 'terminal.exit',
      sessionId: 'term-1',
      failed: false,
      raw: {},
    });

    const state = useControlCenterStore.getState();
    expect(state.pendingChallenges.map(item => item.challengeId)).toEqual([
      'chal-other',
    ]);
    // Pre-existing terminal.exit behavior is untouched.
    expect(
      state.terminalSessions.find(item => item.id === 'term-1'),
    ).toMatchObject({ status: 'completed' });
    expect(state.events[0]).toMatchObject({
      type: 'command.completed',
      title: 'Terminal session completed',
      terminalId: 'term-1',
    });
  });

  it('marks the session failed on terminal.exit with failed=true while clearing challenges', () => {
    handle(challengeEvent({ challengeId: 'chal-1' }));

    handle({
      type: 'terminal.exit',
      sessionId: 'term-1',
      failed: true,
      raw: {},
    });

    const state = useControlCenterStore.getState();
    expect(state.pendingChallenges).toEqual([]);
    expect(
      state.terminalSessions.find(item => item.id === 'term-1'),
    ).toMatchObject({ status: 'failed' });
  });
});
