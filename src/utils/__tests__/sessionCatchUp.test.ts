import type { AgentMessage, VibeCodingRun } from '../../data/platformModels';
import {
  isClientGeneratedMessageId,
  isSessionBehindTranscript,
  latestServerConfirmedMessageId,
  materializedServerMessageCount,
} from '../sessionCatchUp';

// 会话消息水位与增量锚点的纯函数契约(服务端 transcript_count 对账):
// - "本地已物化的服务端消息数"只数 server 确认过的消息(pending/failed/
//   客户端自造 id 都不算),这样乐观发送、流式半程都不会虚高掩盖真实缺口;
// - behind = 服务端总数 > 本地物化数;
// - 锚点 = 本地尾部最后一条 server 确认消息的 id(增量拉取的 after 参数)。

const makeRun = (transcript: AgentMessage[], overrides: Partial<VibeCodingRun> = {}): VibeCodingRun =>
  ({
    id: 'sess-1',
    title: 't',
    deviceId: 'd1',
    projectId: 'p1',
    directory: '/tmp',
    status: 'idle',
    objective: '',
    model: 'm',
    risk: 'low',
    currentStep: '',
    branch: 'main',
    updatedAt: '',
    lastActivityMs: 0,
    suggestions: [],
    transcript,
    events: [],
    structuredEvents: [],
    ...overrides,
  }) as VibeCodingRun;

const msg = (
  id: string,
  index?: number,
  flags: Partial<AgentMessage> = {},
): AgentMessage => ({
  id,
  role: 'assistant',
  content: `c-${id}`,
  timestamp: '2026-10-01T00:00:00.000Z',
  ...(index !== undefined ? { index } : {}),
  ...flags,
});

describe('isClientGeneratedMessageId', () => {
  it('识别 createId("msg") 形态的客户端自造 id,放行服务端 msg_/import_ 形态', () => {
    expect(isClientGeneratedMessageId('msg-1727769600000-ab12x')).toBe(true);
    expect(isClientGeneratedMessageId('msg_ABCDEF123456')).toBe(false);
    expect(isClientGeneratedMessageId('import_0123456789abcdef1234')).toBe(false);
    expect(isClientGeneratedMessageId('turn-1')).toBe(false);
  });
});

describe('materializedServerMessageCount', () => {
  it('只数 server 确认消息;pending/failed/客户端 id 不计入', () => {
    // 客户端自造消息不占服务端 position,前后 server 消息 index 连续。
    const run = makeRun([
      msg('msg_a', 0),
      msg('msg-1727769600000-ab12x', undefined, { pending: true }), // 乐观发送
      msg('msg_b', 1),
      msg('msg-1727769600000-cd34y', undefined, { failed: true }), // 发送失败
    ]);
    expect(materializedServerMessageCount(run)).toBe(2);
  });

  it('取 confirmed 条数与最大 index+1 的较大者(截断窗口不虚报落后)', () => {
    // 热窗截断后本地只剩尾部 2 条,但 index 说明前面还有 8 条已被覆盖过。
    const run = makeRun([msg('msg_i', 8), msg('msg_j', 9)]);
    expect(materializedServerMessageCount(run)).toBe(10);
  });

  it('空转录物化为 0', () => {
    expect(materializedServerMessageCount(makeRun([]))).toBe(0);
  });
});

describe('isSessionBehindTranscript', () => {
  it('服务端总数大于本地物化数 → behind(WS 断档/他端追加场景)', () => {
    const run = makeRun([msg('msg_a', 0), msg('msg_b', 1), msg('msg_c', 2)]);
    expect(isSessionBehindTranscript(run, 5)).toBe(true);
  });

  it('服务端总数等于本地物化数 → 不落后(含流式中逐条对齐)', () => {
    const run = makeRun([msg('msg_a', 0), msg('msg_b', 1)]);
    expect(isSessionBehindTranscript(run, 2)).toBe(false);
  });

  it('服务端回缩(去重/隐藏)不触发 behind', () => {
    const run = makeRun([msg('msg_a', 0), msg('msg_b', 1), msg('msg_c', 2)]);
    expect(isSessionBehindTranscript(run, 2)).toBe(false);
  });

  it('乐观 pending 不掩盖缺口:本地 2 条确认 + 1 条 pending,服务端 4 → behind', () => {
    const run = makeRun([
      msg('msg_a', 0),
      msg('msg_b', 1),
      msg('msg-1727769600000-ab12x', undefined, { pending: true }),
    ]);
    expect(isSessionBehindTranscript(run, 4)).toBe(true);
  });
});

describe('latestServerConfirmedMessageId', () => {
  it('返回尾部最后一条 server 确认消息 id', () => {
    const run = makeRun([msg('msg_a', 0), msg('msg_b', 1), msg('msg_c', 2)]);
    expect(latestServerConfirmedMessageId(run)).toBe('msg_c');
  });

  it('跳过尾部的 pending/failed/客户端 id 消息', () => {
    const run = makeRun([
      msg('msg_a', 0),
      msg('msg_b', 1),
      msg('msg-1727769600000-ab12x', undefined, { pending: true }),
      msg('msg-1727769600000-cd34y', undefined, { failed: true }),
    ]);
    expect(latestServerConfirmedMessageId(run)).toBe('msg_b');
  });

  it('全部不可用时返回 undefined(触发全量兜底)', () => {
    const run = makeRun([msg('msg-1727769600000-ab12x', undefined, { pending: true })]);
    expect(latestServerConfirmedMessageId(run)).toBeUndefined();
  });
});
