import type { ApprovalRequest } from '../store/types';
import type { ConversationTurn } from './conversationTurns';
import type { GoalFoldGroup } from './goalFolds';

export const approvalTimelineItemId = (approvalId: string) =>
  `approval:${approvalId}`;

/** Stable id for a Goal-deleted fold's position in the timeline. */
export const goalFoldTimelineItemId = (goalId: string) => `goal-fold:${goalId}`;

export type ConversationTimelineItem =
  | {
      kind: 'turn';
      id: string;
      timestamp: string;
      turn: ConversationTurn;
    }
  | {
      kind: 'approval';
      id: string;
      timestamp: string;
      approval: ApprovalRequest;
    }
  | {
      kind: 'goal-fold';
      id: string;
      timestamp: string;
      fold: GoalFoldGroup;
    };

type SortableTimelineItem = ConversationTimelineItem & {
  order: number;
  timestampMs?: number;
};

const parseTimestamp = (timestamp: string) => {
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : undefined;
};

export const buildConversationTimeline = (
  turns: ConversationTurn[],
  approvals: ApprovalRequest[],
  folds: GoalFoldGroup[] = [],
): ConversationTimelineItem[] => {
  const items: SortableTimelineItem[] = [
    ...turns.map((turn, index) => ({
      kind: 'turn' as const,
      id: turn.id,
      timestamp: turn.timestamp,
      turn,
      order: index * 2,
      timestampMs: parseTimestamp(turn.timestamp),
    })),
    ...approvals.map((approval, index) => ({
      kind: 'approval' as const,
      id: approvalTimelineItemId(approval.id),
      timestamp: approval.createdAt,
      approval,
      order: turns.length * 2 + index,
      timestampMs: parseTimestamp(approval.createdAt),
    })),
    ...folds.map((fold, index) => ({
      kind: 'goal-fold' as const,
      id: goalFoldTimelineItemId(fold.goalId),
      timestamp: fold.anchorTimestamp,
      fold,
      order: turns.length * 2 + approvals.length * 2 + index,
      timestampMs: parseTimestamp(fold.anchorTimestamp),
    })),
  ];

  return items
    .sort((left, right) => {
      if (left.timestampMs !== undefined && right.timestampMs !== undefined) {
        const timeDelta = left.timestampMs - right.timestampMs;
        if (timeDelta !== 0) return timeDelta;
      }
      return left.order - right.order;
    })
    .map(({ order: _order, timestampMs: _timestampMs, ...item }) => item);
};
