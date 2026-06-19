import {
  mergeEarlierAgentMessages,
  serverAiSessionToVibeRun,
} from '../src/store/internals';

describe('AI history pagination', () => {
  it('prepends earlier pages and preserves index order when present', () => {
    const merged = mergeEarlierAgentMessages(
      [
        {
          id: 'm3',
          role: 'assistant',
          content: 'newer',
          timestamp: '2026-06-19T10:03:00Z',
          index: 3,
        },
      ],
      [
        {
          id: 'm1',
          role: 'user',
          content: 'older',
          timestamp: '2026-06-19T10:01:00Z',
          index: 1,
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'middle',
          timestamp: '2026-06-19T10:02:00Z',
          index: 2,
        },
      ],
    );

    expect(merged.map(message => message.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('maps server transcript_page metadata into the mobile run', () => {
    const run = serverAiSessionToVibeRun(
      {
        session_id: 'ai_import_1',
        kind: 'ai',
        user_id: 'u1',
        device_id: 'd1',
        status: 'closed',
        mode: 'vibe',
        title: 'Imported session',
        provider: 'codex',
        transcript_count: 128,
        transcript_page: {
          limit: 40,
          count: 40,
          total_count: 128,
          has_more: true,
          next_before_cursor: 'before:abc',
          next_before_message_id: 'm40',
          cache_status: 'cold',
          fetched_at: '2026-06-19T10:00:00Z',
        },
        transcript: [
          {
            id: 'm41',
            role: 'user',
            content: 'latest page',
            timestamp: '2026-06-19T10:01:00Z',
            index: 41,
          },
        ],
        created_at: '2026-06-19T09:00:00Z',
        last_active_at: '2026-06-19T10:01:00Z',
      },
      [],
      [],
    );

    expect(run.transcriptCount).toBe(128);
    expect(run.transcriptPage).toMatchObject({
      limit: 40,
      count: 40,
      totalCount: 128,
      hasMore: true,
      nextBeforeCursor: 'before:abc',
      nextBeforeMessageId: 'm40',
    });
    expect(run.transcript[0]).toMatchObject({ id: 'm41', index: 41 });
  });
});
