/**
 * deleteAgentSession 对 goal 会话的通道分流回归(2026-10-05):
 * 服务端按设计拒绝 DELETE /api/ai/sessions/:id 上的 goal 会话
 * (409 goal_managed_session,guards.ts assertNotGoalManagedSession)——
 * goal 必须经 /api/goals/:id/delete 专用通道删除。列表长按删除此前直发
 * 会话删除接口,goal 会话永远 409 →「很多删不掉」。
 * 契约:purpose==='goal'(或带 goalSummary)的会话 → 取权威快照拿
 * state_version 后走 deleteGoal;普通会话 → 原通道不变。
 */
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { platformTransport } from '../src/services/platformTransport';
import { fetchGoalSnapshot, deleteGoal } from '../src/api/goals';
import type { VibeCodingRun } from '../src/data/platformModels';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    deleteAiSession: jest.fn(),
  },
}));

jest.mock('../src/api/goals', () => ({
  fetchGoalSnapshot: jest.fn(),
  deleteGoal: jest.fn(),
}));

const goalRun = (): VibeCodingRun =>
  ({
    id: 'goal_session_1',
    kind: 'ai',
    purpose: 'goal',
    goalSummary: {
      goalId: 'goal_session_1',
      state: 'planning_failed',
      stateVersion: 2,
    },
    status: 'idle',
  }) as unknown as VibeCodingRun;

const chatRun = (): VibeCodingRun =>
  ({
    id: 'chat_session_1',
    kind: 'ai',
    purpose: 'chat',
    status: 'idle',
  }) as unknown as VibeCodingRun;

describe('deleteAgentSession routes goal sessions to the goal channel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchGoalSnapshot as jest.Mock).mockResolvedValue({
      goal_id: 'goal_session_1',
      state: 'planning_failed',
      state_version: 7,
    });
    (deleteGoal as jest.Mock).mockResolvedValue({ goal_id: 'goal_session_1' });
    (platformTransport.deleteAiSession as jest.Mock).mockResolvedValue({
      status: 'deleted',
    });
    useControlCenterStore.setState({
      serverMode: true,
      vibeRuns: [goalRun(), chatRun()],
      aiSessionHistory: [],
      sessionCommands: {},
      devices: [],
    });
  });

  it('goal 会话:先取快照再走 deleteGoal,不发会话删除', async () => {
    await useControlCenterStore.getState().deleteAgentSession('goal_session_1');

    expect(fetchGoalSnapshot).toHaveBeenCalledWith('goal_session_1');
    expect(deleteGoal).toHaveBeenCalledWith(
      'goal_session_1',
      expect.objectContaining({ expectedStateVersion: 7 }),
    );
    expect(platformTransport.deleteAiSession).not.toHaveBeenCalled();
    expect(
      useControlCenterStore.getState().vibeRuns.map(run => run.id),
    ).toEqual(['chat_session_1']);
  });

  it('快照缺失 state_version 时回退本地 goalSummary.stateVersion', async () => {
    (fetchGoalSnapshot as jest.Mock).mockResolvedValue({
      goal_id: 'goal_session_1',
      state: 'planning_failed',
    });
    await useControlCenterStore.getState().deleteAgentSession('goal_session_1');

    expect(deleteGoal).toHaveBeenCalledWith(
      'goal_session_1',
      expect.objectContaining({ expectedStateVersion: 2 }),
    );
  });

  it('普通会话:原通道不变,不触碰 goal 接口', async () => {
    await useControlCenterStore.getState().deleteAgentSession('chat_session_1');

    expect(platformTransport.deleteAiSession).toHaveBeenCalledWith(
      'chat_session_1',
    );
    expect(fetchGoalSnapshot).not.toHaveBeenCalled();
    expect(deleteGoal).not.toHaveBeenCalled();
  });

  it('goal 删除失败时错误向上抛(卡片维持既有失败恢复路径)', async () => {
    (deleteGoal as jest.Mock).mockRejectedValue(
      Object.assign(new Error('goal_state_version_conflict'), { status: 409 }),
    );
    await expect(
      useControlCenterStore.getState().deleteAgentSession('goal_session_1'),
    ).rejects.toThrow('goal_state_version_conflict');
  });
});
