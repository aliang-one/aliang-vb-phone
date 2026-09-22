/**
 * vibeRuns 引用稳定性契约(controlCenterStore.ts:86-88 注释所声明的):
 *
 *   "`find` returns a stable reference as long as that one run object's
 *    identity is unchanged — merging logic keeps unchanged runs referentially
 *    equal, so the selector bails out cheaply."
 *
 * useVibeRun(sessionId) 用 Object.is 比较选中对象 —— 任何让"无关 run"引用翻转
 * 的 store 写入,都会连带重渲染正在查看其他会话的聊天屏(3700 行组件全量重跑)。
 * 本文件钉住:ai.session.updated 不得翻转未变化会话的引用;截尾仍须生效。
 *
 * 范围注记:stateFromSnapshot(重连/下拉刷新)路径的 mergeVibeRunSnapshot 每次
 * 都构造新对象,身份保持需要给 merge 本身加 no-op 守卫(字段枚举,漏一处即
 * 丢更新的 staleness bug),收益(每次焦点刷新 1 次重渲染)不抵风险,有意不做。
 */
jest.mock('../../services/platformTransport', () => ({
  platformTransport: {
    loadAiSession: jest.fn(),
  },
}));

import { useControlCenterStore } from '../controlCenterStore';
import { emptySessionData, MAX_TRANSCRIPT_LENGTH } from '../internals';
import type { ServerAiMessage, ServerAiSession } from '../../api/sessions';

const msg = (id: string): ServerAiMessage => ({
  id,
  role: 'user',
  content: 'hi',
  timestamp: '2026-01-01T00:00:00Z',
});

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

const dispatchSessionUpdated = (session: ServerAiSession) => {
  useControlCenterStore
    .getState()
    .handleTransportEvent({ type: 'ai.session.updated', session } as never);
};

const getRun = (id: string) =>
  useControlCenterStore.getState().vibeRuns.find(run => run.id === id);

describe('ai.session.updated — vibeRuns 引用稳定性', () => {
  beforeEach(() => {
    resetStore();
  });

  test('无关会话 B 更新时,会话 A 的对象引用保持不变', () => {
    dispatchSessionUpdated(makeSession({ session_id: 'a', status: 'running' }));
    dispatchSessionUpdated(makeSession({ session_id: 'b', status: 'running' }));

    const runABefore = getRun('a');
    expect(runABefore).toBeDefined();

    dispatchSessionUpdated(
      makeSession({ session_id: 'b', status: 'closed', last_active_at: '2026-01-01T00:01:00Z' }),
    );

    const runAAfter = getRun('a');
    // B 的更新只允许翻转 B 自己的引用;A 必须原样保留,
    // 否则查看 A 的聊天屏会被 B 的每次广播连带重渲染。
    expect(runAAfter).toBe(runABefore);
  });

  test('无关会话 B 的 settle 广播(同内容重复推送)也不翻转 A 的引用', () => {
    dispatchSessionUpdated(makeSession({ session_id: 'a', status: 'running' }));
    dispatchSessionUpdated(makeSession({ session_id: 'b', status: 'running' }));

    const runABefore = getRun('a');

    // 空闲 settle / 周期快照常以相同数据重复广播 B。
    dispatchSessionUpdated(makeSession({ session_id: 'b', status: 'running' }));
    dispatchSessionUpdated(makeSession({ session_id: 'b', status: 'running' }));

    expect(getRun('a')).toBe(runABefore);
  });

  test('截尾内存上限仍然生效:超限会话在任意更新后被裁到 MAX_TRANSCRIPT_LENGTH', () => {
    const longTranscript = Array.from({ length: MAX_TRANSCRIPT_LENGTH + 30 }, (_, i) =>
      msg(`m${i}`),
    );
    dispatchSessionUpdated(
      makeSession({ session_id: 'a', status: 'running', transcript: longTranscript }),
    );

    // 触发另一次任意更新(B),trim pass 仍须裁掉 A 的超限 transcript。
    dispatchSessionUpdated(makeSession({ session_id: 'b', status: 'running' }));

    const runA = getRun('a');
    expect(runA?.transcript.length).toBe(MAX_TRANSCRIPT_LENGTH);
    // 保留的是最新的消息(ring-buffer 语义)。
    expect(runA?.transcript[runA.transcript.length - 1].id).toBe(
      `m${MAX_TRANSCRIPT_LENGTH + 29}`,
    );
  });

  test('未超限会话的 transcript 引用在无关更新后保持不变', () => {
    dispatchSessionUpdated(
      makeSession({
        session_id: 'a',
        status: 'running',
        transcript: [msg('m1'), msg('m2')],
      }),
    );
    const runABefore = getRun('a');

    dispatchSessionUpdated(makeSession({ session_id: 'b', status: 'closed' }));

    const runAAfter = getRun('a');
    expect(runAAfter?.transcript).toBe(runABefore?.transcript);
  });
});
