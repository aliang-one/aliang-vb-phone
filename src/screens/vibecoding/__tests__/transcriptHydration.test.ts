/**
 * 缓存水合集成测试(修复「进对话空白」RCA 2026-10-29 症状一)。钉死三条
 * 承重契约:
 *  ① 缓存注入后 UI 有内容,但 computeHasDetail 不误判「已加载权威详情」
 *     ——auto-load 仍会发起;
 *  ② 服务器响应到达后按既有 merge 语义覆盖,缓存标记不残留;
 *  ③ 缓存与服务器竞态/权威空裁决时,hydrate action 让位不覆盖。
 */
jest.mock('../../../services/platformTransport', () => ({
  platformTransport: {
    loadAiSession: jest.fn(),
  },
}));

import { useControlCenterStore } from '../../../store/controlCenterStore';
import {
  emptySessionData,
  mergeVibeRunSnapshot,
  demoteRunDetail,
} from '../../../store/internals';
import { computeHasDetail } from '../sessionDetailState';
import type { AgentMessage, VibeCodingRun } from '../../../data/platformModels';
import type { ServerAiSession } from '../../../api/sessions';

const msg = (id: string): AgentMessage => ({
  id,
  role: 'user',
  content: `content ${id}`,
  timestamp: '2026-01-01T00:00:00Z',
});

const cachedMessages = [msg('c1'), msg('c2'), msg('c3')];

const makeRun = (over: Partial<VibeCodingRun> & { id: string }): VibeCodingRun =>
  ({
    status: 'completed',
    transcript: [],
    events: [],
    structuredEvents: [],
    ...over,
  }) as unknown as VibeCodingRun;

const makeSession = (
  over: Partial<ServerAiSession> & { session_id: string },
): ServerAiSession =>
  ({
    kind: 'ai',
    user_id: 'u1',
    device_id: 'd1',
    status: 'closed',
    mode: 'chat',
    created_at: '2026-01-01T00:00:00Z',
    last_active_at: '2026-01-01T00:00:00Z',
    ...over,
  }) as ServerAiSession;

const getRun = (id = 's1'): VibeCodingRun | undefined =>
  useControlCenterStore.getState().vibeRuns.find(run => run.id === id);

const resetStore = () => {
  useControlCenterStore.setState({
    ...emptySessionData(),
    serverMode: true,
  });
};

beforeEach(() => {
  resetStore();
});

describe('hydrateRunTranscriptFromCache', () => {
  test('空 run 注入缓存:transcript 有内容 + cache 标记,detail 语义不被污染', () => {
    useControlCenterStore.setState({
      vibeRuns: [makeRun({ id: 's1', detailFromPage: undefined })],
    });
    useControlCenterStore
      .getState()
      .hydrateRunTranscriptFromCache('s1', cachedMessages);
    const run = getRun();
    expect(run?.transcript).toEqual(cachedMessages);
    expect(run?.transcriptSource).toBe('cache');
    // ① 承重契约:缓存渲染 ≠ 已加载权威详情 → auto-load 不被短路。
    expect(run?.detailFromPage).toBeUndefined();
    expect(run?.detailState).toBeUndefined();
    expect(
      computeHasDetail(run?.detailState, run?.transcript.length ?? 0, run?.detailFromPage),
    ).toBe(false);
  });

  test('内存已有内容(run 被WS先到)→ no-op,不覆盖服务器数据', () => {
    const serverFirst = [msg('server1')];
    useControlCenterStore.setState({
      vibeRuns: [makeRun({ id: 's1', transcript: serverFirst })],
    });
    useControlCenterStore
      .getState()
      .hydrateRunTranscriptFromCache('s1', cachedMessages);
    expect(getRun()?.transcript).toEqual(serverFirst);
    expect(getRun()?.transcriptSource).toBeUndefined();
  });

  test('权威空裁决(fresh_empty → empty)不被磁盘旧数据翻案', () => {
    useControlCenterStore.setState({
      vibeRuns: [makeRun({ id: 's1', detailState: { kind: 'empty' } })],
    });
    useControlCenterStore
      .getState()
      .hydrateRunTranscriptFromCache('s1', cachedMessages);
    expect(getRun()?.transcript).toEqual([]);
    expect(getRun()?.transcriptSource).toBeUndefined();
  });

  test('空消息列表注入是 no-op', () => {
    useControlCenterStore.setState({
      vibeRuns: [makeRun({ id: 's1' })],
    });
    useControlCenterStore.getState().hydrateRunTranscriptFromCache('s1', []);
    expect(getRun()?.transcript).toEqual([]);
  });
});

describe('缓存标记跨 merge/demote 的生命周期', () => {
  test('服务器详情页带来内容 → 标记清除;空列表快照 → 标记保留', () => {
    const cached = makeRun({
      id: 's1',
      transcript: cachedMessages,
      transcriptSource: 'cache',
    });
    const serverPage = makeRun({
      id: 's1',
      transcript: [msg('server1')],
      detailState: { kind: 'ready' },
      detailRefreshStatus: 'fresh',
    });
    const merged = mergeVibeRunSnapshot(cached, serverPage);
    expect(merged.transcriptSource).toBeUndefined();
    expect(
      computeHasDetail(merged.detailState, merged.transcript.length, merged.detailFromPage),
    ).toBe(false); // detailFromPage 仍 false,直到真实详情页加载对账

    const emptySnapshot = makeRun({ id: 's1', transcript: [] });
    const merged2 = mergeVibeRunSnapshot(cached, emptySnapshot);
    expect(merged2.transcript).toEqual(cachedMessages); // 空快照不清缓存内容
    expect(merged2.transcriptSource).toBe('cache');
  });

  test('demoteRunDetail 清标记(降级后 run 是干净的元数据壳)', () => {
    const demoted = demoteRunDetail(
      makeRun({ id: 's1', transcript: cachedMessages, transcriptSource: 'cache' }),
    );
    expect(demoted.transcript).toEqual([]);
    expect(demoted.transcriptSource).toBeUndefined();
  });
});

describe('缓存水合后走真实详情页加载', () => {
  test('loadAgentSessionDetail 成功 → 权威页 merge,标记清除,hasDetail 成立', async () => {
    // 平台传输在 store 模块图里被 mock;直接用 serverAiSessionToVibeRun 等价的
    // wire 形状驱动 loadAgentSessionDetail 的完整路径。
    const { platformTransport } = jest.requireMock(
      '../../../services/platformTransport',
    ) as {
      platformTransport: { loadAiSession: jest.Mock };
    };
    platformTransport.loadAiSession.mockResolvedValue(
      makeSession({
        session_id: 's1',
        transcript: [
          { id: 'server1', role: 'user', content: 'from server', timestamp: '2026-01-01T00:00:01Z' },
        ],
        transcript_count: 1,
        detail_refresh: { status: 'fresh' },
      }),
    );

    useControlCenterStore.setState({
      vibeRuns: [makeRun({ id: 's1', detailFromPage: undefined })],
    });
    useControlCenterStore
      .getState()
      .hydrateRunTranscriptFromCache('s1', cachedMessages);
    expect(getRun()?.transcript).toHaveLength(3);

    await useControlCenterStore.getState().loadAgentSessionDetail('s1');
    const run = getRun();
    // ② 承重契约:并集 merge,服务器消息与缓存共存,标记已清除。
    expect(run?.transcript.map(m => m.id)).toEqual(
      expect.arrayContaining(['c1', 'c2', 'c3', 'server1']),
    );
    expect(run?.transcriptSource).toBeUndefined();
    expect(run?.detailFromPage).toBe(true);
    expect(
      computeHasDetail(run?.detailState, run?.transcript.length ?? 0, run?.detailFromPage),
    ).toBe(true);
  });
});
