import type { ApprovalRequest } from '../store/types';
import type { ConversationTurn } from './conversationTurns';

export const approvalTimelineItemId = (approvalId: string) =>
  `approval:${approvalId}`;

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
