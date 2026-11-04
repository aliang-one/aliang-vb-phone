/**
 * useConversationRuns 的历史层并集(2026-11-04)。
 *
 * 该 hook 原样给 mergeSessionListRuns 传空数组(10-03 陈旧形态,早于游标分页
 * 历史层落地),AgentSessionsScreen/DeviceDetailScreen 因此只看得见活跃层
 * vibeRuns——凡不在 realtime 层的会话(手机重启后、跨端会话如仪表盘发起的
 * agentcore 会话、已关闭会话)全部隐身。修复后与 useSessionListRuns 同构:
 * mergeSessionListRuns(vibeRuns, aiSessionHistory)。本文件钉死合并语义:
 * 历史并集 + live id 去重 + 两臂 Goal 过滤(对话/任务分离语义不变)。
 */
import { mergeSessionListRuns } from '../controlCenterStore';
import type { VibeCodingRun } from '../../data/platformModels';

const makeRun = (id: string, purpose?: 'goal'): VibeCodingRun =>
  ({
    id,
    title: `run-${id}`,
    status: 'idle',
    phase: 'done',
    purpose,
    transcript: [],
    createdAt: '2026-11-04T00:00:00Z',
    updatedAt: '2026-11-04T00:00:00Z',
  } as unknown as VibeCodingRun);

describe('mergeSessionListRuns 历史层并集(useConversationRuns 语义)', () => {
  it('历史层会话并入列表,dashboard/已关闭等非活跃会话不再隐身', () => {
    const merged = mergeSessionListRuns(
      [makeRun('live-1')],
      [makeRun('local-dash1'), makeRun('closed-2')],
    );
    expect(merged.map(run => run.id)).toEqual(['live-1', 'local-dash1', 'closed-2']);
  });

  it('live 层同 id 不被历史层陈旧副本顶替', () => {
    const merged = mergeSessionListRuns(
      [makeRun('same-id')],
      [makeRun('same-id'), makeRun('hist-1')],
    );
    expect(merged.map(run => run.id)).toEqual(['same-id', 'hist-1']);
    expect(merged).toHaveLength(2);
  });

  it('两臂都剔除 Goal 会话(对话/任务分离语义不变)', () => {
    const merged = mergeSessionListRuns(
      [makeRun('live-goal', 'goal'), makeRun('live-1')],
      [makeRun('hist-goal', 'goal'), makeRun('hist-1')],
    );
    expect(merged.map(run => run.id)).toEqual(['live-1', 'hist-1']);
  });
});
