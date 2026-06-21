import type { ApprovalRequest } from '../store/types';
import type { DisplayTranscriptMessage } from './agentTranscript';

export const approvalTimelineItemId = (approvalId: string) =>
  `approval:${approvalId}`;

export type ConversationTimelineItem =
  | {
      kind: 'message';
      id: string;
      timestamp: string;
      message: DisplayTranscriptMessage;
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
  messages: DisplayTranscriptMessage[],
  approvals: ApprovalRequest[],
): ConversationTimelineItem[] => {
  const items: SortableTimelineItem[] = [
    ...messages.map((message, index) => ({
      kind: 'message' as const,
      id: `message:${message.id}`,
      timestamp: message.timestamp,
      message,
      order: index * 2,
      timestampMs: parseTimestamp(message.timestamp),
    })),
    ...approvals.map((approval, index) => ({
      kind: 'approval' as const,
      id: approvalTimelineItemId(approval.id),
      timestamp: approval.createdAt,
      approval,
      order: messages.length * 2 + index,
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
