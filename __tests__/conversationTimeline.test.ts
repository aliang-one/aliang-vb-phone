import {
  approvalTimelineItemId,
  buildConversationTimeline,
  isDeviceLinkReleaseNotice,
} from '../src/utils/conversationTimeline';
import type { DisplayTranscriptMessage } from '../src/utils/agentTranscript';
import { buildConversationTurns } from '../src/utils/conversationTurns';
import type { ApprovalRequest } from '../src/store/types';

const message = (
  id: string,
  timestamp: string,
): DisplayTranscriptMessage => ({
  id,
  role: 'user',
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
      buildConversationTurns([
        message('before', '2026-06-20T10:00:00.000Z'),
        message('after', '2026-06-20T10:02:00.000Z'),
      ]),
      [approval('approval-1', '2026-06-20T10:01:00.000Z')],
    );

    expect(timeline.map(item => item.id)).toEqual([
      'turn:before',
      approvalTimelineItemId('approval-1'),
      'turn:after',
    ]);
  });

  it('keeps stable order when legacy timestamps cannot be parsed', () => {
    const timeline = buildConversationTimeline(
      buildConversationTurns([message('legacy-message', '10:00')]),
      [approval('legacy-approval', '10:01')],
    );

    expect(timeline.map(item => item.id)).toEqual([
      'turn:legacy-message',
      approvalTimelineItemId('legacy-approval'),
    ]);
  });
});

describe('isDeviceLinkReleaseNotice', () => {
  const releaseNotice = {
    id: 'evt_legacy1',
    type: 'status' as const,
    title: 'Agent disconnected',
    detail:
      'AI run state was released because the desktop Agent disconnected (disconnected).',
    status: 'failed' as const,
    timestamp: '2026-09-22T03:09:08.960Z',
  };

  it('matches the server disconnect-release status notice', () => {
    expect(isDeviceLinkReleaseNotice(releaseNotice)).toBe(true);
  });

  it('ignores other failed status events (real timeout/overrun history)', () => {
    const timedOut = {
      ...releaseNotice,
      title: 'Session timed out',
      detail: 'No agent activity for 10 min — marked idle',
    };
    expect(isDeviceLinkReleaseNotice(timedOut)).toBe(false);
  });

  it('ignores non-failed or non-status events', () => {
    const doneNotice = { ...releaseNotice, status: 'done' as const };
    const commandEvent = { ...releaseNotice, type: 'command' as const };
    const interrupted = { ...releaseNotice, title: 'Turn interrupted' };
    expect(isDeviceLinkReleaseNotice(doneNotice)).toBe(false);
    expect(isDeviceLinkReleaseNotice(commandEvent)).toBe(false);
    expect(isDeviceLinkReleaseNotice(interrupted)).toBe(false);
  });
});
