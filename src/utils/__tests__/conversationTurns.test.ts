import { buildConversationTurns } from '../conversationTurns';
import type { DisplayTranscriptMessage } from '../agentTranscript';

const m = (
  id: string,
  role: DisplayTranscriptMessage['role'],
  content: string,
): DisplayTranscriptMessage =>
  ({
    id,
    role,
    timestamp: '2026-08-05T10:00:00Z',
    segments: [],
    mergedCount: 1,
    contentKey: content,
    sourceMessageIds: [id],
  }) as unknown as DisplayTranscriptMessage;

describe('buildConversationTurns — 阶段契约(回合分组)', () => {
  it('user 消息开启新回合;后续非 user 并入当前回合', () => {
    const turns = buildConversationTurns([
      m('u1', 'user', '你好'),
      m('a1', 'assistant', '在'),
      m('a2', 'assistant', '吗'),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('user');
    expect(turns[0].messageIds).toEqual(['u1', 'a1', 'a2']);
  });

  it('每个 user 消息切一个新回合(多轮对话)', () => {
    const turns = buildConversationTurns([
      m('u1', 'user', 'q1'),
      m('a1', 'assistant', 'r1'),
      m('u2', 'user', 'q2'),
      m('a2', 'assistant', 'r2'),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0].messageIds).toEqual(['u1', 'a1']);
    expect(turns[1].messageIds).toEqual(['u2', 'a2']);
  });

  it('以非 user 开头 → 自成一回合(role 取该消息)', () => {
    const turns = buildConversationTurns([m('a1', 'assistant', 'leading reply')]);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('assistant');
    expect(turns[0].id).toBe('turn:a1');
  });

  it('回合 id = turn:<首条消息 id>;多消息回合聚合 sourceMessageIds', () => {
    const turns = buildConversationTurns([
      m('a0', 'assistant', 'pre'),
      m('u1', 'user', 'the question'),
    ]);
    // a0 starts a turn; u1 starts a NEW turn.
    expect(turns).toHaveLength(2);
    expect(turns[0].id).toBe('turn:a0');
    expect(turns[1].id).toBe('turn:u1');
    // preview 文本来自 summarizeMessage(segments) — 另一关注点,此处只验分组。
  });

  it('空输入 → 空回合列表', () => {
    expect(buildConversationTurns([])).toEqual([]);
  });

  it('sourceMessageIds 聚合去重', () => {
    const turns = buildConversationTurns([
      m('u1', 'user', 'q'),
      m('a1', 'assistant', 'r1'),
      m('a1', 'assistant', 'r1-dup'), // same source id (shouldn't double-count)
    ]);
    expect(turns[0].sourceMessageIds).toEqual(['u1', 'a1']);
  });
});
