import {
  findActiveTerminalSessionByDirectory,
  getTerminalInteractionState,
  getTerminalStatusChip,
  isActiveTerminalSessionStatus,
  isTerminalInputAvailable,
} from '../src/utils/terminalInteraction';

describe('terminalInteraction', () => {
  it('treats a running terminal session as interactive and ready', () => {
    expect(
      isTerminalInputAvailable({
        terminalStatus: 'running',
        deviceStatus: 'online',
      }),
    ).toBe(true);
    expect(
      getTerminalInteractionState({
        terminalStatus: 'running',
        deviceStatus: 'online',
        command: 'pwd',
      }),
    ).toMatchObject({
      inputEnabled: true,
      canExecute: true,
      executeLabel: 'EXECUTE',
    });
    expect(getTerminalStatusChip('running')).toEqual({
      label: 'READY',
      type: 'success',
    });
  });

  it('blocks input when the terminal is unavailable, closed, or waiting on approval', () => {
    expect(
      getTerminalInteractionState({
        terminalStatus: 'waiting_approval',
        deviceStatus: 'online',
        command: 'pwd',
      }),
    ).toMatchObject({
      inputEnabled: false,
      canExecute: false,
    });
    expect(
      getTerminalInteractionState({
        terminalStatus: 'completed',
        deviceStatus: 'online',
        command: 'pwd',
      }),
    ).toMatchObject({
      inputEnabled: false,
      canExecute: false,
    });
    expect(
      getTerminalInteractionState({
        terminalStatus: 'running',
        deviceStatus: 'offline',
        command: 'pwd',
      }),
    ).toMatchObject({
      inputEnabled: false,
      canExecute: false,
    });
  });

  it('identifies terminal sessions that should remain visible as active', () => {
    expect(isActiveTerminalSessionStatus('running')).toBe(true);
    expect(isActiveTerminalSessionStatus('idle')).toBe(true);
    expect(isActiveTerminalSessionStatus('waiting_approval')).toBe(true);
    expect(isActiveTerminalSessionStatus('completed')).toBe(false);
    expect(isActiveTerminalSessionStatus('failed')).toBe(false);
    expect(isActiveTerminalSessionStatus('stopped')).toBe(false);
  });

  describe('findActiveTerminalSessionByDirectory (切目录复用, RCA 2026-09-28)', () => {
    const sessions = [
      { id: 't1', deviceId: 'd1', directory: '/tmp/a', status: 'running' },
      { id: 't2', deviceId: 'd1', directory: '/tmp/b', status: 'idle' },
      { id: 't3', deviceId: 'd2', directory: '/tmp/a', status: 'running' },
      { id: 't4', deviceId: 'd1', directory: '/tmp/a', status: 'completed' },
    ] as any[];

    it('reuses the active session on the exact device+directory', () => {
      expect(
        findActiveTerminalSessionByDirectory(sessions, 'd1', '/tmp/a')?.id,
      ).toBe('t1');
      expect(
        findActiveTerminalSessionByDirectory(sessions, 'd1', '/tmp/b')?.id,
      ).toBe('t2');
    });

    it('ignores other devices, other directories, and dead sessions', () => {
      expect(
        findActiveTerminalSessionByDirectory(sessions, 'd2', '/tmp/b'),
      ).toBeUndefined();
      expect(
        findActiveTerminalSessionByDirectory(sessions, 'd1', '/tmp/c'),
      ).toBeUndefined();
      expect(
        findActiveTerminalSessionByDirectory(
          [sessions[3]!],
          'd1',
          '/tmp/a',
        ),
      ).toBeUndefined();
    });

    it('returns undefined when nothing matches', () => {
      expect(findActiveTerminalSessionByDirectory([], 'd1', '/tmp/a')).toBeUndefined();
    });
  });
});
