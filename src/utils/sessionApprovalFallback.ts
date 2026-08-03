import type { VibeCodingRun } from '../data/platformModels';

type ApprovalEventStatus =
  | 'done'
  | 'running'
  | 'waiting'
  | 'failed'
  | string;

type ApprovalFallbackSession = Pick<
  VibeCodingRun,
  'status' | 'phase' | 'runState' | 'runStateVersion'
>;

const isTerminalSession = (session: Partial<ApprovalFallbackSession>): boolean => {
  if (session.status === 'failed') return true;

  if (session.runStateVersion !== undefined) {
    if (
      session.runState === 'completed' ||
      session.runState === 'failed' ||
      session.runState === 'cancelled' ||
      session.runState === 'timed_out'
    ) {
      return true;
    }
    if (
      session.runState === 'queued' ||
      session.runState === 'running' ||
      session.runState === 'waiting_approval' ||
      session.runState === 'cancelling'
    ) {
      return false;
    }
  }

  if (session.phase === 'completed' || session.phase === 'failed') return true;
  if (session.phase === 'running' || session.phase === 'waiting_approval') return false;
  return session.status === 'completed';
};

/**
 * Session events are history, not the source of truth for current approvals.
 * Keep their fallback only while the owning run can still be actionable.
 */
export const fallbackApprovalStatus = (
  eventStatus: ApprovalEventStatus,
  session: Partial<ApprovalFallbackSession>,
): 'pending' | 'approved' | 'denied' | undefined => {
  if (eventStatus === 'done') return 'approved';
  if (eventStatus === 'failed') return 'denied';
  return isTerminalSession(session) ? undefined : 'pending';
};
