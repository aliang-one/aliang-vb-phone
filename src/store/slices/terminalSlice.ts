import type { StateCreator } from 'zustand';
import { platformTransport } from '../../services/platformTransport';
import { disposeTerminalOutput } from '../../services/terminalOutputRegistry';
import type {
  ControlCenterState,
  TerminalCommandHistoryItem,
  TerminalSessionStatus,
} from '../types';
import {
  beginTerminalReplayStream,
  event,
  line,
  MAX_TERMINAL_LINES,
  mergeTerminalSessionSnapshot,
  nowTime,
  serverTerminalSessionToClient,
  tail,
} from '../internals';

type TerminalSlice = Pick<
  ControlCenterState,
  | 'terminalSessions'
  | 'terminalCommandHistory'
  | 'createTerminalSession'
  | 'attachTerminalSession'
  | 'executeTerminalCommand'
  | 'clearTerminal'
  | 'resetTerminalReplay'
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

  attachTerminalSession: async (sessionId, options) => {
    if (!get().serverMode) {
      throw new Error(
        'Platform connection is required before attaching a terminal.',
      );
    }

    // Cold attach (session unknown locally — e.g. right after an app restart):
    // register a placeholder BEFORE the request so `terminal.replay` frames
    // that race ahead of the REST response still have a buffer to land in.
    let addedPlaceholder = false;
    set(state => {
      if (state.terminalSessions.some(item => item.id === sessionId)) {
        // Re-attach: start a FRESH replay stream so the new scrollback
        // replaces — never appends to — the previous one.
        return {
          terminalSessions: state.terminalSessions.map(item =>
            item.id === sessionId ? beginTerminalReplayStream(item) : item,
          ),
        };
      }
      addedPlaceholder = true;
      const attachedAt = nowTime();
      return {
        terminalSessions: [
          {
            id: sessionId,
            deviceId: options?.deviceId ?? '',
            directory: '~',
            shell: 'zsh',
            status: 'running' as TerminalSessionStatus,
            lines: [],
            createdAt: attachedAt,
            updatedAt: attachedAt,
            replayChunks: [],
            replayReady: false,
            replayTruncated: false,
          },
          ...state.terminalSessions,
        ],
      };
    });

    try {
      const serverSession = await platformTransport.attachTerminalSession(
        sessionId,
        { rows: options?.rows ?? 24, cols: options?.cols ?? 80 },
      );
      const incoming = serverTerminalSessionToClient(serverSession);
      set(state => ({
        terminalSessions: state.terminalSessions.map(item =>
          item.id === incoming.id
            ? // Snapshot merge fills the placeholder's real device/cwd/shell
              // while preserving any replay frames that already arrived.
              mergeTerminalSessionSnapshot(item, incoming)
            : item,
        ),
      }));
      return incoming.id;
    } catch (error) {
      if (addedPlaceholder) {
        // Don't leave a bogus (unknown-device) session behind in list views.
        set(state => ({
          terminalSessions: state.terminalSessions.filter(
            item => item.id !== sessionId,
          ),
        }));
      }
      throw error;
    }
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

  resetTerminalReplay: sessionId => {
    set(state => ({
      terminalSessions: state.terminalSessions.map(item =>
        item.id === sessionId ? beginTerminalReplayStream(item) : item,
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
    disposeTerminalOutput(terminalId);
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
    disposeTerminalOutput(sessionId);
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

export function mergeCommandHistory(
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
