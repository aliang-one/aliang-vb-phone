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
  'completed',
  'failed',
  'stopped',
  'waiting_approval',
]);

const activeTerminalStatuses = new Set<TerminalSessionStatus>([
  'running',
  'idle',
  'waiting_approval',
]);

export const isActiveTerminalSessionStatus = (
  status: TerminalSessionStatus,
) => activeTerminalStatuses.has(status);

/**
 * The device's most recent ACTIVE terminal session — the session an entry
 * point (or the terminal screen's default) should attach to under the
 * "one default terminal per device" product rule. Ties on updatedAt fall
 * back to createdAt, newest first.
 */
export const findRecentActiveTerminalSession = <
  T extends {
    deviceId: string;
    status: TerminalSessionStatus;
    updatedAt: string;
    createdAt: string;
  },
>(
  sessions: T[],
  deviceId: string,
): T | undefined => {
  let recent: T | undefined;
  for (const session of sessions) {
    if (session.deviceId !== deviceId) continue;
    if (!isActiveTerminalSessionStatus(session.status)) continue;
    if (
      !recent ||
      session.updatedAt > recent.updatedAt ||
      (session.updatedAt === recent.updatedAt &&
        session.createdAt > recent.createdAt)
    ) {
      recent = session;
    }
  }
  return recent;
};

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
