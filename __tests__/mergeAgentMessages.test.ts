import { mergeAgentMessages } from '../src/store/internals';
import type { AgentMessage } from '../src/data/platformModels';

const message = (
  id: string,
  role: AgentMessage['role'],
  content: string,
  extra: Partial<AgentMessage> = {},
): AgentMessage => ({
  id,
  role,
  content,
  timestamp: extra.timestamp ?? '2026-06-16T10:00:00.000Z',
  ...extra,
});

describe('mergeAgentMessages', () => {
  it('appends a newly sent user prompt after the existing conversation', () => {
    const merged = mergeAgentMessages(
      [
        message('m1', 'user', 'Initial prompt'),
        message('m2', 'assistant', 'Initial reply'),
      ],
      [message('tmp', 'user', 'Follow-up', { pending: true })],
    );

    expect(merged.map(item => item.id)).toEqual(['m1', 'm2', 'tmp']);
    expect(merged[2]).toMatchObject({
      role: 'user',
      content: 'Follow-up',
      pending: true,
    });
  });

  it('replaces a pending optimistic prompt when the server confirms it', () => {
    const merged = mergeAgentMessages(
      [
        message('m1', 'assistant', 'Ready.'),
        message('tmp', 'user', 'Do the thing', { mode: 'text', pending: true }),
      ],
      [
        message('server-msg', 'user', 'Do the thing', {
          mode: 'text',
          timestamp: '2026-06-16T10:01:00.000Z',
        }),
      ],
    );

    expect(merged.map(item => item.id)).toEqual(['m1', 'server-msg']);
    expect(merged[1]).toMatchObject({
      role: 'user',
      content: 'Do the thing',
      pending: false,
    });
  });

  it('keeps a longer local assistant stream over a stale server snapshot', () => {
    const merged = mergeAgentMessages(
      [message('assistant-1', 'assistant', 'partial answer with more text')],
      [message('assistant-1', 'assistant', 'partial answer')],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].content).toBe('partial answer with more text');
  });

  it('keeps unmatched incoming user prompts in order without dropping earlier history', () => {
    const merged = mergeAgentMessages(
      [
        message('a', 'assistant', 'Hello'),
        message('b', 'user', 'Question'),
      ],
      [message('c', 'user', 'Follow-up', { pending: true })],
    );

    expect(merged.map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(merged[2]).toMatchObject({
      role: 'user',
      content: 'Follow-up',
      pending: true,
    });
  });
});
