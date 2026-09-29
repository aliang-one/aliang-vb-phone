jest.mock('../../services/platformTransport', () => ({
  platformTransport: {
    loadAiSession: jest.fn(),
  },
}));

import { useControlCenterStore } from '../controlCenterStore';
import { emptySessionData } from '../internals';
import { platformTransport } from '../../services/platformTransport';
import type { ServerAiMessage, ServerAiSession } from '../../api/sessions';

const mockLoadAiSession = platformTransport.loadAiSession as jest.MockedFunction<
  typeof platformTransport.loadAiSession
>;

const SESSION_ID = 's1';

const msg = (id: string): ServerAiMessage => ({
  id,
  role: 'user',
  content: 'hi',
  timestamp: '2026-01-01T00:00:00Z',
});

/** Minimal ServerAiSession fixture; only fields the mapping reads. */
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

const resetStore = () => {
  useControlCenterStore.setState({
    ...emptySessionData(),
    serverMode: true,
  });
};

const getRun = () =>
  useControlCenterStore
    .getState()
    .vibeRuns.find(run => run.id === SESSION_ID);

describe('loadAgentSessionDetail — empty-but-known-history recovery', () => {
  beforeEach(() => {
    mockLoadAiSession.mockReset();
    resetStore();
  });

  afterAll(() => {
    mockLoadAiSession.mockReset();
  });

  test('首次空 + 已知历史 → 自动强刷一次并填入内容', async () => {
    // Cache-first fetch: agent returned a fresh-but-empty page though the
    // server knows the session has 3 messages.
    mockLoadAiSession.mockResolvedValueOnce(
      makeSession({
        session_id: SESSION_ID,
        transcript: [],
        transcript_count: 3,
        detail_refresh: { status: 'fresh' },
      }) as never,
    );
    // Escalation (refresh:true): agent now delivers the transcript.
    mockLoadAiSession.mockResolvedValueOnce(
      makeSession({
        session_id: SESSION_ID,
        transcript: [msg('m1'), msg('m2')],
        transcript_count: 3,
        detail_refresh: { status: 'fresh' },
      }) as never,
    );

    await useControlCenterStore.getState().loadAgentSessionDetail(SESSION_ID);

    expect(mockLoadAiSession).toHaveBeenCalledTimes(2);
    expect(mockLoadAiSession.mock.calls[0]).toEqual([
      SESSION_ID,
      { refresh: undefined },
    ]);
    // The recovery fetch must force the agent.
    expect(mockLoadAiSession.mock.calls[1]).toEqual([
      SESSION_ID,
      { refresh: true },
    ]);

    const run = getRun();
    expect(run?.transcript).toHaveLength(2);
    // Real content landed → authoritative ready.
    expect(run?.detailState).toEqual({ kind: 'ready' });
  });

  test('两次均空 → 只请求两次(不循环),且保持可重试(detailState=recoverable_empty)', async () => {
    mockLoadAiSession.mockResolvedValueOnce(
      makeSession({
        session_id: SESSION_ID,
        transcript: [],
        transcript_count: 3,
        detail_refresh: { status: 'fresh' },
      }) as never,
    );
    mockLoadAiSession.mockResolvedValueOnce(
      makeSession({
        session_id: SESSION_ID,
        transcript: [],
        transcript_count: 3,
        detail_refresh: { status: 'fresh' },
      }) as never,
    );

    await useControlCenterStore.getState().loadAgentSessionDetail(SESSION_ID);

    // Bounded: exactly one escalation, never a third request.
    expect(mockLoadAiSession).toHaveBeenCalledTimes(2);

    const run = getRun();
    expect(run?.transcript).toHaveLength(0);
    // Empty while history is known ⇒ recoverable_empty (defined, but
    // NON-authoritative). isAuthoritativeDetail returns false so hasDetail
    // stays false and the screen keeps re-attempting — the bug was stamping
    // detailLoadedAt here and freezing it.
    expect(run?.detailState).toEqual({ kind: 'recoverable_empty' });
    expect(run?.detailState?.kind !== 'ready' && run?.detailState?.kind !== 'empty').toBe(true);
  });

  test('真实空会话(transcriptCount=0)→ 不强刷,正常盖戳', async () => {
    mockLoadAiSession.mockResolvedValue(
      makeSession({
        session_id: SESSION_ID,
        transcript: [],
        transcript_count: 0,
        detail_refresh: { status: 'fresh' },
      }) as never,
    );

    await useControlCenterStore.getState().loadAgentSessionDetail(SESSION_ID);

    // No history to recover → no escalation.
    expect(mockLoadAiSession).toHaveBeenCalledTimes(1);
    // Genuinely empty + no known history ⇒ authoritative empty (don't re-fetch).
    expect(getRun()?.detailState).toEqual({ kind: 'empty' });
  });

  test('手动刷新(refresh:true)→ 不重复强刷,即使空 + 已知历史', async () => {
    mockLoadAiSession.mockResolvedValue(
      makeSession({
        session_id: SESSION_ID,
        transcript: [],
        transcript_count: 3,
        detail_refresh: { status: 'fresh' },
      }) as never,
    );

    await useControlCenterStore
      .getState()
      .loadAgentSessionDetail(SESSION_ID, { refresh: true });

    // The caller already forced the agent; the store must not add a second hit.
    expect(mockLoadAiSession).toHaveBeenCalledTimes(1);
    expect(mockLoadAiSession.mock.calls[0]).toEqual([
      SESSION_ID,
      { refresh: true },
    ]);
  });

  test('server_owned(goal)会话 → 不走 agent 重试', async () => {
    mockLoadAiSession.mockResolvedValue(
      makeSession({
        session_id: SESSION_ID,
        purpose: 'goal',
        transcript: [],
        transcript_count: 3,
        detail_refresh: { status: 'server_owned' },
      }) as never,
    );

    await useControlCenterStore.getState().loadAgentSessionDetail(SESSION_ID);

    // Goal history is the server ledger; never re-ask the agent.
    expect(mockLoadAiSession).toHaveBeenCalledTimes(1);
    expect(mockLoadAiSession.mock.calls[0]).toEqual([
      SESSION_ID,
      { refresh: undefined },
    ]);
  });
});

describe('loadAgentSessionDetail — refresh status + structuredEvents reconcile', () => {
  beforeEach(() => {
    mockLoadAiSession.mockReset();
    resetStore();
  });

  test('把 detail_refresh.status 返回给调用方(failed → 徽标刷新可给反馈)', async () => {
    mockLoadAiSession.mockResolvedValueOnce(
      makeSession({
        session_id: SESSION_ID,
        transcript: [msg('m1')],
        detail_refresh: { status: 'failed', error: 'agent_request_timeout' },
      }) as never,
    );

    const result = await useControlCenterStore
      .getState()
      .loadAgentSessionDetail(SESSION_ID, { refresh: true });

    expect(result).toEqual({ detailRefreshStatus: 'failed' });
  });

  test('REST 刷新保留往返窗口内的本地活动事件(并集),eventDetailCache 不被清空', async () => {
    // 本地已持有:快照里有的 e1 + 快照还没有的 live 事件 e2-live。
    const envelope = (eventId: string, command: string) => ({
      type: 'ai.command',
      event_id: eventId,
      message_id: 'm1',
      item_id: eventId,
      status: 'started',
      command,
    });
    useControlCenterStore.setState(state => ({
      vibeRuns: [
        {
          id: SESSION_ID,
          title: 'run',
          deviceId: 'd1',
          projectId: 'p1',
          directory: '~/proj',
          status: 'running',
          objective: '',
          model: 'glm-5.3',
          risk: 'medium',
          currentStep: '',
          branch: 'main',
          lastActivityMs: 0,
          updatedAt: '',
          suggestions: [],
          transcript: [],
          events: [],
          structuredEvents: [
            {
              kind: 'command',
              eventId: 'e1',
              messageId: 'm1',
              itemId: 'e1',
              status: 'started',
              command: 'old',
            },
            {
              kind: 'command',
              eventId: 'e2-live',
              messageId: 'm1',
              itemId: 'e2-live',
              status: 'running',
              command: 'just-arrived-live',
            },
          ],
          eventDetailCache: { 'ev-9': { text: 'cached' } } as never,
        },
        ...state.vibeRuns,
      ],
    }));

    mockLoadAiSession.mockResolvedValueOnce(
      makeSession({
        session_id: SESSION_ID,
        transcript: [msg('m1')],
        detail_refresh: { status: 'fresh' },
        structured_events: [envelope('e1', 'updated-by-snapshot'), envelope('e3', 'from-server')],
      }) as never,
    );

    await useControlCenterStore.getState().loadAgentSessionDetail(SESSION_ID, {
      refresh: true,
    });

    const run = getRun();
    const eventIds = (run?.structuredEvents ?? []).map(e => e.eventId);
    // 快照携带的事件刷新(e1 以快照为准、e3 新增),live 独有的 e2-live 不被清掉。
    expect(eventIds).toContain('e1');
    expect(eventIds).toContain('e2-live');
    expect(eventIds).toContain('e3');
    expect(
      run?.structuredEvents.find(e => e.eventId === 'e1')?.kind === 'command' &&
        (run?.structuredEvents.find(e => e.eventId === 'e1') as { command?: string }).command,
    ).toBe('updated-by-snapshot');
    expect(run?.eventDetailCache).toEqual({ 'ev-9': { text: 'cached' } });
  });
});
