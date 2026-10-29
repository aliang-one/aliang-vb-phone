import {
  applyStreamingTailWindow,
  buildDisplayTranscript,
  LIVE_TAIL_ENGAGE_CHARS,
  LIVE_TAIL_WINDOW_CHARS,
  STREAMING_TAIL_CONTENTKEY_PREFIX,
  type DisplayTranscriptMessage,
} from '../agentTranscript';
import type { AgentMessage } from '../../data/platformModels';

const msg = (
  over: Partial<AgentMessage> & {
    id: string;
    role: AgentMessage['role'];
  },
): AgentMessage =>
  ({
    content: 'hello',
    timestamp: '2026-10-29T10:00:00Z',
    ...over,
  }) as AgentMessage;

/** 段落化长文:每段 `PARA%03d 正文`,段间 `\n\n`,totalChars 目标长度。 */
const paragraphyContent = (totalChars: number): string => {
  const paragraphs: string[] = [];
  let length = 0;
  for (let i = 0; length < totalChars; i += 1) {
    const paragraph = `PARA${String(i).padStart(3, '0')} 正文内容行,用于尾窗切点测试,长度固定填充。`;
    paragraphs.push(paragraph);
    length += paragraph.length + 2;
  }
  return paragraphs.join('\n\n');
};

const makeLongAssistantTranscript = (totalChars: number) =>
  buildDisplayTranscript([
    msg({ id: 'u1', role: 'user', content: '跑个长任务' }),
    msg({
      id: 'a1',
      role: 'assistant',
      content: paragraphyContent(totalChars),
    }),
  ]);

describe('applyStreamingTailWindow — 流式尾窗(吐字卡死修复)', () => {
  it('空 transcript / 尾条非 assistant → 原引用原样返回', () => {
    const empty: ReturnType<typeof buildDisplayTranscript> = [];
    expect(applyStreamingTailWindow(empty)).toBe(empty);

    const userLast = buildDisplayTranscript([
      msg({ id: 'u1', role: 'user', content: paragraphyContent(LIVE_TAIL_ENGAGE_CHARS * 3) }),
    ]);
    expect(userLast[0].role).toBe('user');
    expect(applyStreamingTailWindow(userLast)).toBe(userLast);
  });

  it('内容不超过 engage 阈值 → 原引用原样返回(短气泡零改动)', () => {
    const short = makeLongAssistantTranscript(1200);
    expect(applyStreamingTailWindow(short)).toBe(short);
  });

  it('长 assistant 尾泡:换新尾泡,历史条目引用不变,段数有界', () => {
    const transcript = makeLongAssistantTranscript(LIVE_TAIL_ENGAGE_CHARS * 6);

    const out = applyStreamingTailWindow(transcript);
    expect(out).not.toBe(transcript);
    expect(out).toHaveLength(transcript.length);
    // 历史条目引用保持
    expect(out[0]).toBe(transcript[0]);
    const last = out[out.length - 1];
    expect(last).not.toBe(transcript[transcript.length - 1]);
    expect(last.id).toBe(transcript[transcript.length - 1].id);
    // 尾窗成本有界:解析字符量钉死在窗口内(段数不是成本度量,plain 段落
    // 本就合成一个 text segment,成本在 blocks/字符量上)
    expect(last.segments.length).toBeGreaterThan(0);
    expect(last.segments.length).toBeLessThan(64);
    const textSegments = last.segments.filter(s => s.kind === 'text');
    const totalTailChars = textSegments.reduce(
      (sum, s) => sum + (s as { content: string }).content.length,
      0,
    );
    expect(totalTailChars).toBeLessThanOrEqual(LIVE_TAIL_WINDOW_CHARS + 512);
  });

  it('内容介于 engage 与 window 之间 → 原引用返回(折叠只会丢内容,不值得)', () => {
    const mid = makeLongAssistantTranscript(
      Math.floor((LIVE_TAIL_ENGAGE_CHARS + LIVE_TAIL_WINDOW_CHARS) / 2),
    );
    expect(applyStreamingTailWindow(mid)).toBe(mid);
  });

  it('尾窗内容:折叠提示在前,切点落在段落边界(不切半个词)', () => {
    const transcript = makeLongAssistantTranscript(LIVE_TAIL_ENGAGE_CHARS * 6);
    const last = applyStreamingTailWindow(transcript)[
      transcript.length - 1
    ];
    const textSegments = last.segments.filter(s => s.kind === 'text');
    expect(textSegments.length).toBeGreaterThanOrEqual(2);
    // 折叠提示段
    expect(JSON.stringify(textSegments[0])).toContain('前文已折叠');
    // 切点后第一段以完整段落开头(PARAxxx),不是半截词
    const firstTailText = (textSegments[1] as { content: string }).content;
    expect(firstTailText).toMatch(/^PARA\d{3}/);
    // 尾窗文本量有界
    const totalTailChars = textSegments.reduce(
      (sum, s) => sum + (s as { content: string }).content.length,
      0,
    );
    expect(totalTailChars).toBeLessThanOrEqual(LIVE_TAIL_WINDOW_CHARS + 512);
  });

  it('contentKey 打哨兵前缀(memo 比较器据此在 settle 时换回全量渲染)', () => {
    const transcript = makeLongAssistantTranscript(LIVE_TAIL_ENGAGE_CHARS * 6);
    const original = transcript[transcript.length - 1].contentKey ?? '';
    const last = applyStreamingTailWindow(transcript)[
      transcript.length - 1
    ];
    expect(last.contentKey).toBe(`${STREAMING_TAIL_CONTENTKEY_PREFIX}${original}`);
    // 哨兵后缀仍含原文,scrubber/其他消费方按 contentKey 判等时能对上原文
    expect(last.contentKey?.endsWith(original)).toBe(true);
  });

  it('段 id 与前文冲突时加 :dup 后缀(同消息双副本场景)', () => {
    // 手工构造:前文 system 折叠气泡持有 a1:text:0(appendSegments 场景),
    // 尾条为 assistant(a1) 长文 → 新解析出的 a1:text:0 必须让位。
    const holder: DisplayTranscriptMessage = {
      id: 'a0',
      role: 'system',
      timestamp: 't',
      mergedCount: 1,
      segments: [{ id: 'a1:text:0', kind: 'text', content: '占位', blocks: [] }],
      contentKey: '占位',
      sourceMessageIds: ['a1'],
    };
    const tailEntry: DisplayTranscriptMessage = {
      id: 'a1',
      role: 'assistant',
      timestamp: 't',
      mergedCount: 1,
      segments: [],
      contentKey: paragraphyContent(LIVE_TAIL_ENGAGE_CHARS * 6),
      sourceMessageIds: ['a1'],
    };
    const transcript = [holder, tailEntry];
    const last = applyStreamingTailWindow(transcript)[transcript.length - 1];
    const allIds = transcript
      .slice(0, -1)
      .flatMap(entry => entry.segments.map(s => s.id))
      .concat(last.segments.map(s => s.id));
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(last.segments.some(s => s.id === 'a1:text:0')).toBe(false);
    expect(
      last.segments.some(s => s.id.startsWith('a1:text:0:dup:')),
    ).toBe(true);
  });

  it('阈值常量关系:engage < window', () => {
    expect(LIVE_TAIL_ENGAGE_CHARS).toBeLessThan(LIVE_TAIL_WINDOW_CHARS);
  });
});
