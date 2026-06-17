import type { StateCreator } from 'zustand';
import { platformTransport } from '../../services/platformTransport';
import {
  clearPendingTerminalOutput,
  terminalOutputHandlers,
} from '../../components/terminal/TerminalEmulator';
import type {
  ControlCenterState,
  TerminalCommandHistoryItem,
  TerminalSessionStatus,
} from '../types';
import {
  event,
  line,
  MAX_TERMINAL_LINES,
  nowTime,
  serverTerminalSessionToClient,
  tail,
} from '../internals';

type TerminalSlice = Pick<
  ControlCenterState,
  | 'terminalSessions'
  | 'terminalCommandHistory'
  | 'createTerminalSession'
  | 'executeTerminalCommand'
  | 'clearTerminal'
  | 'stopTerminal'
  | 'interruptTerminal'
  | 'loadTerminalCommandHistory'
  | 'createPtySession'
  | 'sendTerminalInput'
  | 'resizeTerminal'
  | 'closeTerminalSession'
>;

export const createTerminalSlice: StateCreator<
  ControlCenterState,
  [],
  [],
  TerminalSlice
> = (set, get) => ({
  terminalSessions: [],
  terminalCommandHistory: {},

  createTerminalSession: async (deviceId, directory) => {
    if (!get().serverMode) {
      throw new Error(
        'Platform connection is required before opening a terminal.',
      );
    }
    const device = get().devices.find(item => item.id === deviceId);
    const selectedDirectory =
      directory ?? device?.authorizedDirectories[0] ?? '~';
    const serverSession = await platformTransport.createTerminalSession({
      device_id: deviceId,
      cwd: selectedDirectory,
      cols: 80,
      rows: 24,
    });
    const terminal = serverTerminalSessionToClient(serverSession);

    set(state => ({
      terminalSessions: [
        {
          ...terminal,
          shell:
            terminal.shell ||
            (device?.os.toLowerCase().includes('windows') ? 'pwsh' : 'zsh'),
          lines: [
            line(
              'system',
              device
                ? `Terminal session opened on ${device.name}.`
                : 'Device is unavailable.',
            ),
            line('system', `Working directory: ${selectedDirectory}`),
          ],
        },
        ...state.terminalSessions.filter(item => item.id !== terminal.id),
      ],
      events: [
        event(
          'command.started',
          'Terminal session opened',
          selectedDirectory,
          'running',
          {
            deviceId,
            terminalId: terminal.id,
          },
        ),
        ...state.events,
      ].slice(0, 120),
    }));

    return terminal.id;
  },

  executeTerminalCommand: (terminalId, command) => {
    const trimmed = command.trim();
    const terminal = get().terminalSessions.find(
      item => item.id === terminalId,
    );
    const device = terminal
      ? get().devices.find(item => item.id === terminal.deviceId)
      : undefined;

    if (!terminal || !trimmed || !device || device.status === 'offline') {
      return;
    }

    if (get().serverMode) {
      const sent = platformTransport.send({
        type: 'terminal.input',
        session_id: terminalId,
        data: `${trimmed}\r`,
        encoding: 'text',
      });
      if (sent) {
        set(state => ({
          terminalSessions: state.terminalSessions.map(item =>
            item.id === terminalId
              ? {
                  ...item,
                  status: 'running' as TerminalSessionStatus,
                  updatedAt: nowTime(),
                }
              : item,
          ),
        }));
        return;
      }
    }
  },

  clearTerminal: terminalId => {
    set(state => ({
      terminalSessions: state.terminalSessions.map(item =>
        item.id === terminalId
          ? {
              ...item,
              status: 'idle',
              updatedAt: nowTime(),
              lines: [
                line('system', 'Terminal output cleared.'),
                line('system', `Working directory: ${item.directory}`),
              ],
            }
          : item,
      ),
    }));
  },

  interruptTerminal: terminalId => {
    const terminal = get().terminalSessions.find(
      item => item.id === terminalId,
    );
    if (!terminal || !get().serverMode) {
      return;
    }

    const sent = platformTransport.send({
      type: 'terminal.interrupt',
      session_id: terminalId,
    });

    if (!sent) return;

    set(state => ({
      terminalSessions: state.terminalSessions.map(item =>
        item.id === terminalId
          ? {
              ...item,
              status: 'running' as TerminalSessionStatus,
              updatedAt: nowTime(),
              lines: tail(
                [...item.lines, line('system', 'Sent Ctrl+C interrupt.')],
                MAX_TERMINAL_LINES,
              ),
            }
          : item,
      ),
    }));
  },

  loadTerminalCommandHistory: async (terminalId, deviceId) => {
    if (!get().serverMode) return;

    const [sessionCommands, deviceCommands] = await Promise.all([
      platformTransport.loadTerminalSessionCommands(terminalId, 20),
      deviceId
        ? platformTransport.loadDeviceTerminalCommands(deviceId, 30)
        : Promise.resolve([]),
    ]);

    set(state => ({
      terminalCommandHistory: {
        ...state.terminalCommandHistory,
        [`session:${terminalId}`]: mergeCommandHistory(
          sessionCommands.map(serverTerminalCommandToClient),
          state.terminalCommandHistory[`session:${terminalId}`],
        ),
        ...(deviceId
          ? {
              [`device:${deviceId}`]: mergeCommandHistory(
                deviceCommands.map(serverTerminalCommandToClient),
                state.terminalCommandHistory[`device:${deviceId}`],
              ),
            }
          : {}),
      },
    }));
  },

  stopTerminal: async terminalId => {
    if (!get().serverMode) {
      throw new Error(
        'Platform connection is required before stopping a terminal.',
      );
    }
    const serverSession = await platformTransport.closeTerminalSession(
      terminalId,
    );
    const closed = serverTerminalSessionToClient(serverSession);
    terminalOutputHandlers.delete(terminalId);
    clearPendingTerminalOutput(terminalId);
    set(state => ({
      terminalSessions: state.terminalSessions.map(item =>
        item.id === terminalId
          ? {
              ...item,
              status: closed.status === 'completed' ? 'stopped' : closed.status,
              updatedAt: closed.updatedAt,
              lines: [
                ...item.lines,
                line('system', 'Terminal session closed from mobile control.'),
              ],
            }
          : item,
      ),
      events: [
        event(
          'command.completed',
          'Terminal session closed',
          terminalId,
          'done',
          {
            terminalId,
          },
        ),
        ...state.events,
      ].slice(0, 120),
    }));
  },

  createPtySession: async (deviceId, options) => {
    if (!get().serverMode) {
      throw new Error(
        'Platform connection is required before opening a terminal.',
      );
    }
    const serverSession = await platformTransport.createTerminalSession({
      device_id: deviceId,
      cwd: options?.cwd,
      cols: options?.cols ?? 80,
      rows: options?.rows ?? 24,
    });
    const device = get().devices.find(item => item.id === deviceId);
    const terminal = serverTerminalSessionToClient(serverSession);
    set(state => ({
      terminalSessions: [
        {
          ...terminal,
          lines: [
            line(
              'system',
              device
                ? `PTY session opened on ${device.name}.`
                : 'Device is unavailable.',
            ),
          ],
        },
        ...state.terminalSessions.filter(item => item.id !== terminal.id),
      ],
    }));
    return terminal.id;
  },

  sendTerminalInput: (sessionId, data, encoding = 'text') => {
    platformTransport.send({
      type: 'terminal.input',
      session_id: sessionId,
      encoding,
      data,
    });
  },

  resizeTerminal: (sessionId, cols, rows) => {
    platformTransport.send({
      type: 'terminal.resize',
      session_id: sessionId,
      cols,
      rows,
    });
  },

  closeTerminalSession: async sessionId => {
    if (!get().serverMode) {
      throw new Error(
        'Platform connection is required before closing a terminal.',
      );
    }
    const serverSession = await platformTransport.closeTerminalSession(
      sessionId,
    );
    const closed = serverTerminalSessionToClient(serverSession);
    terminalOutputHandlers.delete(sessionId);
    clearPendingTerminalOutput(sessionId);
    set(state => ({
      terminalSessions: state.terminalSessions.map(item =>
        item.id === sessionId
          ? {
              ...item,
              status:
                closed.status === 'completed'
                  ? ('stopped' as TerminalSessionStatus)
                  : closed.status,
              updatedAt: closed.updatedAt,
            }
          : item,
      ),
    }));
  },
});

function serverTerminalCommandToClient(
  command: Awaited<
    ReturnType<typeof platformTransport.loadTerminalSessionCommands>
  >[number],
): TerminalCommandHistoryItem {
  return {
    id: command.id,
    terminalSessionId: command.terminalSessionId,
    deviceId: command.deviceId,
    command: command.command,
    timestamp: command.timestamp,
    exitCode: command.exitCode,
    createdAt: command.createdAt,
  };
}

function mergeCommandHistory(
  incoming: TerminalCommandHistoryItem[],
  existing: TerminalCommandHistoryItem[] = [],
) {
  const byId = new Map<string, TerminalCommandHistoryItem>();
  [...incoming, ...existing].forEach(item => {
    if (item.command.trim()) byId.set(item.id, item);
  });

  return Array.from(byId.values())
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 40);
}
