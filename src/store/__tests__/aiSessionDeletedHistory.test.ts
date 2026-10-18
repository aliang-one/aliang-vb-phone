/**
 * ai.session.deleted 事件的 aiSessionHistory/sessionCommands 清理。
 *
 * 2026-10-18 审计:deleted 分支只清 vibeRuns 与 devices.activeSessionIds,
 * aiSessionHistory(游标分页预取的摘要缓存,mergeSessionListRuns 并集进列表)
 * 永不剔除——服务端已删除的会话在手机列表残留为"点开无内容"的幽灵卡片,
 * 刷新也只重拉当前页,残留直到杀 App。本测试钉死:deleted 事件必须同步清
 * aiSessionHistory 与 sessionCommands(与 deleteAgentSession 的本机删除
 * 路径保持同一清理面)。
 */
import { useControlCenterStore } from '../controlCenterStore';
import type { VibeCodingRun } from '../../data/platformModels';

const makeRun = (id: string): VibeCodingRun =>
  ({
    id,
    title: `run-${id}`,
    status: 'idle',
    phase: 'done',
    transcript: [],
    createdAt: '2026-10-18T00:00:00Z',
    updatedAt: '2026-10-18T00:00:00Z',
  } as unknown as VibeCodingRun);

describe('ai.session.deleted 清理 aiSessionHistory', () => {
  it('删除事件同步剔除 vibeRuns、aiSessionHistory 与 sessionCommands', () => {
    const store = useControlCenterStore.getState();
    useControlCenterStore.setState({
      vibeRuns: [makeRun('del-hist-s1')],
      aiSessionHistory: [makeRun('del-hist-s1'), makeRun('del-hist-s2')],
      sessionCommands: { 'del-hist-s1': { items: [] } } as never,
      devices: [],
    });

    store.handleTransportEvent({
      type: 'ai.session.deleted',
      sessionId: 'del-hist-s1',
      raw: {},
    });

    const next = useControlCenterStore.getState();
    expect(next.vibeRuns.map(run => run.id)).toEqual([]);
    expect(next.aiSessionHistory.map(run => run.id)).toEqual(['del-hist-s2']);
    expect(next.sessionCommands['del-hist-s1']).toBeUndefined();
  });
});
