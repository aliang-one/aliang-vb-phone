import {
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
});
