import { useControlCenterStore } from '../src/store/controlCenterStore';
import {
  CATCH_UP_COMMIT_EVERY_PAGES,
  CATCH_UP_PAGE_YIELD_MS,
} from '../src/store/slices/aiSessionSlice';
import { platformTransport } from '../src/services/platformTransport';
import type {
  AgentMessage,
  VibeCodingRun,
} from '../src/data/platformModels';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
    sendAiMessage: jest.fn(),
    loadAiSession: jest.fn(),
    loadAiSessionMessages: jest.fn(),
  },
}));

const mockedLoadMessages = platformTransport.loadAiSessionMessages as jest.Mock;
const mockedLoadSession = platformTransport.loadAiSession as jest.Mock;

// catchUpAgentMessages — 增量补齐动作(水位触发 → after 游标拉缺段 → id 并集合并)。
// 契约:
// - 落后时用本地尾部 server 确认 id 作 after 锚点拉增量,合并 + 推进 transcriptCount;
// - 不落后零网络 I/O(early return),快照计数领先物化的瞬态不产生请求风暴;
// - 无锚点(纯 pending/空)降级走 loadAgentSessionDetail 全量兜底;
// - in-flight 去重;anchor 失效(anchor_found=false)仍安全合并服务端尾窗。

const run = (transcript: VibeCodingRun['transcript']): VibeCodingRun =>
  ({
    id: 's1',
    title: 'run-s1',
    deviceId: 'device-1',
    projectId: 'project-1',
    directory: '~/proj',
    status: 'running',
    objective: '',
    model: 'Claude Code',
    risk: 'medium',
    currentStep: '',
    branch: 'main',
    lastActivityMs: 0,
    updatedAt: '',
    suggestions: [],
    transcript,
    events: [],
    structuredEvents: [],
    transcriptCount: transcript.length,
  }) as unknown as VibeCodingRun;

const msg = (
  id: string,
  index?: number,
  flags: Partial<AgentMessage> = {},
): AgentMessage => ({
  id,
  role: index === undefined || index % 2 === 0 ? 'user' : 'assistant',
  content: `c-${id}`,
  timestamp: '2026-10-01T00:00:00.000Z',
  ...(index !== undefined ? { index } : {}),
  ...flags,
});

const wireMessage = (id: string, index: number) => ({
  id,
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `c-${id}`,
  timestamp: '2026-10-01T00:00:00.000Z',
  index,
});

const seedStore = (transcript: VibeCodingRun['transcript']) => {
  useControlCenterStore.setState({
    serverMode: true,
    vibeRuns: [run(transcript)],
    devices: [],
    projects: [],
  });
};

// 假计时器下驱动多页排水:每拍一个 yield 窗口(泵动微任务 + 定时器)。
// 收尾必须多泵一拍——尾页若是 has_more,循环体还会挂起一个 yield 定时器,
// 不释放它动作永不 settle(还会把 in-flight 僵尸泄漏给后续用例)。
const drainWithFakeTimers = async (
  action: () => Promise<unknown>,
  expectedPages: number,
) => {
  jest.useFakeTimers();
  try {
    const actionPromise = action();
    while (mockedLoadMessages.mock.calls.length < expectedPages) {
      await jest.advanceTimersByTimeAsync(CATCH_UP_PAGE_YIELD_MS);
    }
    await jest.advanceTimersByTimeAsync(CATCH_UP_PAGE_YIELD_MS);
    return await actionPromise;
  } finally {
    jest.useRealTimers();
  }
};

describe('catchUpAgentMessages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('落后时以尾部确认 id 为 after 锚点拉增量并合并', async () => {
    seedStore([msg('msg_a', 0), msg('msg_b', 1)]);
    mockedLoadMessages.mockResolvedValue({
      session_id: 's1',
      messages: [wireMessage('msg_c', 2), wireMessage('msg_d', 3)],
      page: {
        limit: 60,
        count: 2,
        total_count: 4,
        has_more: false,
        anchor_found: true,
      },
      detail_refresh: { status: 'server_ledger' },
    });

    const result = await useControlCenterStore
      .getState()
      .catchUpAgentMessages('s1', 4);

    expect(mockedLoadMessages).toHaveBeenCalledTimes(1);
    expect(mockedLoadMessages).toHaveBeenCalledWith('s1', {
      limit: 60,
      after: 'msg_b',
    });
    expect(result).toEqual({
      mode: 'after',
      fetched: 2,
      anchorMissing: false,
      moreRemaining: false,
    });

    const transcript = useControlCenterStore
      .getState()
      .vibeRuns.find(r => r.id === 's1')!.transcript;
    expect(transcript.map(m => m.id)).toEqual([
      'msg_a',
      'msg_b',
      'msg_c',
      'msg_d',
    ]);
    expect(
      useControlCenterStore.getState().vibeRuns.find(r => r.id === 's1')!
        .transcriptCount,
    ).toBe(4);
  });

  it('不落后时零网络请求', async () => {
    seedStore([msg('msg_a', 0), msg('msg_b', 1)]);

    const result = await useControlCenterStore
      .getState()
      .catchUpAgentMessages('s1', 2);

    expect(result).toEqual({ mode: 'skipped', reason: 'fresh' });
    expect(mockedLoadMessages).not.toHaveBeenCalled();
    expect(mockedLoadSession).not.toHaveBeenCalled();
  });

  it('无锚点(仅 pending)降级全量 detail 兜底', async () => {
    seedStore([
      msg('msg-1727769600000-ab12x', undefined, { pending: true }),
    ]);
    mockedLoadSession.mockResolvedValue({
      session_id: 's1',
      transcript_count: 3,
      transcript: [wireMessage('msg_a', 0), wireMessage('msg_b', 1)],
    });

    const result = await useControlCenterStore
      .getState()
      .catchUpAgentMessages('s1', 3);

    expect(result).toEqual({ mode: 'full' });
    expect(mockedLoadSession).toHaveBeenCalledWith('s1', { refresh: undefined });
    expect(mockedLoadMessages).not.toHaveBeenCalled();
  });

  it('缺口跨页(has_more)时循环消费 next_after_cursor 直到追平', async () => {
    // 2 条本地确认 + 61 条缺口:第一页 60 条(has_more)+ 第二页 1 条。
    seedStore([msg('msg_a', 0), msg('msg_b', 1)]);
    const pageOne = Array.from({ length: 60 }, (_, i) =>
      wireMessage(`gap_${i}`, 2 + i),
    );
    mockedLoadMessages
      .mockResolvedValueOnce({
        session_id: 's1',
        messages: pageOne,
        page: {
          limit: 60,
          count: 60,
          total_count: 63,
          has_more: true,
          next_after_cursor: 'ENC_CURSOR_1',
          anchor_found: true,
        },
        detail_refresh: { status: 'server_ledger' },
      })
      .mockResolvedValueOnce({
        session_id: 's1',
        messages: [wireMessage('gap_60', 62)],
        page: {
          limit: 60,
          count: 1,
          total_count: 63,
          has_more: false,
          anchor_found: true,
        },
        detail_refresh: { status: 'server_ledger' },
      });

    const result = (await drainWithFakeTimers(
      () => useControlCenterStore.getState().catchUpAgentMessages('s1', 63),
      2,
    )) as Awaited<
      ReturnType<
        ReturnType<
          typeof useControlCenterStore.getState
        >['catchUpAgentMessages']
      >
    >;

    expect(mockedLoadMessages).toHaveBeenCalledTimes(2);
    // 第一页用裸锚点,第二页回传服务端签发的编码游标
    expect(mockedLoadMessages).toHaveBeenNthCalledWith(1, 's1', {
      limit: 60,
      after: 'msg_b',
    });
    expect(mockedLoadMessages).toHaveBeenNthCalledWith(2, 's1', {
      limit: 60,
      after: 'ENC_CURSOR_1',
    });
    expect(result).toEqual({
      mode: 'after',
      fetched: 61,
      anchorMissing: false,
      moreRemaining: false,
    });

    const state = useControlCenterStore.getState().vibeRuns.find(r => r.id === 's1')!;
    expect(state.transcript.map(m => m.id)).toEqual([
      'msg_a',
      'msg_b',
      ...Array.from({ length: 61 }, (_, i) => `gap_${i}`),
    ]);
    // 全部追平才允许声明水位对齐
    expect(state.transcriptCount).toBe(63);
  });

  it('达到页数上限仍有剩余时停止,且不虚报水位对齐(留待下轮触发续补)', async () => {
    seedStore([msg('msg_a', 0), msg('msg_b', 1)]);
    mockedLoadMessages.mockImplementation((_sessionId: string, options?: { after?: string }) => {
      // 每页 60 条,永远 has_more:总缺口远超 MAX_CATCH_UP_PAGES×60
      const start = options?.after === 'msg_b' ? 2 : 1000; // 游标页不影响 id 生成,仅保证可区分
      return Promise.resolve({
        session_id: 's1',
        messages: Array.from({ length: 60 }, (_, i) =>
          wireMessage(`gap_${start + i}`, start - 2 + 2 + i),
        ),
        page: {
          limit: 60,
          count: 60,
          total_count: 9999,
          has_more: true,
          next_after_cursor: `ENC_CURSOR_${start}`,
          anchor_found: true,
        },
        detail_refresh: { status: 'server_ledger' },
      });
    });

    const result = (await drainWithFakeTimers(
      () => useControlCenterStore.getState().catchUpAgentMessages('s1', 9999),
      10,
    )) as Awaited<
      ReturnType<
        ReturnType<
          typeof useControlCenterStore.getState
        >['catchUpAgentMessages']
      >
    >;

    expect(result).toEqual({
      mode: 'after',
      fetched: 600,
      anchorMissing: false,
      moreRemaining: true,
    });
    expect(mockedLoadMessages).toHaveBeenCalledTimes(10);

    const state = useControlCenterStore.getState().vibeRuns.find(r => r.id === 's1')!;
    // 未追平:transcriptCount 不许顶到服务端总数(否则水位抹平,缺口永远补不齐)
    expect(state.transcriptCount).not.toBe(9999);
  });

  it('anchor 失效(anchor_found=false)仍安全合并服务端尾窗', async () => {
    seedStore([msg('msg_a', 0)]);
    mockedLoadMessages.mockResolvedValue({
      session_id: 's1',
      // 服务端找不到锚点 → 返回最新尾窗(可能含与本地重复的 id)
      messages: [wireMessage('msg_a', 0), wireMessage('msg_b', 1)],
      page: {
        limit: 60,
        count: 2,
        total_count: 2,
        has_more: false,
        anchor_found: false,
      },
      detail_refresh: { status: 'server_ledger' },
    });

    const result = await useControlCenterStore
      .getState()
      .catchUpAgentMessages('s1', 2);

    expect(result).toEqual({
      mode: 'after',
      fetched: 2,
      anchorMissing: true,
      moreRemaining: false,
    });
    const transcript = useControlCenterStore
      .getState()
      .vibeRuns.find(r => r.id === 's1')!.transcript;
    // id 并集合并:重复的 msg_a 不翻倍
    expect(transcript.map(m => m.id)).toEqual(['msg_a', 'msg_b']);
  });

  it('in-flight 去重:并发第二调用直接跳过', async () => {
    seedStore([msg('msg_a', 0)]);
    let resolveFirst!: (v: unknown) => void;
    mockedLoadMessages.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveFirst = resolve;
        }),
    );

    const first = useControlCenterStore
      .getState()
      .catchUpAgentMessages('s1', 2);
    const second = await useControlCenterStore
      .getState()
      .catchUpAgentMessages('s1', 2);

    expect(second).toEqual({ mode: 'skipped', reason: 'in_flight' });
    resolveFirst({
      session_id: 's1',
      messages: [wireMessage('msg_b', 1)],
      page: { limit: 60, count: 1, total_count: 2, has_more: false, anchor_found: true },
      detail_refresh: { status: 'server_ledger' },
    });
    await first;
    expect(mockedLoadMessages).toHaveBeenCalledTimes(1);
  });

  it('非 serverMode 直接抛错', async () => {
    useControlCenterStore.setState({ serverMode: false });
    await expect(
      useControlCenterStore.getState().catchUpAgentMessages('s1', 2),
    ).rejects.toThrow('Platform connection is required');
  });

  it('页与页之间让出主线程:下一页必须等 CATCH_UP_PAGE_YIELD_MS 之后才发', async () => {
    // 看门狗 RCA 回归测试:连续 10s 无间歇的"取页→合并→挂载"把 Fabric 主线程
    // 压死(scene-update watchdog SIGKILL)。页间必须有 yield 窗口。
    seedStore([msg('msg_a', 0), msg('msg_b', 1)]);
    const page = (cursor: string, hasMore: boolean) => ({
      session_id: 's1',
      messages: Array.from({ length: 60 }, (_, i) =>
        wireMessage(`gap_${cursor}_${i}`, 100 + i),
      ),
      page: {
        limit: 60,
        count: 60,
        total_count: 999,
        has_more: hasMore,
        next_after_cursor: hasMore ? `ENC_${cursor}_NEXT` : undefined,
        anchor_found: true,
      },
      detail_refresh: { status: 'server_ledger' },
    });
    mockedLoadMessages
      .mockResolvedValueOnce(page('p1', true))
      .mockResolvedValueOnce(page('p2', true))
      .mockResolvedValueOnce(page('p3', false));

    jest.useFakeTimers();
    try {
      const actionPromise = useControlCenterStore
        .getState()
        .catchUpAgentMessages('s1', 999);

      // 第一页微任务解析后,页 1 的请求已发出
      await jest.advanceTimersByTimeAsync(0);
      expect(mockedLoadMessages).toHaveBeenCalledTimes(1);

      // yield 窗口尚未走完:不允许发第二页(让路给渲染/Fabric 提交)
      await jest.advanceTimersByTimeAsync(CATCH_UP_PAGE_YIELD_MS - 1);
      expect(mockedLoadMessages).toHaveBeenCalledTimes(1);

      // yield 走完:第二页放行
      await jest.advanceTimersByTimeAsync(1);
      expect(mockedLoadMessages).toHaveBeenCalledTimes(2);

      // 第二页→第三页之间同样存在 yield 窗口
      await jest.advanceTimersByTimeAsync(CATCH_UP_PAGE_YIELD_MS - 1);
      expect(mockedLoadMessages).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(mockedLoadMessages).toHaveBeenCalledTimes(3);

      await actionPromise;
    } finally {
      jest.useRealTimers();
    }
  });

  it('store 提交按页节流:每 CATCH_UP_COMMIT_EVERY_PAGES 页才 set 一次(收尾必 flush)', async () => {
    // 4 页缺口 → 状态提交恰为 4/K 次;最终 transcript 仍必须完整(数据不丢)。
    seedStore([msg('msg_a', 0), msg('msg_b', 1)]);
    mockedLoadMessages.mockImplementation(
      (_sessionId: string, options?: { after?: string }) => {
        const pageIndex =
          options?.after === 'msg_b'
            ? 0
            : Number((options?.after ?? '').replace(/^ENC_/, '')) - 1;
        const hasMore = pageIndex < 3;
        return Promise.resolve({
          session_id: 's1',
          messages: Array.from({ length: 60 }, (_, i) =>
            wireMessage(`gap_${pageIndex}_${i}`, 2 + pageIndex * 60 + i),
          ),
          page: {
            limit: 60,
            count: 60,
            total_count: 242,
            has_more: hasMore,
            next_after_cursor: hasMore ? `ENC_${pageIndex + 2}` : undefined,
            anchor_found: true,
          },
          detail_refresh: { status: 'server_ledger' },
        });
      },
    );

    let vibeRunUpdates = 0;
    let lastTranscript: VibeCodingRun['transcript'] | null = null;
    const unsubscribe = useControlCenterStore.subscribe(state => {
      const s1 = state.vibeRuns.find(r => r.id === 's1');
      // 只数真正替换了 transcript 数组引用的提交(水位收尾的 set 只动
      // transcriptCount,不算内容提交)。
      if (s1 && s1.transcript !== lastTranscript) {
        lastTranscript = s1.transcript;
        if (s1.transcript.length > 2) vibeRunUpdates += 1;
      }
    });

    jest.useFakeTimers();
    try {
      const actionPromise = useControlCenterStore
        .getState()
        .catchUpAgentMessages('s1', 242);
      while (mockedLoadMessages.mock.calls.length < 4) {
        await jest.advanceTimersByTimeAsync(CATCH_UP_PAGE_YIELD_MS);
      }
      await actionPromise;

      expect(vibeRunUpdates).toBe(4 / CATCH_UP_COMMIT_EVERY_PAGES);

      const transcript = useControlCenterStore
        .getState()
        .vibeRuns.find(r => r.id === 's1')!.transcript;
      expect(transcript.map(m => m.id)).toEqual([
        'msg_a',
        'msg_b',
        ...Array.from({ length: 240 }, (_, i) => {
          const pageIndex = Math.floor(i / 60);
          return `gap_${pageIndex}_${i % 60}`;
        }),
      ]);
    } finally {
      unsubscribe();
      jest.useRealTimers();
    }
  });
});
