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
