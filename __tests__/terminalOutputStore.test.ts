import { useControlCenterStore } from '../src/store/controlCenterStore';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
    send: jest.fn(),
  },
}));

describe('terminal output store handling', () => {
  beforeEach(() => {
    useControlCenterStore.setState({
      terminalSessions: [
        {
          id: 'term-1',
          deviceId: 'device-1',
          directory: '~/project',
          shell: 'zsh',
          status: 'running',
          lines: [
            {
              id: 'cmd-1',
              kind: 'command',
              content: 'watch date',
              timestamp: '10:00:00',
            },
          ],
          createdAt: '2026-06-16T10:00:00.000Z',
          updatedAt: '2026-06-16T10:00:00.000Z',
        },
      ],
    });
  });

  it('replaces screen-repaint stdout frames instead of appending forever', () => {
    const handleTransportEvent =
      useControlCenterStore.getState().handleTransportEvent;

    handleTransportEvent({
      type: 'terminal.output',
      sessionId: 'term-1',
      data: '\x1b[H\x1b[2JEvery 2.0s: date\n12:00:01\n',
      encoding: 'text',
      raw: {},
    });
    handleTransportEvent({
      type: 'terminal.output',
      sessionId: 'term-1',
      data: '\x1b[H\x1b[2JEvery 2.0s: date\n12:00:02\n',
      encoding: 'text',
      raw: {},
    });

    expect(
      useControlCenterStore
        .getState()
        .terminalSessions[0].lines.map(item => [item.kind, item.content]),
    ).toEqual([
      ['command', 'watch date'],
      ['stdout', 'Every 2.0s: date'],
      ['stdout', '12:00:02'],
    ]);
  });
});
