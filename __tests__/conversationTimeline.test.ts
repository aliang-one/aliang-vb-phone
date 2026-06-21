import {
  approvalTimelineItemId,
  buildConversationTimeline,
} from '../src/utils/conversationTimeline';
import type { DisplayTranscriptMessage } from '../src/utils/agentTranscript';
import type { ApprovalRequest } from '../src/store/types';

const message = (
  id: string,
  timestamp: string,
): DisplayTranscriptMessage => ({
  id,
  role: 'assistant',
  timestamp,
  mergedCount: 1,
  segments: [
    {
      id: `${id}:text`,
      kind: 'text',
      content: id,
      blocks: [
        {
          kind: 'paragraph',
          children: [{ kind: 'text', content: id }],
        },
      ],
    },
  ],
  sourceMessageIds: [id],
});

const approval = (id: string, createdAt: string): ApprovalRequest => ({
  id,
  kind: 'client_response',
  title: 'Approval requested',
  summary: 'Confirm action',
  deviceId: 'device-1',
  projectId: 'project-1',
  sessionId: 'session-1',
  risk: 'medium',
  status: 'pending',
  createdAt,
});

describe('buildConversationTimeline', () => {
  it('places approval cards at their chronological chat position', () => {
    const timeline = buildConversationTimeline(
      [
        message('before', '2026-06-20T10:00:00.000Z'),
        message('after', '2026-06-20T10:02:00.000Z'),
      ],
      [approval('approval-1', '2026-06-20T10:01:00.000Z')],
    );

    expect(timeline.map(item => item.id)).toEqual([
      'message:before',
      approvalTimelineItemId('approval-1'),
      'message:after',
    ]);
  });

  it('keeps stable order when legacy timestamps cannot be parsed', () => {
    const timeline = buildConversationTimeline(
      [message('legacy-message', '10:00')],
      [approval('legacy-approval', '10:01')],
    );

    expect(timeline.map(item => item.id)).toEqual([
      'message:legacy-message',
      approvalTimelineItemId('legacy-approval'),
    ]);
  });
});
