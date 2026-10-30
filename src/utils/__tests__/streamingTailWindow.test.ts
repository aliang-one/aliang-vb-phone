import {
  applyStreamingPlainTail,
  buildDisplayTranscript,
  LIVE_PLAIN_ENGAGE_CHARS,
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
    timestamp: '2026-10-30T10:00:00Z',
    ...over,
  }) as AgentMessage;

/** 段落化长文:每段 `PARA%03d 正文`,段间 `\n\n`,totalChars 目标长度。 */
const paragraphyContent = (totalChars: number): string => {
  const paragraphs: string[] = [];
  let length = 0;
  for (let i = 0; length < totalChars; i += 1) {
    const paragraph = `PARA${String(i).padStart(3, '0')} 正文内容行,用于流式纯文本降级测试,长度固定填充。`;
    paragraphs.push(paragraph);
    length += paragraph.length + 2;
  }
  return paragraphs.join('\n\n');
};

const makeTranscript = (assistantChars: number) =>
  buildDisplayTranscript([
    msg({ id: 'u1', role: 'user', content: '跑个任务' }),
    msg({
      id: 'a1',
      role: 'assistant',
      content: paragraphyContent(assistantChars),
    }),
  ]);

describe('applyStreamingPlainTail — 流式纯文本降级(吐字卡死 C1-2)', () => {
  it('空 transcript / 尾条非 assistant → 原引用原样返回', () => {
    const empty: ReturnType<typeof buildDisplayTranscript> = [];
    expect(applyStreamingPlainTail(empty)).toBe(empty);

    const userLast = buildDisplayTranscript([
      msg({
        id: 'u1',
        role: 'user',
        content: paragraphyContent(LIVE_TAIL_WINDOW_CHARS * 2),
      }),
    ]);
    expect(userLast[0].role).toBe('user');
    expect(applyStreamingPlainTail(userLast)).toBe(userLast);
  });

  it(`内容 ≤ ${LIVE_PLAIN_ENGAGE_CHARS} → 原引用返回(短气泡保留 markdown 零改动)`, () => {
    const short = makeTranscript(LIVE_PLAIN_ENGAGE_CHARS - 100);
    expect(applyStreamingPlainTail(short)).toBe(short);
  });

  it('典型长度(engage~window] → 整条纯文本:单 segment、全 paragraph 块、无折叠提示、含全文首尾', () => {
    const transcript = makeTranscript(4000);
    const original = transcript[transcript.length - 1].contentKey ?? '';

    const out = applyStreamingPlainTail(transcript);
    expect(out).not.toBe(transcript);
    expect(out[0]).toBe(transcript[0]); // 历史条目引用保持
    const last = out[out.length - 1];
    expect(last.id).toBe('a1');
    expect(last.segments).toHaveLength(1);

    const only = last.segments[0];
    expect(only.kind).toBe('text');
    if (only.kind !== 'text') throw new Error('unreachable');
    expect(only.id).toBe('a1:plaintail');
    expect(only.blocks.length).toBeGreaterThan(0);
    for (const block of only.blocks) {
      expect(block.kind).toBe('paragraph');
    }
    const plain = only.blocks
      .map(b => (b.kind === 'paragraph' ? b.children[0] : null))
      .map(child => (child && child.kind === 'text' ? child.content : ''))
      .join('\n\n');
    expect(plain).toContain('PARA000');
    expect(plain).toContain(original.slice(-40)); // 全文,不折叠
    expect(JSON.stringify(last.segments)).not.toContain('前文已折叠');
  });

  it(`超长(>${LIVE_TAIL_WINDOW_CHARS}) → 折叠提示 + 尾窗纯文本,切点在段落边界`, () => {
    const transcript = makeTranscript(LIVE_TAIL_WINDOW_CHARS * 3);
    const last = applyStreamingPlainTail(transcript)[
      transcript.length - 1
    ];
    expect(last.segments.length).toBeGreaterThanOrEqual(2);
    expect(last.segments.length).toBeLessThan(64);

    const marker = last.segments[0];
    expect(marker.kind).toBe('text');
    if (marker.kind !== 'text') throw new Error('unreachable');
    expect(marker.content).toContain('前文已折叠');

    const tail = last.segments[1];
    if (tail.kind !== 'text') throw new Error('unreachable');
    const firstChild = tail.blocks[0];
    expect(firstChild.kind).toBe('paragraph');
    if (firstChild.kind !== 'paragraph') throw new Error('unreachable');
    const firstText = firstChild.children[0];
    if (firstText.kind !== 'text') throw new Error('unreachable');
    expect(firstText.content).toMatch(/^PARA\d{3}/); // 完整段落开头,不切半个词

    const totalTailChars = last.segments
      .filter(s => s.kind === 'text')
      .reduce(
        (sum, s) =>
          sum +
          (s.kind === 'text'
            ? s.blocks.reduce(
                (bs, b) =>
                  bs +
                  (b.kind === 'paragraph' && b.children[0].kind === 'text'
                    ? b.children[0].content.length
                    : 0),
                0,
              )
            : 0),
        0,
      );
    expect(totalTailChars).toBeLessThanOrEqual(LIVE_TAIL_WINDOW_CHARS + 512);
  });

  it('contentKey 打哨兵前缀(settle 时 memo 比较器据此换回全量 markdown)', () => {
    for (const chars of [4000, LIVE_TAIL_WINDOW_CHARS * 3]) {
      const transcript = makeTranscript(chars);
      const original = transcript[transcript.length - 1].contentKey ?? '';
      const last = applyStreamingPlainTail(transcript)[
        transcript.length - 1
      ];
      expect(last.contentKey).toBe(
        `${STREAMING_TAIL_CONTENTKEY_PREFIX}${original}`,
      );
      expect(last.sourceMessageIds).toEqual(
        transcript[transcript.length - 1].sourceMessageIds,
      );
    }
  });

  it('段 id 与前文冲突时加 :dup 后缀', () => {
    const holder: DisplayTranscriptMessage = {
      id: 'a0',
      role: 'system',
      timestamp: 't',
      mergedCount: 1,
      segments: [
        { id: 'a1:plaintail', kind: 'text', content: '占位', blocks: [] },
      ],
      contentKey: '占位',
      sourceMessageIds: ['a1'],
    };
    const tailEntry: DisplayTranscriptMessage = {
      id: 'a1',
      role: 'assistant',
      timestamp: 't',
      mergedCount: 1,
      segments: [],
      contentKey: paragraphyContent(4000),
      sourceMessageIds: ['a1'],
    };
    const transcript = [holder, tailEntry];
    const last = applyStreamingPlainTail(transcript)[transcript.length - 1];
    const allIds = transcript
      .slice(0, -1)
      .flatMap(entry => entry.segments.map(s => s.id))
      .concat(last.segments.map(s => s.id));
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(last.segments.some(s => s.id === 'a1:plaintail')).toBe(false);
    expect(last.segments.some(s => s.id.startsWith('a1:plaintail:dup:'))).toBe(
      true,
    );
  });

  it('常量关系:plain engage < window', () => {
    expect(LIVE_PLAIN_ENGAGE_CHARS).toBeLessThan(LIVE_TAIL_WINDOW_CHARS);
  });
});
