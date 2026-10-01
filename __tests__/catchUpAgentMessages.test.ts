import { useControlCenterStore } from '../src/store/controlCenterStore';
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
    expect(result).toEqual({ mode: 'after', fetched: 2, anchorMissing: false });

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

    expect(result).toEqual({ mode: 'after', fetched: 2, anchorMissing: true });
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
});
