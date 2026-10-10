import {
  mergeEarlierAgentMessages,
  mergeVibeRunSnapshot,
  serverAiSessionToVibeRun,
} from '../src/store/internals';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { platformTransport } from '../src/services/platformTransport';
import { encodeClientAiMessageCursor } from '../src/utils/aiMessageCursor';
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

const wirePage = (from: number, to: number, extra: Record<string, unknown> = {}) => ({
  session_id: 's1',
  messages: range(from, to).map(m => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    index: m.index,
  })),
  page: {
    limit: 40,
    count: to - from + 1,
    total_count: 720,
    has_more: false,
    ...extra,
  },
  detail_refresh: { status: 'server_ledger' },
});

const currentRun = () =>
  useControlCenterStore.getState().vibeRuns.find(r => r.id === 's1')!;

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

describe('trimTranscript 分页失效修复(审计问题6,端到端)', () => {
  const seedAuditScenario = () => {
    // 审计场景的等价形态:热窗 460 条(m200..m659),分页状态是 hasMore=false
    // (用户此前已把服务端给的历史翻完),服务端 cursor 是陈旧值。
    useControlCenterStore.setState({
      serverMode: true,
      vibeRuns: [
        {
          ...run(range(200, 659)),
          transcriptCount: 660,
          transcriptPage: {
            limit: 40,
            count: 40,
            totalCount: 660,
            hasMore: false,
            nextBeforeCursor: 'stale-cursor',
            nextBeforeMessageId: 'm199',
          },
        },
      ],
      devices: [],
      projects: [],
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('catch-up 触发 trim 后,hasMore=false 不再判死:自编码游标逐页回到更早历史', async () => {
    seedAuditScenario();
    // catch-up #1:补 60 条(m660..m719),合并后本地 520 > 500 → commitBatch
    // tail-500 裁掉 m200..m219。transcriptPage 不被 catch-up 触碰——仍是
    // hasMore=false,旧行为在这里把会话永久判死。
    mockedLoadMessages.mockResolvedValueOnce(
      wirePage(660, 719, {
        total_count: 720,
        anchor_found: true,
      }),
    );
    await useControlCenterStore.getState().catchUpAgentMessages('s1', 720);

    let state = currentRun();
    expect(state.transcript[0]?.id).toBe('m220'); // tail-500 已裁
    expect(state.transcriptPage?.hasMore).toBe(false); // 陈旧分页状态仍在

    // 修复点 1:hasEarlierForRun 以 total(720) > 本地(500) 为真,不再吃
    // hasMore=false 的亏;修复点 2:游标用本地头部自编码,陈旧 cursor 只兜底。
    mockedLoadMessages.mockResolvedValueOnce(
      wirePage(180, 219, {
        total_count: 720,
        has_more: true,
        next_before_cursor: 'server-cursor-m179',
        next_before_message_id: 'm179',
        anchor_found: true,
      }),
    );
    await useControlCenterStore.getState().loadEarlierAgentMessages('s1');

    expect(mockedLoadMessages).toHaveBeenLastCalledWith('s1', {
      limit: 40,
      before: encodeClientAiMessageCursor({
        id: 'm220',
        timestamp: '2026-10-01T00:00:00.000Z',
      }),
    });

    // 修复点 3(跑步机):合并后 540 条,水位地板保护已加载头部——不裁回 500。
    state = currentRun();
    expect(state.transcript).toHaveLength(540);
    expect(state.transcript[0]?.id).toBe('m180');
    expect(state.transcriptPage).toMatchObject({
      hasMore: true,
      nextBeforeMessageId: 'm179',
      oldestLoadedId: 'm180',
    });

    // 继续翻,仍不裁;地板随头部推进。
    mockedLoadMessages.mockResolvedValueOnce(
      wirePage(140, 179, {
        total_count: 720,
        has_more: true,
        next_before_message_id: 'm139',
        anchor_found: true,
      }),
    );
    await useControlCenterStore.getState().loadEarlierAgentMessages('s1');
    state = currentRun();
    expect(state.transcript).toHaveLength(580);
    expect(state.transcript[0]?.id).toBe('m140');
    expect(mockedLoadMessages).toHaveBeenLastCalledWith('s1', {
      limit: 40,
      before: encodeClientAiMessageCursor({
        id: 'm180',
        timestamp: '2026-10-01T00:00:00.000Z',
      }),
    });
  });

  it('服务端 anchor_found=false:不合并该页,抛错走可见反馈通道', async () => {
    seedAuditScenario();
    mockedLoadMessages.mockResolvedValueOnce(
      wirePage(660, 719, { total_count: 720, has_more: true, anchor_found: true }),
    );
    await useControlCenterStore.getState().catchUpAgentMessages('s1', 720);

    mockedLoadMessages.mockResolvedValueOnce({
      ...wirePage(680, 719, { anchor_found: false }),
      page: {
        limit: 40,
        count: 40,
        total_count: 720,
        has_more: false,
        anchor_found: false,
      },
    });
    // 抛错(而非静默 return):屏幕 handleLoadEarlierMessages 的 catch 会把
    // error.message 写进 setDetailError——'anchor_lost' 无 UI 消费者,静默
    // 会让用户在零反馈里无限重试同一注定失败的请求。
    await expect(
      useControlCenterStore.getState().loadEarlierAgentMessages('s1'),
    ).rejects.toThrow('HISTORY_ANCHOR_LOST');

    const state = currentRun();
    // 锚点丢失的页(静默降级的最新页)不被合并:窗口与地板保持原样。
    expect(state.transcript[0]?.id).toBe('m220');
    expect(state.transcript).toHaveLength(500);
    expect(state.transcriptPage?.oldestLoadedId).toBeUndefined();
    expect(state.detailRefreshStatus).toBe('anchor_lost');
  });

  it('纯热窗会话(从未加载更早):多次 catch-up trim 照常在 500 收口,窗口不被凭空盖戳', async () => {
    seedAuditScenario();
    // 两轮 catch-up,每轮 +60 条并 trim 回 500:窗口头部持续被裁,但
    // transcriptPage.oldestLoadedId 必须保持 undefined——一旦被快照/裁剪盖戳,
    // 水位地板会误钉,tail-500 停摆到 2000(内存上界 4 倍化 + 悬崖式截断)。
    for (let round = 0; round < 2; round += 1) {
      mockedLoadMessages.mockResolvedValueOnce(
        wirePage(660 + round * 60, 719 + round * 60, {
          total_count: 720 + (round + 1) * 60,
          anchor_found: true,
        }),
      );
      await useControlCenterStore
        .getState()
        .catchUpAgentMessages('s1', 720 + (round + 1) * 60);
    }
    const state = currentRun();
    expect(state.transcript).toHaveLength(500);
    expect(state.transcript[0]?.id).toBe('m280');
    expect(state.transcriptPage?.oldestLoadedId).toBeUndefined();
    expect(state.transcriptPage?.oldestLoadedTimestamp).toBeUndefined();
  });

  it('头部是客户端私有气泡(failed)时,游标取第一条 server 确认消息', async () => {
    seedAuditScenario();
    mockedLoadMessages.mockResolvedValueOnce(
      wirePage(660, 719, { total_count: 720, has_more: true, anchor_found: true }),
    );
    await useControlCenterStore.getState().catchUpAgentMessages('s1', 720);

    // 模拟"离线首条失败后历史合并到其后":头部插入 failed 私有气泡。
    const failedBubble: AgentMessage = {
      id: 'msg-1700000000000-abc',
      role: 'user',
      content: 'offline first',
      timestamp: '2026-10-01T00:00:00.000Z',
      failed: true,
    };
    useControlCenterStore.setState(state => ({
      vibeRuns: state.vibeRuns.map(r =>
        r.id === 's1'
          ? { ...r, transcript: [failedBubble, ...r.transcript] }
          : r,
      ),
    }));

    mockedLoadMessages.mockResolvedValueOnce(
      wirePage(180, 219, {
        total_count: 720,
        has_more: true,
        next_before_message_id: 'm179',
        anchor_found: true,
      }),
    );
    await useControlCenterStore.getState().loadEarlierAgentMessages('s1');

    // 游标锚在 m220(第一条确认消息),不是 failed 私有 id。
    expect(mockedLoadMessages).toHaveBeenLastCalledWith('s1', {
      limit: 40,
      before: encodeClientAiMessageCursor({
        id: 'm220',
        timestamp: '2026-10-01T00:00:00.000Z',
      }),
    });
  });

  it('mergeVibeRunSnapshot 接线:WS 快照的浅游标页被拒,本地已翻历史页保留', async () => {
    seedAuditScenario();
    mockedLoadMessages.mockResolvedValueOnce(
      wirePage(660, 719, { total_count: 720, has_more: true, anchor_found: true }),
    );
    await useControlCenterStore.getState().catchUpAgentMessages('s1', 720);

    // 用户翻一页更早 → 本地页游标 m179 + 地板 m180。
    mockedLoadMessages.mockResolvedValueOnce(
      wirePage(180, 219, {
        total_count: 720,
        has_more: true,
        next_before_message_id: 'm179',
        anchor_found: true,
      }),
    );
    await useControlCenterStore.getState().loadEarlierAgentMessages('s1');
    const beforeMerge = currentRun().transcriptPage;

    // WS 快照(mergeVibeRunSnapshot 路径)把页拨回服务端热窗起点 m500 → 拒绝。
    const snapshotRun = {
      ...run(range(500, 719)),
      transcriptPage: {
        limit: 40,
        count: 40,
        totalCount: 720,
        hasMore: true,
        nextBeforeMessageId: 'm500',
      },
    } as VibeCodingRun;
    useControlCenterStore.setState(state => ({
      vibeRuns: state.vibeRuns.map(r =>
        r.id === 's1' ? mergeVibeRunSnapshot(r, snapshotRun) : r,
      ),
    }));

    expect(currentRun().transcriptPage).toBe(beforeMerge);
  });

  it('在途去重:并发第二次 loadEarlier 不出网', async () => {
    seedAuditScenario();
    mockedLoadMessages.mockResolvedValueOnce(
      wirePage(660, 719, { total_count: 720, has_more: true, anchor_found: true }),
    );
    await useControlCenterStore.getState().catchUpAgentMessages('s1', 720);

    let releaseFirst!: (value: unknown) => void;
    mockedLoadMessages.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseFirst = resolve;
        }),
    );
    const first = useControlCenterStore.getState().loadEarlierAgentMessages('s1');
    const second = useControlCenterStore.getState().loadEarlierAgentMessages('s1');
    releaseFirst(
      wirePage(180, 219, {
        total_count: 720,
        has_more: true,
        next_before_message_id: 'm179',
        anchor_found: true,
      }),
    );
    await Promise.all([first, second]);
    expect(mockedLoadMessages).toHaveBeenCalledTimes(2); // catch-up + 1 次 loadEarlier
  });

  it('mergeServerTranscriptPage:游标过浅的 WS 页被拒,更深的被收下且地板保留', async () => {
    seedAuditScenario();
    mockedLoadMessages.mockResolvedValueOnce(
      wirePage(660, 719, { total_count: 720, has_more: true, anchor_found: true }),
    );
    await useControlCenterStore.getState().catchUpAgentMessages('s1', 720);

    // 用户翻了一页更早历史 → 本地头部 m180、地板 m180。
    mockedLoadMessages.mockResolvedValueOnce(
      wirePage(180, 219, {
        total_count: 720,
        has_more: true,
        next_before_message_id: 'm179',
        anchor_found: true,
      }),
    );
    await useControlCenterStore.getState().loadEarlierAgentMessages('s1');

    // WS 快照把页游标拨回服务端热窗起点 m500(本地窗口 index>0)→ 拒绝。
    useControlCenterStore.getState().mergeServerTranscriptPage('s1', {
      limit: 40,
      count: 40,
      totalCount: 720,
      hasMore: true,
      nextBeforeMessageId: 'm500',
    });
    expect(currentRun().transcriptPage?.nextBeforeMessageId).toBe('m179');

    // 服务端页游标比本地更深(m100)→ 收下,地板/窗口事实保留。
    useControlCenterStore.getState().mergeServerTranscriptPage('s1', {
      limit: 40,
      count: 40,
      totalCount: 720,
      hasMore: true,
      nextBeforeMessageId: 'm100',
    });
    expect(currentRun().transcriptPage).toMatchObject({
      nextBeforeMessageId: 'm100',
      oldestLoadedId: 'm180',
    });
  });
});
