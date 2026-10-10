/**
 * trimTranscript 分页修复(审计问题6)的纯函数契约:
 * - hasEarlierForRun:闸门真值来自 total_count 对比,不吃 has_more 的亏;
 * - trimTranscriptWithWindow:水位地板保护已加载历史 + 硬上限兜底 + 引用稳定;
 * - acceptServerTranscriptPage:WS/元数据页的位置感知合并,游标过浅被拒;
 * - encodeClientAiMessageCursor:与服务端 cursor.ts 字节兼容(golden 向量)。
 */
import {
  MAX_LOADED_TRANSCRIPT_LENGTH,
  MAX_TRANSCRIPT_LENGTH,
  acceptServerTranscriptPage,
  hasEarlierForRun,
  serverTranscriptPageToAgent,
  trimTranscriptWithWindow,
} from '../src/store/internals';
import { encodeClientAiMessageCursor } from '../src/utils/aiMessageCursor';
import type {
  AgentMessage,
  AgentTranscriptPage,
} from '../src/data/platformModels';

const msg = (id: string, index: number): AgentMessage => ({
  id,
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `c-${id}`,
  timestamp: '2026-10-01T00:00:00.000Z',
  index,
});

const range = (from: number, to: number): AgentMessage[] => {
  const list: AgentMessage[] = [];
  for (let i = from; i <= to; i += 1) list.push(msg(`m${i}`, i));
  return list;
};

const page = (overrides: Partial<AgentTranscriptPage> = {}): AgentTranscriptPage => ({
  limit: 40,
  count: 40,
  totalCount: 40,
  hasMore: false,
  ...overrides,
});

describe('hasEarlierForRun', () => {
  it('total > 本地确认数为真——即使服务端 hasMore=false(审计复现场景)', () => {
    // 本地 0..39 已被裁到只剩 140..639 的形态,服务端快照仍带旧 hasMore:false
    const run = {
      transcript: range(140, 639),
      transcriptPage: page({ totalCount: 640, hasMore: false }),
      transcriptCount: 640,
    };
    expect(hasEarlierForRun(run)).toBe(true);
  });

  it('total ≤ 本地窗口为假(已翻到 index 0)', () => {
    const run = {
      transcript: range(0, 499),
      transcriptPage: page({ totalCount: 500, hasMore: true }),
      transcriptCount: 500,
    };
    expect(hasEarlierForRun(run)).toBe(false);
  });

  it('乐观气泡不计入本地窗口数(流式期间不闪断)', () => {
    const run = {
      transcript: [
        ...range(460, 499),
        { ...msg('pending-1', 500), pending: true },
        { ...msg('failed-1', 501), failed: true },
      ],
      transcriptPage: page({ totalCount: 500 }),
      transcriptCount: 500,
    };
    expect(hasEarlierForRun(run)).toBe(true);
  });

  it('total 未知时退回 hasMore;页不存在保守 false', () => {
    expect(
      hasEarlierForRun({
        transcript: range(0, 9),
        transcriptPage: page({ totalCount: undefined, hasMore: true }),
      }),
    ).toBe(true);
    expect(
      hasEarlierForRun({
        transcript: range(0, 9),
        transcriptPage: page({ totalCount: undefined, hasMore: false }),
      }),
    ).toBe(false);
    expect(hasEarlierForRun({ transcript: range(0, 9) })).toBe(false);
  });

  it('transcriptCount 兜底 total(页totalCount缺失但水位已推进)', () => {
    expect(
      hasEarlierForRun({
        transcript: range(140, 639),
        transcriptCount: 640,
        transcriptPage: page({ totalCount: undefined, hasMore: false }),
      }),
    ).toBe(true);
  });
});

describe('trimTranscriptWithWindow', () => {
  it('无地板:tail-500 裁剪,且不给纯热窗会话凭空盖戳(否则地板误生根)', () => {
    const transcript = range(0, 600);
    const result = trimTranscriptWithWindow(transcript, page());
    expect(result.transcript).toHaveLength(MAX_TRANSCRIPT_LENGTH);
    expect(result.transcript[0]?.id).toBe('m101');
    expect(result.pageDelta).toBeUndefined();
  });

  it('地板生效(加载过更早历史):头部历史不被 tail-500 裁掉', () => {
    const transcript = range(0, 600);
    const result = trimTranscriptWithWindow(
      transcript,
      page({ oldestLoadedId: 'm0' }),
    );
    expect(result.transcript).toBe(transcript); // 引用稳定:保护期内不裁
    expect(result.pageDelta).toBeUndefined();
  });

  it('地板生效但触顶 2000:按真值截断并刷新地板', () => {
    const transcript = range(0, 2100);
    const result = trimTranscriptWithWindow(
      transcript,
      page({ oldestLoadedId: 'm0' }),
    );
    expect(result.transcript).toHaveLength(MAX_LOADED_TRANSCRIPT_LENGTH);
    expect(result.transcript[0]?.id).toBe(`m${2101 - MAX_LOADED_TRANSCRIPT_LENGTH}`);
    expect(result.pageDelta?.oldestLoadedId).toBe(result.transcript[0]?.id);
    expect(result.pageDelta?.oldestLoadedTimestamp).toBe(
      result.transcript[0]?.timestamp,
    );
  });

  it('地板身份已失效(被其它路径裁掉)时刷新盖戳,不重新保护', () => {
    const transcript = range(0, 600);
    const result = trimTranscriptWithWindow(
      transcript,
      page({ oldestLoadedId: 'm-long-evicted' }),
    );
    expect(result.transcript).toHaveLength(MAX_TRANSCRIPT_LENGTH);
    expect(result.pageDelta?.oldestLoadedId).toBe('m101');
  });

  it('≤500 时恒等返回(transcript 与 pageDelta 均不动)', () => {
    const transcript = range(0, 100);
    const result = trimTranscriptWithWindow(
      transcript,
      page({ oldestLoadedId: 'm0' }),
    );
    expect(result.transcript).toBe(transcript);
    expect(result.pageDelta).toBeUndefined();
  });
});

describe('acceptServerTranscriptPage', () => {
  const local = range(140, 639);

  it('服务端游标落在本地窗口中部(index>0)→ 拒绝,保留本地页', () => {
    // 服务端热窗起点 m500:本地已加载 m140..m499 的更早历史,收下会让游标
    // 退回热窗起点,下一次加载更早重翻已加载页。
    const existing = page({ nextBeforeMessageId: 'm139' });
    const incoming = page({
      hasMore: true,
      nextBeforeMessageId: 'm500',
      totalCount: 640,
    });
    expect(acceptServerTranscriptPage(existing, incoming, local)).toBe(existing);
  });

  it('服务端游标不在本地窗口(比本地更深/更新)→ 收下,并保留本地地板', () => {
    const existing = page({
      oldestLoadedId: 'm140',
      oldestLoadedTimestamp: 't140',
      nextBeforeMessageId: 'm139',
    });
    const incoming = page({
      hasMore: true,
      nextBeforeMessageId: 'm999',
      totalCount: 1000,
    });
    const merged = acceptServerTranscriptPage(existing, incoming, local);
    expect(merged).toMatchObject({
      nextBeforeMessageId: 'm999',
      totalCount: 1000,
      oldestLoadedId: 'm140',
      oldestLoadedTimestamp: 't140',
    });
  });

  it('游标恰为本地头部(index 0)→ 等价边界,收下', () => {
    const incoming = page({ hasMore: true, nextBeforeMessageId: 'm140' });
    const merged = acceptServerTranscriptPage(undefined, incoming, local);
    expect(merged?.nextBeforeMessageId).toBe('m140');
  });

  it('本地无页:收下并以本地头部盖戳窗口事实', () => {
    const incoming = page({ hasMore: true, nextBeforeMessageId: 'm500' });
    const merged = acceptServerTranscriptPage(undefined, incoming, local);
    expect(merged?.oldestLoadedId).toBe('m140');
  });

  it('incoming 为 undefined → 保持 existing(列表快照不带页的旧行为)', () => {
    const existing = page({ nextBeforeMessageId: 'm139' });
    expect(acceptServerTranscriptPage(existing, undefined, local)).toBe(existing);
  });

  it('解析 nextBeforeCursor(自编码/服务端编码均可)参与位置比较', () => {
    const cursor = encodeClientAiMessageCursor({
      id: 'm500',
      timestamp: '2026-10-01T00:00:00.000Z',
    });
    const incoming = page({ hasMore: true, nextBeforeCursor: cursor });
    const existing = page({ nextBeforeMessageId: 'm139' });
    expect(acceptServerTranscriptPage(existing, incoming, local)).toBe(existing);
  });
});

describe('encodeClientAiMessageCursor', () => {
  it('与服务端 base64url(JSON({id,timestamp})) 字节兼容(golden 向量)', () => {
    expect(
      encodeClientAiMessageCursor({
        id: 'msg_abc123',
        timestamp: '2026-10-10T00:00:00.000Z',
      }),
    ).toBe(
      'eyJpZCI6Im1zZ19hYmMxMjMiLCJ0aW1lc3RhbXAiOiIyMDI2LTEwLTEwVDAwOjAwOjAwLjAwMFoifQ',
    );
  });

  it('缺 timestamp 时省略字段(decode 侧容忍)', () => {
    expect(encodeClientAiMessageCursor({ id: 'msg_abc123' })).toBe(
      'eyJpZCI6Im1zZ19hYmMxMjMifQ',
    );
  });

  it('无 id 返回 undefined', () => {
    expect(encodeClientAiMessageCursor(undefined)).toBeUndefined();
    expect(encodeClientAiMessageCursor({ id: '' })).toBeUndefined();
  });
});

describe('serverTranscriptPageToAgent', () => {
  it('snake_case wire → camelCase 本地页(含 anchorFound)', () => {
    expect(
      serverTranscriptPageToAgent({
        limit: 40,
        count: 40,
        total_count: 640,
        has_more: true,
        next_before_cursor: 'cur',
        next_before_message_id: 'm600',
        anchor_found: false,
        cache_status: 'cold',
        fetched_at: '2026-10-10T00:00:00.000Z',
      }),
    ).toMatchObject({
      limit: 40,
      count: 40,
      totalCount: 640,
      hasMore: true,
      nextBeforeCursor: 'cur',
      nextBeforeMessageId: 'm600',
      anchorFound: false,
      cacheStatus: 'cold',
      fetchedAt: '2026-10-10T00:00:00.000Z',
    });
  });
});
