import { buildDisplayTranscript } from '../agentTranscript';
import type { AgentMessage } from '../../data/platformModels';

const msg = (over: Partial<AgentMessage> & { id: string; role: AgentMessage['role'] }): AgentMessage =>
  ({
    content: 'hello',
    timestamp: '2026-08-05T10:00:00Z',
    ...over,
  }) as AgentMessage;

describe('buildDisplayTranscript — 阶段契约(display 合并)', () => {
  it('连续同角色字节相同 → 去重一条(乐观+快照双存的兜底)', () => {
    const out = buildDisplayTranscript([
      msg({ id: 'a1', role: 'user', content: '你好' }),
      msg({ id: 'a2', role: 'user', content: '你好' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].sourceMessageIds).toEqual(['a1']);
  });

  it('连续 user 不同内容 → 各自气泡(不合并:"你好"+"在吗"反例)', () => {
    const out = buildDisplayTranscript([
      msg({ id: 'u1', role: 'user', content: '你好' }),
      msg({ id: 'u2', role: 'user', content: '在吗' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map(m => m.id)).toEqual(['u1', 'u2']);
  });

  it('连续 assistant 不同内容 → 各自气泡(多回合不被合一个大气泡)', () => {
    const out = buildDisplayTranscript([
      msg({ id: 'a1', role: 'assistant', content: 'first turn' }),
      msg({ id: 'a2', role: 'assistant', content: 'second turn' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('空内容(无 segment)→ 整条丢弃,不留空泡', () => {
    const out = buildDisplayTranscript([
      msg({ id: 'e1', role: 'assistant', content: '   ' }),
      msg({ id: 'u1', role: 'user', content: 'hi' }),
    ]);
    expect(out.map(m => m.id)).toEqual(['u1']);
  });

  it('system 消息合并进前一个 system 气泡;system 后跟非 system 起新泡', () => {
    const out = buildDisplayTranscript([
      msg({ id: 's1', role: 'system', content: 'line 1' }),
      msg({ id: 's2', role: 'system', content: 'line 2' }),
      msg({ id: 'u1', role: 'user', content: 'q' }),
      msg({ id: 's3', role: 'system', content: 'line 3' }),
    ]);
    // s1+s2 coalesced into one system bubble, u1 separate, s3 new system bubble.
    expect(out.map(m => m.role)).toEqual(['system', 'user', 'system']);
    expect(out[0].sourceMessageIds).toEqual(['s1', 's2']);
    expect(out[0].mergedCount).toBe(2);
    expect(out[2].sourceMessageIds).toEqual(['s3']);
  });

  it('角色切换后再出现同角色 → 新气泡(不被跨角色去重误吞)', () => {
    const out = buildDisplayTranscript([
      msg({ id: 'u1', role: 'user', content: 'same' }),
      msg({ id: 'a1', role: 'assistant', content: 'reply' }),
      msg({ id: 'u2', role: 'user', content: 'same' }),
    ]);
    // 两句 'same' 分属不同 user 回合(中间隔 assistant),必须都保留。
    expect(out.filter(m => m.role === 'user')).toHaveLength(2);
  });
});
