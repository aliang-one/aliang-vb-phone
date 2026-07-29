import type { GoalState } from '../data/platformModels';

/**
 * Shared Goal-state → display presentation (Phase 1 可信签署闸).
 *
 * Extracted from the duplicated `stateLabels`/`toneForState` maps that lived
 * inline in both `GoalStatusBar` and `GoalDetailScreen`. The sign-off gate adds
 * `awaiting_user_acceptance`; defining it here once keeps the two surfaces in
 * sync (the bar and the detail screen must never disagree on a goal's label or
 * tone — a disagreement was exactly the "shows completed while awaiting sign-off"
 * bug codex #16 flagged).
 */
export const GOAL_STATE_LABELS: Record<GoalState, string> = {
  planning: '规划中',
  planning_failed: '规划需处理',
  awaiting_approval: '等待确认',
  active: '执行中',
  approval_pending: '等待审批',
  pause_requested: '等待本轮结束',
  verifying: '验证中',
  awaiting_user_acceptance: '待你确认完成',
  paused: '已暂停',
  blocked: '需要处理',
  budget_limited: '预算受限',
  cancel_requested: '正在停止',
  abandoned: '已放弃',
  cancelled: '已取消',
  completed: '已完成',
};

export type GoalStateTone = 'primary' | 'success' | 'warning' | 'error' | 'neutral';

/**
 * Goal-state → tone. awaiting_user_acceptance is **warning** (action-needed,
 * mirrors awaiting_approval) — NOT success/completed. The goal has NOT completed
 * until the user signs off; coloring it green/success would re-create the false
 * completion the sign-off gate exists to prevent.
 */
export const goalToneForState = (state?: string): GoalStateTone => {
  switch (state) {
    case 'completed':
      return 'success';
    case 'awaiting_user_acceptance':
    case 'awaiting_approval':
      return 'warning';
    case 'blocked':
    case 'planning_failed':
    case 'budget_limited':
      return 'error';
    case 'paused':
    case 'cancelled':
    case 'abandoned':
      return 'neutral';
    default:
      return 'primary';
  }
};

/** Human label for a goal state, falling back to the raw enum then '同步中'. */
export const goalStateLabel = (state?: string): string =>
  state ? (GOAL_STATE_LABELS[state as GoalState] ?? state) : '同步中';

/**
 * States where the goal needs the user to act (sign off / approve / unblock).
 * The session-phase header must NOT show "已完成" while a goal session is in one
 * of these — the GoalStatusBar is the authoritative indicator for goal sessions.
 * (Phase 1 可信签署闸, codex #16.)
 */
export const GOAL_USER_ACTION_STATES: ReadonlySet<string> = new Set([
  'awaiting_user_acceptance',
  'awaiting_approval',
  'blocked',
  'planning_failed',
]);
