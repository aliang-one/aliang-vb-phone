import {
  getTerminalInteractionState,
  getTerminalStatusChip,
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
});
