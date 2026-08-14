import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlowButton } from '../../components/shared/GlowButton';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { IconBadge } from '../../components/visual/IconBadge';
import type { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore, useSessionApprovalEvents, useVibeRun } from '../../store/controlCenterStore';
import { createId } from '../../store/internals';
import type { GoalCheckType, GoalSummary, GoalAcceptanceCriterionSummary } from '../../data/platformModels';
import {
  acceptGoal,
  approveGoalPlan,
  declineGoal,
  deleteGoal,
  fetchGoalEvents,
  fetchGoalSnapshot,
  forkGoal,
  abandonFork,
  mergeFork,
  goalSnapshotToSummary,
  newerGoalSummary,
  recoverGoal,
} from '../../api/goals';
import { goalStateLabel } from '../../utils/goalStatePresentation';
import type { GoalEventSnapshot } from '../../api/goals';

type GoalDetailRoute = RouteProp<RootStackParamList, 'GoalDetail'>;
type GoalDetailNavigation = NativeStackNavigationProp<RootStackParamList>;

// Goal-state labels live in utils/goalStatePresentation.ts (shared with
// GoalStatusBar) — Phase 1 可信签署闸 added awaiting_user_acceptance there.

const eventLabels: Record<string, string> = {
  'goal.created': 'Goal 已创建',
  'goal.plan.ready': '计划已生成',
  'goal.plan.failed': '计划生成失败',
  'goal.plan.approved': '计划已确认',
  'goal.run.completed': '任务回合已完成',
  'goal.run.continued_for_input': '已接收补充消息，继续任务',
  'goal.run.retrying': '任务回合失败，正在安全重试',
  'goal.run.blocked': '任务回合被阻塞',
  'goal.task.verified': '任务检查已通过',
  'goal.verification.failed': '任务检查未通过',
  'goal.verification.retrying': '任务检查未通过，正在继续修复',
  'goal.verification.blocked': '验证无法继续',
  'goal.budget_limited': '执行预算已到上限',
  'goal.blocked': 'Goal 被阻塞',
  'goal.acceptance.requested': '所有检查已通过，等待你确认完成',
  'goal.acceptance.signed': '你已确认完成',
  'goal.acceptance.rejected': '你要求继续调整，Goal 回到阻塞',
  'goal.completed': 'Goal 已完成',
  'goal.abandoned': 'Goal 已放弃',
  'goal.pause.requested': '已请求暂停，等待本轮结束',
  'goal.pause.awaiting_verification': '本轮结束，等待验证后暂停',
  'goal.paused': 'Goal 已暂停',
  'goal.resumed': 'Goal 已继续',
  'goal.deleted': 'Goal 已删除',
};

const taskStateLabels: Record<string, string> = {
  pending: '待处理',
  in_progress: '执行中',
  verification_pending: '待验证',
  completed: '已完成',
  blocked: '已阻塞',
  superseded: '已替换',
};

const checkStateLabels: Record<string, string> = {
  pending: '待检查',
  running: '检查中',
  passed: '已通过',
  failed: '未通过',
  stale: '已失效',
  error: '检查错误',
};

const _checkTypeLabels: Record<GoalCheckType, string> = {
  command: '命令验收',
  file_exists: '文件存在',
  file_contains: '文件包含',
};

const toneForTaskState = (state?: string): 'success' | 'primary' | 'error' | 'onSurfaceVariant' => {
  if (state === 'completed') return 'success';
  if (state === 'in_progress') return 'primary';
  if (state === 'blocked' || state === 'superseded') return 'error';
  return 'onSurfaceVariant';
};

const _toneForCheckState = (state?: string): 'success' | 'error' | 'primary' | 'onSurfaceVariant' => {
  if (state === 'passed') return 'success';
  if (state === 'failed' || state === 'error') return 'error';
  if (state === 'running') return 'primary';
  return 'onSurfaceVariant';
};

const resolveToneColor = (
  theme: ReturnType<typeof useTheme>['theme'],
  tone: ReturnType<typeof toneForTaskState>,
): string => {
  switch (tone) {
    case 'success':
      return theme.colors.success;
    case 'error':
      return theme.colors.error;
    case 'primary':
      return theme.colors.primary;
    default:
      return theme.colors.onSurfaceVariant;
  }
};

const displayTimestamp = (value?: string): string | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const toneForState = (state?: string): 'primary' | 'success' | 'warning' | 'error' | 'neutral' => {
  if (state === 'completed') return 'success';
  if (state === 'blocked' || state === 'planning_failed' || state === 'budget_limited') return 'error';
  if (state === 'awaiting_approval' || state === 'awaiting_user_acceptance') return 'warning';
  if (state === 'paused' || state === 'cancelled' || state === 'abandoned') return 'neutral';
  return 'primary';
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const { theme } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
};

const EmptySection: React.FC<{ text: string }> = ({ text }) => {
  const { theme } = useTheme();
  return <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurfaceVariant }]}>{text}</Text>;
};

export const GoalSummaryHeader: React.FC<{ summary?: GoalSummary }> = ({ summary }) => {
  const { theme } = useTheme();
  const completed = summary?.completedTasks;
  const total = summary?.totalTasks;
  const hasProgress = typeof completed === 'number' && typeof total === 'number' && total > 0;
  const progress = hasProgress ? Math.min(1, Math.max(0, completed! / total!)) : 0;
  const label = goalStateLabel(summary?.state);

  return (
    <View style={[styles.summary, { backgroundColor: theme.colors.background, borderBottomColor: theme.colors.outlineVariant }]}>
      <View style={styles.summaryTitleRow}>
        <IconBadge name="goal" tone={toneForState(summary?.state)} size={38} iconSize={19} />
        <View style={styles.summaryCopy}>
          <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]} numberOfLines={2}>
            {summary?.objective ?? (summary ? `Goal · ${label}` : 'Goal · 同步中')}
          </Text>
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
            {summary
              ? `${label}${summary.provider ? ` · ${summary.provider}` : ''}${summary.driver ? ` / ${summary.driver}` : ''}${summary.model ? ` · ${summary.model}` : ''}${summary.effort ? ` / ${summary.effort}` : ''}`
              : '正在获取权威状态'}
          </Text>
        </View>
      </View>
      <View style={styles.progressRow}>
        <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
          {hasProgress ? `${completed}/${total} 个任务` : '进度尚未同步'}
        </Text>
        {summary?.currentTask ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
            当前：{summary.currentTask}
          </Text>
        ) : null}
      </View>
      {hasProgress ? (
        <View style={[styles.track, { backgroundColor: theme.colors.outlineVariant }]}>
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: theme.colors.primary }]} />
        </View>
      ) : null}
      {summary?.attention ? (
        <Text
          testID="goal-attention"
          accessibilityLabel="Goal 失败真因"
          accessibilityRole="text"
          style={[theme.typography.bodyMd, { color: theme.colors.error }]}>
          {summary.attention}
        </Text>
      ) : null}
      {summary?.planningErrorDetail ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
          {summary.planningErrorDetail}
        </Text>
      ) : null}
      {summary?.state === 'planning' &&
      (summary.planningPhase || summary.planningThinkingPreview || typeof summary.planningAttempt === 'number') ? (
        <View style={styles.planningLive}>
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {planningPhaseLabel(summary.planningPhase)}
            {typeof summary.planningAttempt === 'number' && summary.planningAttempt > 0
              ? ` · 第 ${summary.planningAttempt} 次生成` : ''}
            {typeof summary.planningThinkingChars === 'number' && summary.planningThinkingChars > 0
              ? ` · 已思考 ${summary.planningThinkingChars} 字` : ''}
          </Text>
          {summary.planningThinkingPreview ? (
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}
              numberOfLines={4}
            >
              {summary.planningThinkingPreview}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const planningPhaseLabel = (phase?: string): string => {
  switch (phase) {
    case 'exploring':
      return '探索工作区中';
    case 'emitting':
      return '生成计划中';
    case 'awaiting_user_input':
      return '等待你的回答';
    default:
      return '规划中';
  }
};

export const GoalDetailScreen: React.FC = () => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const route = useRoute<GoalDetailRoute>();
  const navigation = useNavigation<GoalDetailNavigation>();
  const session = useVibeRun(route.params.sourceSessionId);
  const loadAgentSessionDetail = useControlCenterStore(state => state.loadAgentSessionDetail);
  const [summary, setSummary] = useState<GoalSummary | undefined>(session?.goalSummary);
  const [loading, setLoading] = useState(!session?.goalSummary);
  const [loadError, setLoadError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState('');
  const [events, setEvents] = useState<GoalEventSnapshot[]>([]);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [_expandedCheckId, _setExpandedCheckId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'plan' | 'execution'>('plan');
  // Phase 2 criterion editing (codex #1): editable copy of the goal's acceptance
  // criteria. Synced from the server when the criterion key-set changes (first
  // load / replan); user edits preserved across refreshes of the same plan.
  const [criteriaDraft, setCriteriaDraft] = useState<GoalAcceptanceCriterionSummary[]>(summary?.criteria ?? []);
  const canApprove = summary?.primaryActionKind === 'approve_plan' &&
    summary.state === 'awaiting_approval' &&
    Boolean(summary.revision?.id) &&
    typeof summary.stateVersion === 'number';
  const canRecover = Boolean(
    summary?.recoverable &&
    typeof summary?.stateVersion === 'number' &&
    (summary?.primaryActionKind === 'continue' || summary?.primaryActionKind === 'retry'),
  );
  // Phase 1 可信签署闸: every task check passed — the user can sign off (accept)
  // or send it back (decline → blocked → /recover replans).
  const canAccept = summary?.primaryActionKind === 'accept_completion' &&
    summary.state === 'awaiting_user_acceptance' &&
    typeof summary.stateVersion === 'number';
  const actionLabel = canApprove
    ? (summary?.primaryActionLabel ?? '确认计划')
    : canAccept
      ? (summary?.primaryActionLabel ?? '确认完成')
      : canRecover
        ? (summary?.primaryActionLabel ?? '继续')
        : '刷新状态';
  // Fork: ONLY visible when the AI proactively suggests it (branchSuggestion),
  // not whenever the goal is in a forkable state.
  const canFork = Boolean(
    summary &&
    summary.branchSuggestion &&
    typeof summary.stateVersion === 'number',
  );
  const canDelete = Boolean(
    summary &&
    typeof summary.stateVersion === 'number',
  );

  // Sync local `summary` from the session's goalSummary. Depend ONLY on the
  // primitive version+state — `session.goalSummary` is rebuilt as a NEW object
  // reference on every realtime push (even when content is unchanged during
  // streaming), so depending on the object would re-fire this effect every
  // render and churn summary → Maximum update depth exceeded.
  const goalSummaryStateVersion = session?.goalSummary?.stateVersion;
  const goalSummaryState = session?.goalSummary?.state;
  useEffect(() => {
    if (!session?.goalSummary) return;
    setSummary(current => newerGoalSummary(current, session.goalSummary!));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalSummaryStateVersion, goalSummaryState]);

  // Sync criteriaDraft when the server's criterion key-set changes (first load /
  // replan). Edits are preserved across refreshes of the SAME plan (same keys).
  const criteriaKeys = summary?.criteria?.map(c => c.key).sort().join(',');
  useEffect(() => {
    const incoming = summary?.criteria;
    if (!incoming || incoming.length === 0) return;
    const draftKeys = criteriaDraft.map(c => c.key).sort().join(',');
    if (criteriaKeys !== draftKeys) {
      setCriteriaDraft(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteriaKeys]);

  const refreshGoal = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError('');
      try {
        const [snapshot, eventPage] = await Promise.all([
          fetchGoalSnapshot(route.params.goalId, signal),
          fetchGoalEvents(route.params.goalId, signal),
        ]);
        if (signal?.aborted) return;
        const incoming = goalSnapshotToSummary(snapshot);
        setSummary(current => newerGoalSummary(current, incoming));
        setEvents(eventPage.events);
      } catch (error) {
        if (signal?.aborted) return;
        setLoadError(error instanceof Error ? error.message : 'Goal 状态同步失败');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [route.params.goalId],
  );

  useEffect(() => {
    const controller = new AbortController();
    refreshGoal(controller.signal);
    return () => controller.abort();
  }, [refreshGoal]);

  // While planning, poll the authoritative snapshot so the user SEES the
  // planner working — phase / attempt / live reasoning preview — instead of a
  // silent, baffling "规划中". Stops as soon as the goal leaves planning.
  useEffect(() => {
    if (summary?.state !== 'planning') return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      refreshGoal(controller.signal).catch(() => {});
    }, 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [summary?.state, refreshGoal]);
  // approval.requested 是一次性推送，不更新 store 的 session.goalSummary.state；
  // 收到本 session 的 approval 事件就 refreshGoal 拉权威快照，让确认按钮立即
  // 出现（无需返回重进）。同 approval-not-live-recover-on-turnend 的自愈模式。
  const approvalEvents = useSessionApprovalEvents(
    route.params.sourceSessionId ?? route.params.goalId,
    undefined,
  );
  const approvalEventCount = approvalEvents.length;
  useEffect(() => {
    if (approvalEventCount === 0) return;
    const controller = new AbortController();
    refreshGoal(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [approvalEventCount, refreshGoal]);

  const performRecover = useCallback(async () => {
    if (!summary || summary.stateVersion === undefined) return;
    setActionLoading(true);
    setActionFeedback('');
    try {
      const snapshot = await recoverGoal(summary.goalId, {
        expectedStateVersion: summary.stateVersion,
        idempotencyKey: createId('goal-recover'),
      });
      setSummary(current => newerGoalSummary(current, goalSnapshotToSummary(snapshot)));
      setActionFeedback('已发出恢复指令');
    } catch (error) {
      setActionFeedback(error instanceof Error ? error.message : '恢复失败，请重试');
      await refreshGoal();
    } finally {
      setActionLoading(false);
    }
  }, [refreshGoal, summary]);

  // Phase 1 可信签署闸: sign off (accept → completed) — the ONLY way a goal
  // completes now. Idempotent via a fresh idempotency key per tap.
  const performAccept = useCallback(async () => {
    if (!summary || summary.stateVersion === undefined) return;
    setActionLoading(true);
    setActionFeedback('');
    try {
      const snapshot = await acceptGoal(summary.goalId, {
        expectedStateVersion: summary.stateVersion,
        idempotencyKey: createId('goal-accept'),
      });
      setSummary(current => newerGoalSummary(current, goalSnapshotToSummary(snapshot)));
      setActionFeedback('已确认完成');
      if (route.params.sourceSessionId) {
        await loadAgentSessionDetail(route.params.sourceSessionId, { refresh: true });
      }
    } catch (error) {
      setActionFeedback(error instanceof Error ? error.message : '确认失败，请重试');
      await refreshGoal();
    } finally {
      setActionLoading(false);
    }
  }, [loadAgentSessionDetail, refreshGoal, route.params.sourceSessionId, summary]);

  // Decline: reject false completion → goal blocked (user_rejected_completion)
  // → the existing recover/replan flow takes it back to work. Confirmed via Alert
  // because it reverses a completed-looking goal.
  const performDecline = useCallback(async () => {
    if (!summary || summary.stateVersion === undefined) return;
    setActionLoading(true);
    setActionFeedback('');
    try {
      const snapshot = await declineGoal(summary.goalId, {
        expectedStateVersion: summary.stateVersion,
        idempotencyKey: createId('goal-decline'),
      });
      setSummary(current => newerGoalSummary(current, goalSnapshotToSummary(snapshot)));
      setActionFeedback('已要求继续调整，Goal 回到阻塞，可恢复重规划');
    } catch (error) {
      setActionFeedback(error instanceof Error ? error.message : '操作失败，请重试');
      await refreshGoal();
    } finally {
      setActionLoading(false);
    }
  }, [refreshGoal, summary]);

  const confirmDecline = useCallback(() => {
    Alert.alert(
      '要求继续调整？',
      'Goal 将回到阻塞状态（不完成），之后可恢复并重新规划。检查结果仍保留。',
      [
        { text: '取消', style: 'cancel' },
        { text: '继续调整', style: 'destructive', onPress: performDecline },
      ],
    );
  }, [performDecline]);

  // Phase 2/6 fork: open a re-planning child session. The optional pivot task
  // id seeds the branch point (e.g. from a branchSuggestion); the authoritative
  // pivot is the ReplanDelta.replaceFromTaskKey the fork session emits at merge.
  const performFork = useCallback(async (pivotTaskId?: string) => {
    if (!summary || summary.stateVersion === undefined) return;
    setActionLoading(true);
    setActionFeedback('');
    try {
      await forkGoal(summary.goalId, {
        reason: '用户发起重规划探索',
        expectedStateVersion: summary.stateVersion,
        idempotencyKey: createId('goal-fork'),
        ...(pivotTaskId ? { taskId: pivotTaskId } : {}),
      });
      setActionFeedback('已开启重规划草稿，点击「进入草稿」继续');
      await refreshGoal();
    } catch (error) {
      setActionFeedback(error instanceof Error ? error.message : '分叉失败，请重试');
    } finally {
      setActionLoading(false);
    }
  }, [refreshGoal, summary]);

  // Phase 6: fork lifecycle — enter the child session, merge (parse the delta
  // the child session produced + kick off a branched re-plan), or abandon
  // (discard + resume). v1 stranded the user after opening a fork (audit #3).
  const enterForkSession = useCallback(() => {
    if (!summary?.openFork) return;
    navigation.navigate('VibeCodingSession', { sessionId: summary.openFork.childSessionId });
  }, [navigation, summary]);

  const performMergeFork = useCallback(async () => {
    if (!summary?.openFork || summary.stateVersion === undefined) return;
    setActionLoading(true);
    setActionFeedback('');
    try {
      await mergeFork(summary.goalId, summary.openFork.forkId, {
        expectedStateVersion: summary.stateVersion,
        idempotencyKey: createId('goal-fork-merge'),
      });
      setActionFeedback('已提交合并，正在生成新计划…');
      await refreshGoal();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // P1 merge loop: a fork that hasn't produced a ReplanDelta yet is not a
      // dead-end — guide the user INTO the fork session to ask the AI to submit,
      // then merge. Match ONLY fork_delta_missing so real validation errors
      // (fork_delta_pivot_invalid / fork_delta_pivot_mismatch) surface as such.
      if (/fork_delta_missing/i.test(message)) {
        setActionFeedback('草稿尚未提交方案，正在进入草稿会话…');
        enterForkSession();
      } else {
        setActionFeedback(message || '合并失败，请重试');
      }
    } finally {
      setActionLoading(false);
    }
  }, [refreshGoal, summary, enterForkSession]);

  const performAbandonFork = useCallback(async () => {
    if (!summary?.openFork) return;
    setActionLoading(true);
    setActionFeedback('');
    try {
      await abandonFork(summary.goalId, summary.openFork.forkId);
      setActionFeedback('已放弃重规划草稿，主 Goal 已恢复');
      await refreshGoal();
    } catch (error) {
      setActionFeedback(error instanceof Error ? error.message : '放弃失败，请重试');
    } finally {
      setActionLoading(false);
    }
  }, [refreshGoal, summary]);

  const runPrimaryAction = useCallback(async () => {
    if (!summary) {
      await refreshGoal();
      return;
    }
    if (summary.primaryActionKind === 'continue' || summary.primaryActionKind === 'retry') {
      await performRecover();
      return;
    }
    if (summary.primaryActionKind === 'accept_completion') {
      await performAccept();
      return;
    }
    if (summary.primaryActionKind !== 'approve_plan') {
      await refreshGoal();
      setActionFeedback('已同步最新 Goal 状态');
      return;
    }
    if (!canApprove || !summary.revision || summary.stateVersion === undefined) {
      setActionFeedback('计划状态已变化，已重新同步');
      await refreshGoal();
      return;
    }

    setActionLoading(true);
    setActionFeedback('');
    try {
      const snapshot = await approveGoalPlan(summary.goalId, {
        revisionId: summary.revision.id,
        expectedStateVersion: summary.stateVersion,
        idempotencyKey: createId('goal-plan-approval'),
        // Phase 2 criterion editing (codex #1): the user's edited criteria.
        criteria: criteriaDraft.length > 0
          ? criteriaDraft.map(c => ({
              key: c.key,
              statement: c.statement,
              kind: c.kind,
              verification: c.verification,
              required: c.required,
              mapped_check_keys: c.mappedCheckKeys,
            }))
          : undefined,
      });
      setSummary(current => newerGoalSummary(current, goalSnapshotToSummary(snapshot)));
      setActionFeedback('计划已确认，Goal 已进入执行队列');
      if (route.params.sourceSessionId) {
        await loadAgentSessionDetail(route.params.sourceSessionId, { refresh: true });
      }
    } catch (error) {
      setActionFeedback(error instanceof Error ? error.message : '操作失败，请重试');
      await refreshGoal();
    } finally {
      setActionLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccept, canApprove, loadAgentSessionDetail, performAccept, performRecover, refreshGoal, route.params.sourceSessionId, summary]);

  const performDelete = useCallback(async () => {
    if (!summary || summary.stateVersion === undefined) return;
    setActionLoading(true);
    setActionFeedback('');
    try {
      await deleteGoal(summary.goalId, {
        expectedStateVersion: summary.stateVersion,
        idempotencyKey: createId('goal-delete'),
      });
      navigation.goBack();
    } catch (error) {
      setActionFeedback(error instanceof Error ? error.message : '删除失败，请重试');
      await refreshGoal();
    } finally {
      setActionLoading(false);
    }
  }, [navigation, refreshGoal, summary]);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      '删除 Goal？',
      'Goal 将停止后续执行并从手机列表隐藏，历史与检查结果仍会保留。',
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: performDelete },
      ],
    );
  }, [performDelete]);

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Goal"
        subtitle={goalStateLabel(summary?.state)}
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        stickyHeaderIndices={[0]}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: (canDelete ? 180 : 110) + insets.bottom },
        ]}
        accessibilityLabel="Goal 详情">
        <GoalSummaryHeader summary={summary} />
        {loadError ? (
          <View style={[styles.errorBanner, { borderBottomColor: theme.colors.outlineVariant }]}>
            <View style={styles.rowCopy}>
              <Text style={[theme.typography.labelMd, { color: theme.colors.error }]}>状态同步失败</Text>
              <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={2}>
                {summary ? '正在显示上一次同步的状态' : loadError}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="重新同步 Goal 状态"
              onPress={() => refreshGoal()}
              disabled={loading}
              style={styles.retryButton}>
              <Text style={[theme.typography.labelMd, { color: theme.colors.primary }]}>{loading ? '同步中' : '重试'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {!summary ? (
          <View style={styles.loadingRow}>
            {loading ? <ActivityIndicator color={theme.colors.primary} /> : null}
            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurfaceVariant }]}>
              {loading ? '正在同步 Goal 状态' : '尚未获得 Goal 状态'}
            </Text>
          </View>
        ) : (
          <>
            {/* Tab switcher */}
            <View style={styles.tabBar}>
              <TouchableOpacity onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setActiveTab('plan'); }} style={styles.tabItem}>
                <Text style={[theme.typography.labelMd, { color: activeTab === 'plan' ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>计划</Text>
                {activeTab === 'plan' ? <View style={[styles.tabIndicator, { backgroundColor: theme.colors.primary }]} /> : null}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setActiveTab('execution'); }} style={styles.tabItem}>
                <Text style={[theme.typography.labelMd, { color: activeTab === 'execution' ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>执行</Text>
                {activeTab === 'execution' ? <View style={[styles.tabIndicator, { backgroundColor: theme.colors.primary }]} /> : null}
              </TouchableOpacity>
            </View>

            {activeTab === 'execution' ? (
            <>
            {/* Planning live activity */}
            {summary.state === 'planning' || summary.state === 'planning_failed' ? (
              <Section title="规划进度">
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {summary.state === 'planning' ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
                    <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                      {summary.planningPhase ?? (summary.state === 'planning' ? 'AI 正在规划...' : '规划失败')}
                    </Text>
                  </View>
                  {summary.planningAttempt ? (
                    <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                      第 {summary.planningAttempt} 次尝试 · {summary.planningThinkingChars ?? 0} 字符思考
                    </Text>
                  ) : null}
                  {summary.planningThinkingPreview ? (
                    <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={6}>
                      {summary.planningThinkingPreview}
                    </Text>
                  ) : null}
                  {summary.planningErrorCode ? (
                    <Text style={[theme.typography.labelSm, { color: theme.colors.error }]}>
                      错误：{summary.planningErrorCode}
                    </Text>
                  ) : null}
                </View>
              </Section>
            ) : null}

            {/* Current run / task execution */}
            <Section title="执行状态">
              <View style={{ gap: 6 }}>
                {summary.state === 'active' || summary.state === 'verifying' || summary.state === 'approval_pending' ? (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <ActivityIndicator size="small" color={theme.colors.primary} />
                      <Text style={[theme.typography.bodyMd, { color: theme.colors.primary, flexShrink: 1 }]} numberOfLines={2}>
                        {summary.currentTask ?? '正在执行...'}
                      </Text>
                    </View>
                    <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                      {summary.state === 'verifying' ? '正在验证检查...' : summary.state === 'approval_pending' ? '等待审批...' : 'AI 正在工作中'}
                    </Text>
                  </>
                ) : summary.state === 'awaiting_approval' ? (
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.warning }]}>
                    计划已就绪，等待你确认
                  </Text>
                ) : summary.state === 'awaiting_user_acceptance' ? (
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.success }]}>
                    所有任务完成，等待你验收
                  </Text>
                ) : summary.state === 'blocked' ? (
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.error }]}>
                    被阻塞：{summary.attention ?? '未知原因'}
                  </Text>
                ) : summary.state === 'budget_limited' ? (
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.warning }]}>
                    已达预算上限，可继续或重新规划
                  </Text>
                ) : summary.state === 'paused' ? (
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurfaceVariant }]}>
                    已暂停
                  </Text>
                ) : (
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                    {summary.currentRunHealth ?? '状态：' + goalStateLabel(summary.state)}
                  </Text>
                )}
                <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                  最近更新：{summary.updatedAt ? displayTimestamp(summary.updatedAt) : '同步中'}
                </Text>
              </View>
            </Section>

            {/* Task progress summary */}
            {summary.tasks?.length ? (
              <Section title="任务进度">
                {summary.tasks.map(task => (
                  <View key={task.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                    <Text style={[theme.typography.codeSm, { color: task.status === 'completed' ? theme.colors.primary : task.status === 'blocked' ? theme.colors.error : theme.colors.onSurfaceVariant }]}>
                      {task.status === 'completed' ? '✓' : task.status === 'in_progress' ? '▶' : task.status === 'blocked' ? '✕' : task.status === 'superseded' ? '⊘' : '○'}
                    </Text>
                    <Text style={[theme.typography.bodySm, { color: task.isCurrent ? theme.colors.primary : theme.colors.onSurface, fontWeight: task.isCurrent ? '600' : '400' }]} numberOfLines={1}>
                      {task.title}
                    </Text>
                  </View>
                ))}
              </Section>
            ) : null}
            </>
            ) : null}
            {activeTab === 'plan' ? (
            <Section title="计划">
              {summary.revision ? (
                <View style={styles.revisionMeta}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurface }]}>计划版本 {summary.revision.number}</Text>
                  <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                    {summary.revision.manifestDigest ? `清单 ${summary.revision.manifestDigest.slice(0, 10)}` : '不可变任务清单'}
                  </Text>
                  {summary.revision.constraints.map((constraint, index) => (
                    <Text key={`${index}:${constraint}`} style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>约束：{constraint}</Text>
                  ))}
                  {summary.revision.nonGoals.map((nonGoal, index) => (
                    <Text key={`${index}:${nonGoal}`} style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>不包含：{nonGoal}</Text>
                  ))}
                  {summary.revision.budget ? (
                    <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>预算：每项最多 {summary.revision.budget.maxAttemptsPerTask ?? '-'} 次尝试 · 最多 {summary.revision.budget.maxTurns ?? '-'} 个回合{summary.revision.budget.deadlineAt ? ` · 截止 ${displayTimestamp(summary.revision.budget.deadlineAt)}` : ''}</Text>
                  ) : null}
                </View>
              ) : null}
              {summary.tasks?.length ? (
                summary.tasks.map((task, index) => {
                  const expanded = expandedTaskId === task.id;
                  const stateTone = toneForTaskState(task.status);
                  const stateColor = resolveToneColor(theme, stateTone);
                  return (
                    <View key={task.id} style={styles.expandableRow}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`${task.title} ${expanded ? '收起详情' : '展开详情'}`}
                        style={styles.ledgerRow}
                        onPress={() => {
                          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                          setExpandedTaskId(prev => prev === task.id ? null : task.id);
                        }}
                      >
                        <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>{index + 1}</Text>
                        <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface, flexShrink: 1 }]} numberOfLines={2}>{task.title}</Text>
                        <Text style={[theme.typography.labelSm, { color: task.isCurrent ? theme.colors.primary : stateColor }]}>
                          {taskStateLabels[task.status ?? ''] ?? (task.isCurrent ? '当前' : '待处理')}{task.failureAttempt ? ` · ${task.failureAttempt} 次失败` : ''}
                        </Text>
                        <Text style={[theme.typography.titleMd, { color: theme.colors.onSurfaceVariant, marginLeft: 4 }]}>
                          {expanded ? '▲' : '▼'}
                        </Text>
                      </TouchableOpacity>
                      {expanded ? (
                        <GlassPanel style={styles.detailPanel}>
                          {task.description ? (
                            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>{task.description}</Text>
                          ) : null}
                          {task.allowedCommands?.length ? (
                            <View style={styles.detailBlock}>
                              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>允许命令</Text>
                              <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>{task.allowedCommands.join(' · ')}</Text>
                            </View>
                          ) : null}
                          {task.dependsOn?.length ? (
                            <View style={styles.detailBlock}>
                              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>依赖任务</Text>
                              {task.dependsOn.map((depKey, depIdx) => {
                                const depTask = summary.tasks?.find(t => t.key === depKey);
                                return (
                                  <Text key={`${depIdx}:${depKey}`} style={[theme.typography.bodySm, { color: theme.colors.onSurface }]}>
                                    {depTask?.title ?? depKey}{depTask?.status ? ` · ${taskStateLabels[depTask.status] ?? depTask.status}` : ''}
                                  </Text>
                                );
                              })}
                            </View>
                          ) : null}
                          {/* Task-level machine checks — embedded in the task detail */}
                          {task.requiredCheckIds?.length ? (
                            <View style={styles.detailBlock}>
                              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>机器校验</Text>
                              {task.requiredCheckIds.map((checkId, checkIdx) => {
                                const relCheck = summary.checks?.find(c => c.id === checkId);
                                const checkTone = relCheck?.status === 'passed' ? theme.colors.primary : relCheck?.status === 'failed' || relCheck?.status === 'error' ? theme.colors.error : theme.colors.onSurfaceVariant;
                                return (
                                  <View key={`${checkIdx}:${checkId}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}>
                                    <Text style={[theme.typography.codeSm, { color: checkTone }]}>
                                      {relCheck?.status === 'passed' ? '✓' : relCheck?.status === 'failed' ? '✕' : '○'}
                                    </Text>
                                    <Text style={[theme.typography.bodySm, { color: theme.colors.onSurface, flexShrink: 1 }]} numberOfLines={1}>
                                      {relCheck?.title ?? checkId}
                                    </Text>
                                    <Text style={[theme.typography.labelSm, { color: checkTone }]}>
                                      {relCheck?.status ? (checkStateLabels[relCheck.status] ?? relCheck.status) : '待校验'}
                                    </Text>
                                  </View>
                                );
                              })}
                            </View>
                          ) : null}
                          {!task.description && !task.allowedCommands?.length && !task.dependsOn?.length && !task.requiredCheckIds?.length ? (
                            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>暂无额外详情</Text>
                          ) : null}
                        </GlassPanel>
                      ) : null}
                    </View>
                  );
                })
              ) : <EmptySection text="任务列表尚未同步" />}
            </Section>
            ) : null}
            {activeTab === 'plan' && criteriaDraft.length > 0 ? (
              <Section title="验收标准（最终签署）">
                {criteriaDraft.map((criterion, index) => {
                  const statusColor = criterion.status === 'passed' ? theme.colors.success
                    : criterion.status === 'failed' ? theme.colors.error
                    : criterion.status === 'manual' ? theme.colors.warning
                    : theme.colors.onSurfaceVariant;
                  const updateCriterion = (patch: Partial<GoalAcceptanceCriterionSummary>) => {
                    setCriteriaDraft(draft => draft.map((c, i) => i === index ? { ...c, ...patch } : c));
                  };
                  const toggleCheck = (checkKey: string) => {
                    const current = criterion.mappedCheckKeys;
                    updateCriterion({
                      mappedCheckKeys: current.includes(checkKey)
                        ? current.filter(k => k !== checkKey)
                        : [...current, checkKey],
                    });
                  };
                  return (
                    <View key={criterion.key} style={styles.criterionCard}>
                      {canApprove ? (
                        <TextInput
                          style={[theme.typography.bodyMd, styles.criterionStatement, { color: theme.colors.onSurface, borderColor: theme.colors.outlineVariant }]}
                          value={criterion.statement}
                          onChangeText={text => updateCriterion({ statement: text })}
                          multiline
                          testID={`criterion-statement-${criterion.key}`}
                        />
                      ) : (
                        <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                          {criterion.statement}
                        </Text>
                      )}
                      <View style={styles.criterionMeta}>
                        <Text style={[theme.typography.labelSm, { color: statusColor }]}>
                          {criterion.verification === 'manual' ? '人工签收' : criterion.status}
                        </Text>
                        <Text style={[theme.typography.labelSm, { color: criterion.required ? theme.colors.error : theme.colors.onSurfaceVariant }]}>
                          {criterion.required ? '必需' : '可选'}
                        </Text>
                        {criterion.userAuthored ? (
                          <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>已编辑</Text>
                        ) : null}
                      </View>
                      {criterion.verification === 'auto' && summary?.checks ? (
                        <View style={styles.checkChipRow}>
                          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>映射检查:</Text>
                          {summary.checks.map(check => {
                            const mapped = criterion.mappedCheckKeys.includes(check.key ?? '');
                            return (
                              <TouchableOpacity
                                key={check.id}
                                disabled={!canApprove}
                                onPress={() => check.key && toggleCheck(check.key)}
                                style={[styles.checkChip, {
                                  backgroundColor: mapped ? theme.colors.primary : 'transparent',
                                  borderColor: mapped ? theme.colors.primary : theme.colors.outlineVariant,
                                }]}>
                                <Text style={[theme.typography.labelSm, {
                                  color: mapped ? '#fff' : theme.colors.onSurfaceVariant,
                                }]}>{check.key ?? check.title}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </Section>
            ) : null}
            {activeTab === 'execution' ? (
            <Section title="恢复与历史">
              {events.length ? events.map(event => (
                <View key={event.event_id} style={styles.historyRow}>
                  <View style={[styles.historyDot, { backgroundColor: theme.colors.primary }]} />
                  <View style={styles.rowCopy}>
                    <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                      {eventLabels[event.type] ?? event.type}
                    </Text>
                    <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                      {displayTimestamp(event.created_at)}{event.reason ? ` · ${event.reason}` : ''}
                    </Text>
                  </View>
                </View>
              )) : <EmptySection text="没有额外的恢复记录" />}
            </Section>
            ) : null}
          </>
        )}
      </ScrollView>
      <View style={[styles.actionBar, { backgroundColor: theme.colors.background, borderTopColor: theme.colors.outlineVariant, paddingBottom: Math.max(12, insets.bottom) }]}>
        {actionFeedback ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[theme.typography.bodySm, { color: actionFeedback.includes('失败') ? theme.colors.error : theme.colors.onSurfaceVariant }]}
            numberOfLines={2}>
            {actionFeedback}
          </Text>
        ) : null}
        <GlowButton
          title={actionLabel}
          onPress={runPrimaryAction}
          loading={actionLoading}
          disabled={loading || actionLoading || (summary?.primaryActionKind === 'approve_plan' && !canApprove) || (summary?.primaryActionKind === 'accept_completion' && !canAccept)}
          style={styles.actionButton}
          testID="goal-primary-action"
        />
        {summary?.openFork ? (
          // Phase 6: a fork is open — manage it (enter / merge / abandon).
          // Replaces the bare "分叉重规划" button so the user is never stranded
          // after opening a fork (audit #3). The pivot picker is deferred: the
          // authoritative pivot comes from the fork's ReplanDelta at merge.
          <View style={styles.forkActions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="进入重规划草稿"
              onPress={enterForkSession}
              disabled={actionLoading}
              style={[styles.abandonButton, styles.forkPrimaryAction]}
              testID="goal-fork-enter">
              <Text style={[theme.typography.labelMd, { color: theme.colors.primary }]}>进入草稿</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="合并重规划"
              onPress={performMergeFork}
              disabled={actionLoading}
              style={styles.abandonButton}
              testID="goal-fork-merge">
              <Text style={[theme.typography.labelMd, { color: theme.colors.primary }]}>合并</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="放弃重规划"
              onPress={performAbandonFork}
              disabled={actionLoading}
              style={styles.abandonButton}
              testID="goal-fork-abandon">
              <Text style={[theme.typography.labelMd, { color: theme.colors.warning }]}>放弃</Text>
            </TouchableOpacity>
          </View>
        ) : canFork && !canAccept && !canApprove ? (
          <GlassPanel style={styles.forkSuggestionCard}>
            <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
              {summary?.branchSuggestion?.kind === 'user_input' ? '需要你的决定' : 'AI 建议重新规划'}
            </Text>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurface }]}>
              {summary?.branchSuggestion?.reason ?? '计划可能已偏离目标'}
            </Text>
            <GlowButton
              title={summary?.branchSuggestion?.kind === 'user_input' ? '去回复' : '分叉重规划'}
              onPress={() => {
                const pivotKey = summary?.branchSuggestion?.pivotTaskKey;
                const pivotTask = pivotKey ? summary?.tasks?.find(task => task.key === pivotKey) : undefined;
                performFork(pivotTask?.id);
              }}
              loading={actionLoading}
              disabled={actionLoading}
              style={styles.actionButton}
              testID="goal-fork-action"
            />
          </GlassPanel>
        ) : null}
        {canAccept ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="要求继续调整，拒绝完成"
            onPress={confirmDecline}
            disabled={actionLoading}
            style={styles.abandonButton}
            testID="goal-decline-action">
            <Text style={[theme.typography.labelMd, { color: theme.colors.warning }]}>还需调整</Text>
          </TouchableOpacity>
        ) : null}
        {canDelete ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="删除 Goal"
            onPress={confirmDelete}
            disabled={actionLoading}
            style={styles.abandonButton}
            testID="goal-delete-action">
            <Text style={[theme.typography.labelMd, { color: theme.colors.error }]}>删除 Goal</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  content: {},
  summary: { paddingHorizontal: 16, paddingVertical: 14, gap: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  planningLive: { gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(127,127,127,0.10)' },
  summaryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryCopy: { flex: 1, minWidth: 0, gap: 3 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  section: { paddingHorizontal: 16, paddingTop: 18, gap: 9 },
  sectionBody: { gap: 9 },
  revisionMeta: { gap: 4, paddingBottom: 4 },
  ledgerRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  expandableRow: { gap: 8 },
  detailPanel: { padding: 12, gap: 8 },
  detailBlock: { gap: 2 },
  historyRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  historyDot: { width: 8, height: 8, borderRadius: 4 },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  loadingRow: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 10 },
  errorBanner: { minHeight: 54, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  retryButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  actionButton: { minHeight: 48 },
  abandonButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  forkActions: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  forkPrimaryAction: { flex: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(128,128,128,0.2)', marginBottom: 4 },
  tabItem: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabIndicator: { position: 'absolute', bottom: -1, left: '25%', right: '25%', height: 2, borderRadius: 1 },
  forkSuggestionCard: { paddingVertical: 10, paddingHorizontal: 12, gap: 6 },
  criterionCard: { paddingVertical: 8, gap: 4 },
  criterionStatement: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, minHeight: 36 },
  criterionMeta: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  checkChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  checkChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
});
