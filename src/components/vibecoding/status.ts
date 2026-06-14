import { VibeStatus } from '../../data/platformModels';

export const vibeStatusLabel: Record<VibeStatus, string> = {
  idle: 'IDLE',
  running: 'RUNNING',
  waiting_user: 'NEEDS INPUT',
  waiting_approval: 'APPROVAL',
  testing: 'TESTING',
  preview_ready: 'PREVIEW',
  failed: 'FAILED',
  completed: 'DONE',
  paused: 'PAUSED',
};

export const vibeStatusType: Record<
  VibeStatus,
  'success' | 'warning' | 'error' | 'neutral' | 'info'
> = {
  idle: 'neutral',
  running: 'success',
  waiting_user: 'warning',
  waiting_approval: 'warning',
  testing: 'info',
  preview_ready: 'info',
  failed: 'error',
  completed: 'success',
  paused: 'neutral',
};
