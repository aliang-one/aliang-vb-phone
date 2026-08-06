/**
 * useGoalControl — goal lifecycle actions (pause/resume/recover/delete)
 * extracted from VibeCodingSessionScreen.
 *
 * Owns the goalControlAction loading state + the API calls to the server's
 * goal control endpoints. Returns the action state + trigger callbacks that
 * the GoalStatusBar JSX renders.
 */
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import type { VibeCodingRun } from '../../data/platformModels';
import { createId } from '../../store/internals';
import {
  deleteGoal,
  pauseGoal,
  recoverGoal,
  resumeGoal,
} from '../../api/goals';
import { ApiResponseError } from '../../api/client';

export type GoalControlAction = 'pause' | 'resume' | 'recover' | 'delete';

export interface GoalControlInput {
  session: VibeCodingRun | undefined;
  loadAgentSessionDetail: (
    sessionId: string,
    options?: { refresh?: boolean },
  ) => Promise<unknown>;
  setDetailError: (message: string) => void;
  onDeleted: () => void;
}

export interface GoalControl {
  actionLoading: GoalControlAction | undefined;
  runGoalControl: (action: 'pause' | 'resume' | 'recover') => Promise<void>;
  confirmDeleteGoal: () => void;
}

export function useGoalControl(input: GoalControlInput): GoalControl {
  const { session, loadAgentSessionDetail, setDetailError, onDeleted } = input;
  const [actionLoading, setActionLoading] = useState<GoalControlAction | undefined>();

  const runGoalControl = useCallback(
    async (action: 'pause' | 'resume' | 'recover') => {
      const goalId = session?.goalSummary?.goalId;
      const stateVersion = session?.goalSummary?.stateVersion;
      if (!session || !goalId || stateVersion === undefined || actionLoading) return;
      setActionLoading(action);
      setDetailError('');
      try {
        const controlPayload = {
          expectedStateVersion: stateVersion,
          idempotencyKey: createId(`goal-${action}`),
        };
        if (action === 'pause') await pauseGoal(goalId, controlPayload);
        else if (action === 'recover') await recoverGoal(goalId, controlPayload);
        else await resumeGoal(goalId, controlPayload);
        await loadAgentSessionDetail(session.id, { refresh: true });
      } catch (error) {
        setDetailError(goalRequestErrorMessage(error));
        void loadAgentSessionDetail(session.id, { refresh: true }).catch(() => undefined);
      } finally {
        setActionLoading(undefined);
      }
    },
    [actionLoading, loadAgentSessionDetail, session, setDetailError],
  );

  const confirmDeleteGoal = useCallback(() => {
    const goalId = session?.goalSummary?.goalId;
    const stateVersion = session?.goalSummary?.stateVersion;
    if (!session || !goalId || stateVersion === undefined || actionLoading) return;
    Alert.alert(
      '删除 Goal',
      'Goal 将停止后续执行并从手机列表隐藏。执行记录会保留用于状态审计。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            setActionLoading('delete');
            setDetailError('');
            void deleteGoal(goalId, {
              expectedStateVersion: stateVersion,
              idempotencyKey: createId('goal-delete'),
            })
              .then(() => onDeleted())
              .catch(error => {
                setDetailError(goalRequestErrorMessage(error));
                void loadAgentSessionDetail(session.id, { refresh: true }).catch(() => undefined);
              })
              .finally(() => setActionLoading(undefined));
          },
        },
      ],
    );
  }, [actionLoading, loadAgentSessionDetail, onDeleted, session, setDetailError]);

  return { actionLoading, runGoalControl, confirmDeleteGoal };
}

export function goalRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiResponseError) {
    if (error.status === 404) return '当前服务端版本不支持 Goal，请升级服务端后重试。';
    if (error.code === 'ai_control_disabled') return '当前设备未开启 AI 控制。';
    if (error.code === 'goal_capability_missing') return '电脑 Agent 版本过旧或尚未重新连接，请更新 Agent 并重新登录后再试。';
    if (error.code === 'path_not_authorized') return '当前项目目录未被设备授权。';
    if (error.code === 'goal_repository_unavailable') return 'Goal 状态存储暂时不可用。';
    if (error.code === 'goal_state_version_conflict') return 'Goal 状态已变化，已重新同步，请再试一次。';
    if (error.code === 'goal_pause_in_progress') return '当前一轮尚未结束，暂停完成后才能继续。';
    if (error.code === 'goal_not_pauseable') return '当前 Goal 状态不能暂停，已重新同步。';
    if (error.code === 'goal_not_paused') return 'Goal 已不在暂停状态，已重新同步。';
    if (error.code === 'goal_deleted') return '这个 Goal 已被删除。';
    return error.message || `Goal 请求失败（HTTP ${error.status}）`;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Goal 请求失败，请重试。';
}
