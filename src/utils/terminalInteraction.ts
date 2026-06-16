import type { DeviceStatus } from '../data/platformModels';
import type { TerminalSessionStatus } from '../store/types';

export type TerminalStatusChipType =
  | 'success'
  | 'warning'
  | 'error'
  | 'neutral'
  | 'info';

interface TerminalInteractionInput {
  terminalStatus?: TerminalSessionStatus;
  deviceStatus?: DeviceStatus;
  terminalOpening?: boolean;
  command?: string;
}

const blockedInputStatuses = new Set<TerminalSessionStatus>([
  'failed',
  'stopped',
  'waiting_approval',
]);

export const isTerminalInputAvailable = ({
  terminalStatus,
  deviceStatus,
  terminalOpening = false,
}: TerminalInteractionInput) =>
  Boolean(terminalStatus) &&
  deviceStatus !== 'offline' &&
  !terminalOpening &&
  !blockedInputStatuses.has(terminalStatus as TerminalSessionStatus);

export const canChangeTerminalDirectory = ({
  deviceStatus,
  terminalOpening = false,
}: Pick<TerminalInteractionInput, 'deviceStatus' | 'terminalOpening'>) =>
  deviceStatus !== 'offline' && !terminalOpening;

export const getTerminalInteractionState = (
  input: TerminalInteractionInput,
) => {
  const inputEnabled = isTerminalInputAvailable(input);
  const canChangeDirectory = canChangeTerminalDirectory(input);
  const canExecute = inputEnabled && Boolean(input.command?.trim());

  return {
    inputEnabled,
    canChangeDirectory,
    canExecute,
    executeLabel: input.terminalOpening ? 'OPENING' : 'EXECUTE',
  };
};

export const getTerminalStatusChip = (
  status: TerminalSessionStatus = 'idle',
): { label: string; type: TerminalStatusChipType } => {
  switch (status) {
    case 'running':
      return { label: 'READY', type: 'success' };
    case 'completed':
      return { label: 'DONE', type: 'success' };
    case 'failed':
      return { label: 'FAILED', type: 'error' };
    case 'stopped':
      return { label: 'STOPPED', type: 'warning' };
    case 'waiting_approval':
      return { label: 'APPROVAL', type: 'warning' };
    default:
      return { label: 'READY', type: 'neutral' };
  }
};
