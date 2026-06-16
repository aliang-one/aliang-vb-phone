import { useControlCenterStore } from '../src/store/controlCenterStore';
import { platformTransport } from '../src/services/platformTransport';
import { stateFromSnapshot } from '../src/store/internals';

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
      serverMode: true,
      devices: [
        {
          id: 'device-1',
          name: 'MacBook',
          status: 'online',
          location: 'Desk',
          os: 'darwin',
          host: 'localhost',
          cpuLoad: 0,
          memLoad: 0,
          authorizedDirectories: ['~/project'],
          activePorts: [],
          projectIds: [],
          activeSessionIds: [],
          lastSeen: 'now',
          remoteTerminalEnabled: true,
          aiControlEnabled: true,
          capabilities: ['terminal'],
          tools: [],
          history: [],
        },
      ],
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

  it('keeps cursor-addressed continuous output as one screen frame', () => {
    const handleTransportEvent =
      useControlCenterStore.getState().handleTransportEvent;

    handleTransportEvent({
      type: 'terminal.output',
      sessionId: 'term-1',
      data: '\x1b[Htop - 10:00:01\nTasks: 20 total\nPID COMMAND\n1 node\n',
      encoding: 'text',
      raw: {},
    });
    handleTransportEvent({
      type: 'terminal.output',
      sessionId: 'term-1',
      data: '\x1b[H\x1b[2Ktop - 10:00:02\n\x1b[2KTasks: 21 total\n\x1b[2KPID COMMAND\n\x1b[2K2 zsh\n',
      encoding: 'text',
      raw: {},
    });

    expect(
      useControlCenterStore
        .getState()
        .terminalSessions[0].lines.map(item => [item.kind, item.content]),
    ).toEqual([
      ['command', 'watch date'],
      ['stdout', 'top - 10:00:02'],
      ['stdout', 'Tasks: 21 total'],
      ['stdout', 'PID COMMAND'],
      ['stdout', '2 zsh'],
    ]);
  });

  it('does not erase earlier command output when replacing a screen frame', () => {
    useControlCenterStore.setState(state => ({
      terminalSessions: state.terminalSessions.map(item =>
        item.id === 'term-1'
          ? {
              ...item,
              lines: [
                {
                  id: 'cmd-ls',
                  kind: 'command',
                  content: 'ls -al',
                  timestamp: '10:00:00',
                },
                {
                  id: 'out-ls',
                  kind: 'stdout',
                  content: 'total 8',
                  timestamp: '10:00:01',
                },
                {
                  id: 'cmd-top',
                  kind: 'command',
                  content: 'top',
                  timestamp: '10:00:02',
                },
              ],
            }
          : item,
      ),
    }));
    const handleTransportEvent =
      useControlCenterStore.getState().handleTransportEvent;

    handleTransportEvent({
      type: 'terminal.output',
      sessionId: 'term-1',
      data: '\x1b[Htop - 10:00:01\nTasks: 20 total\nPID COMMAND\n1 node\n',
      encoding: 'text',
      raw: {},
    });
    handleTransportEvent({
      type: 'terminal.output',
      sessionId: 'term-1',
      data: '\x1b[H\x1b[2Ktop - 10:00:02\n\x1b[2KTasks: 21 total\n\x1b[2KPID COMMAND\n\x1b[2K2 zsh\n',
      encoding: 'text',
      raw: {},
    });

    expect(
      useControlCenterStore
        .getState()
        .terminalSessions[0].lines.map(item => [item.kind, item.content]),
    ).toEqual([
      ['command', 'ls -al'],
      ['stdout', 'total 8'],
      ['command', 'top'],
      ['stdout', 'top - 10:00:02'],
      ['stdout', 'Tasks: 21 total'],
      ['stdout', 'PID COMMAND'],
      ['stdout', '2 zsh'],
    ]);
  });

  it('sends an interrupt without closing the terminal session', () => {
    (platformTransport.send as jest.Mock).mockReturnValue(true);

    useControlCenterStore.getState().interruptTerminal('term-1');

    expect(platformTransport.send).toHaveBeenCalledWith({
      type: 'terminal.interrupt',
      session_id: 'term-1',
    });
    expect(
      useControlCenterStore
        .getState()
        .terminalSessions[0].lines.map(item => [item.kind, item.content]),
    ).toContainEqual(['system', 'Sent Ctrl+C interrupt.']);
  });

  it('sends command text into the PTY without mirroring it into the line store', () => {
    (platformTransport.send as jest.Mock).mockClear();
    (platformTransport.send as jest.Mock).mockReturnValue(true);

    useControlCenterStore.getState().executeTerminalCommand('term-1', 'ls -al');

    expect(platformTransport.send).toHaveBeenCalledWith({
      type: 'terminal.input',
      session_id: 'term-1',
      data: 'ls -al\r',
      encoding: 'text',
    });
    expect(
      useControlCenterStore
        .getState()
        .terminalSessions[0].lines.map(item => [item.kind, item.content]),
    ).toEqual([['command', 'watch date']]);
  });

  it('keeps local terminal output when a snapshot refresh arrives', () => {
    useControlCenterStore.setState(state => ({
      terminalSessions: state.terminalSessions.map(item =>
        item.id === 'term-1'
          ? {
              ...item,
              lines: [
                ...item.lines,
                {
                  id: 'out-1',
                  kind: 'stdout',
                  content: 'total 8',
                  timestamp: '10:00:01',
                },
              ],
            }
          : item,
      ),
    }));

    const refreshed = stateFromSnapshot(
      {
        devices: [
          {
            id: 'device-1',
            deviceId: 'device-1',
            userId: 'user-1',
            name: 'MacBook',
            platform: 'darwin',
            status: 'online',
            capabilities: ['terminal'],
            tools: [],
            history: [],
            remoteTerminalEnabled: true,
            aiControlEnabled: true,
            activePorts: [],
            authorizedDirectories: ['~/project'],
            projectIds: [],
            raw: {} as never,
          },
        ],
        projects: [],
        aiSessions: [],
        terminalSessions: [
          {
            session_id: 'term-1',
            kind: 'terminal',
            user_id: 'user-1',
            device_id: 'device-1',
            status: 'active',
            cwd: '~/project',
            shell: 'zsh',
            cols: 80,
            rows: 24,
            created_at: '2026-06-16T10:00:00.000Z',
            last_active_at: '2026-06-16T10:00:02.000Z',
          },
        ],
        approvals: [],
        notifications: [],
        previewLinks: [],
        realtimeEvents: [],
        loadedAt: '2026-06-16T10:00:02.000Z',
        warnings: [],
      },
      [],
      useControlCenterStore.getState().terminalSessions,
    );

    expect(refreshed.terminalSessions[0].lines.map(item => [item.kind, item.content])).toEqual([
      ['command', 'watch date'],
      ['stdout', 'total 8'],
    ]);
  });
});
