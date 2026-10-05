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

describe('buildDisplayTranscript — system 工件噪音行显示层兜底', () => {
  // 旧版 agent 历史解析把 tool_result 摊平成 role='system' 消息，打开会话会
  // 渲染出一墙 "Updated task #N status"/"[1]+ Done"/"patched" 状态行。新版
  // server/agent 已从源头拦住，这里对仍在内存/旧服务端数据里的残留兜底丢弃。
  const noise = (id: string, content: string) => msg({ id, role: 'system', content });

  it.each([
    ['Updated task #8 status'],
    ['patched'],
    ['TYPECHECK_EXIT=0'],
    ['BUILD_EXIT=0 - Use build.rolldownOptions.output.codeSplitting'],
    ['[1]+  Done    setsid nohup node server/index.mjs >> /tmp/gw.log'],
    ['<retrieval_status>success</retrieval_status>\n\n<task_id>bqn95d6yn</task_id>'],
    ['Command running in background with ID: bqn95d6yn. Output is being written to /tmp/x'],
    ['\npatched\n Test Files  1 passed (1)'],
  ])('丢一行式工具状态噪音: %j', content => {
    const out = buildDisplayTranscript([
      msg({ id: 'u1', role: 'user', content: 'q' }),
      noise('n1', content),
    ]);
    expect(out.map(m => m.id)).toEqual(['u1']);
  });

  it('多行有意义内容(Playwright 报告等)不误杀', () => {
    const out = buildDisplayTranscript([
      noise('k1', '### Ran Playwright code\n```js\nawait page.goto("/")\n```'),
    ]);
    expect(out).toHaveLength(1);
  });

  it('只对 role=system 生效(assistant 说 patched 要保留)', () => {
    const out = buildDisplayTranscript([msg({ id: 'a1', role: 'assistant', content: 'patched' })]);
    expect(out).toHaveLength(1);
  });

  it('跳过噪音行不污染去重状态(不同的相邻消息都保留)', () => {
    const out = buildDisplayTranscript([
      msg({ id: 'a1', role: 'assistant', content: 'A' }),
      noise('n1', 'Updated task #8 status'),
      msg({ id: 'a2', role: 'assistant', content: 'B' }),
      noise('n2', 'patched'),
      msg({ id: 'u1', role: 'user', content: 'next' }),
    ]);
    expect(out.map(m => m.id)).toEqual(['a1', 'a2', 'u1']);
  });

  it('同内容 assistant 被噪音行隔开 → 过滤后按连续重复合并(双存工件对的期望行为)', () => {
    // 流式+快照双存的历史形态正是 "文本A + 工件行 + 文本A"：噪音让位后两者
    // 相邻,既有的连续去重把这对工件合并成一条——这是修复而非回归。
    const out = buildDisplayTranscript([
      msg({ id: 'a1', role: 'assistant', content: '门禁跑着。趁机自审完整 diff:' }),
      noise('n1', '[1]+  Done    setsid nohup node server/index.mjs'),
      msg({ id: 'a2', role: 'assistant', content: '门禁跑着。趁机自审完整 diff:' }),
    ]);
    expect(out.map(m => m.id)).toEqual(['a1']);
  });
});

describe('buildDisplayTranscript — harness 信封消息重分类为 system', () => {
  const taskNotice = [
    '<task-notification>',
    '<task-id>b876t1utc</task-id>',
    '<tool-use-id>call_0ec7</tool-use-id>',
    '<output-file>/tmp/b876t1utc.output</output-file>',
    '<status>completed</status>',
    '<summary>Background command "Release 构建" completed (exit code 0)</summary>',
    '</task-notification>',
  ].join('\n');

  it('纯 task-notification 的 user 消息 → system 角色(灰条可展开,不占用户气泡)', () => {
    const out = buildDisplayTranscript([msg({ id: 't1', role: 'user', content: taskNotice })]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('system');
  });

  it('命令簇(user 触发的 /command 记录) → system 角色', () => {
    const cluster = '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args></command-args>';
    const out = buildDisplayTranscript([msg({ id: 'c1', role: 'user', content: cluster })]);
    expect(out[0].role).toBe('system');
  });

  it('散文 + 信封混合 → 保持 user 角色(不能吞掉真话)', () => {
    const out = buildDisplayTranscript([
      msg({ id: 'm1', role: 'user', content: `帮我看看这个\n<system-reminder>ctx</system-reminder>` }),
    ]);
    expect(out[0].role).toBe('user');
  });

  it('连续信封消息合并进同一个 system 气泡', () => {
    const out = buildDisplayTranscript([
      msg({ id: 't1', role: 'user', content: taskNotice }),
      msg({ id: 't2', role: 'user', content: taskNotice.replace('b876t1utc', 'aaaa2zzzz') }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('system');
    expect(out[0].sourceMessageIds).toEqual(['t1', 't2']);
  });

  it('真用户消息不受影响', () => {
    const out = buildDisplayTranscript([msg({ id: 'u1', role: 'user', content: '你好' })]);
    expect(out[0].role).toBe('user');
  });
});
