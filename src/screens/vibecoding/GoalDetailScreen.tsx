import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
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
import { IconBadge } from '../../components/visual/IconBadge';
import type { RootStackParamList } from '../../app/navigation/types';
import { useVibeRun } from '../../store/controlCenterStore';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { createId } from '../../store/internals';
import type { GoalSummary } from '../../data/platformModels';
import {
  approveGoalPlan,
  deleteGoal,
  fetchGoalEvents,
  fetchGoalSnapshot,
  goalSnapshotToSummary,
  newerGoalSummary,
} from '../../api/goals';
import type { GoalEventSnapshot } from '../../api/goals';

type GoalDetailRoute = RouteProp<RootStackParamList, 'GoalDetail'>;
type GoalDetailNavigation = NativeStackNavigationProp<RootStackParamList>;

const stateLabels: Record<string, string> = {
  planning: '规划中',
  planning_failed: '规划需处理',
  awaiting_approval: '等待确认',
  active: '执行中',
  approval_pending: '等待审批',
  pause_requested: '等待本轮结束',
  verifying: '验证中',
  paused: '已暂停',
  blocked: '需要处理',
  budget_limited: '预算受限',
  cancel_requested: '正在停止',
  abandoned: '已放弃',
  cancelled: '已取消',
  completed: '已完成',
};

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

const displayTimestamp = (value?: string): string | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const toneForState = (state?: string): 'primary' | 'success' | 'warning' | 'error' | 'neutral' => {
  if (state === 'completed') return 'success';
  if (state === 'blocked' || state === 'planning_failed' || state === 'budget_limited') return 'error';
  if (state === 'awaiting_approval') return 'warning';
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

const GoalSummaryHeader: React.FC<{ summary?: GoalSummary }> = ({ summary }) => {
  const { theme } = useTheme();
  const completed = summary?.completedTasks;
  const total = summary?.totalTasks;
  const hasProgress = typeof completed === 'number' && typeof total === 'number' && total > 0;
  const progress = hasProgress ? Math.min(1, Math.max(0, completed! / total!)) : 0;
  const label = summary ? stateLabels[summary.state] ?? summary.state : '同步中';

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
        <Text style={[theme.typography.bodyMd, { color: theme.colors.error }]}>{summary.attention}</Text>
      ) : null}
    </View>
  );
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
  const canApprove = summary?.primaryActionKind === 'approve_plan' &&
    summary.state === 'awaiting_approval' &&
    Boolean(summary.revision?.id) &&
    typeof summary.stateVersion === 'number';
  const actionLabel = canApprove ? (summary?.primaryActionLabel ?? '确认计划') : '刷新状态';
  const canDelete = Boolean(
    summary &&
    typeof summary.stateVersion === 'number',
  );

  useEffect(() => {
    if (!session?.goalSummary) return;
    setSummary(current => newerGoalSummary(current, session.goalSummary!));
  }, [session?.goalSummary]);

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

  const runPrimaryAction = useCallback(async () => {
    if (!summary) {
      await refreshGoal();
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
  }, [canApprove, loadAgentSessionDetail, refreshGoal, route.params.sourceSessionId, summary]);

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
        subtitle={summary ? stateLabels[summary.state] ?? summary.state : '同步中'}
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
            <Section title="当前运行">
              <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                {summary.currentRunHealth ?? '运行健康度尚未同步'}
              </Text>
              <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                {summary.updatedAt ? `最近更新：${displayTimestamp(summary.updatedAt)}` : '等待下一次权威快照'}
              </Text>
            </Section>
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
                summary.tasks.map((task, index) => (
                  <View key={task.id} style={styles.ledgerRow}>
                    <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>{index + 1}</Text>
                    <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]} numberOfLines={2}>{task.title}</Text>
                    <Text style={[theme.typography.labelSm, { color: task.isCurrent ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
                      {taskStateLabels[task.status ?? ''] ?? (task.isCurrent ? '当前' : '待处理')}{task.failureAttempt ? ` · ${task.failureAttempt} 次失败` : ''}
                    </Text>
                  </View>
                ))
              ) : <EmptySection text="任务列表尚未同步" />}
            </Section>
            <Section title="检查">
              {summary.checks?.length ? (
                summary.checks.map(check => (
                  <View key={check.id} style={styles.ledgerRow}>
                    <IconBadge name={check.status === 'passed' ? 'check' : 'warning'} tone={check.status === 'passed' ? 'success' : 'warning'} size={28} iconSize={14} />
                    <View style={styles.rowCopy}>
                      <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>{check.title}</Text>
                      <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>{checkStateLabels[check.status ?? ''] ?? check.status ?? '等待检查'}{check.detail ? ` · ${check.detail}` : ''}</Text>
                    </View>
                  </View>
                ))
              ) : <EmptySection text="检查结果尚未同步" />}
            </Section>
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
          disabled={loading || actionLoading || (summary?.primaryActionKind === 'approve_plan' && !canApprove)}
          style={styles.actionButton}
          testID="goal-primary-action"
        />
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
  summaryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryCopy: { flex: 1, minWidth: 0, gap: 3 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  section: { paddingHorizontal: 16, paddingTop: 18, gap: 9 },
  sectionBody: { gap: 9 },
  revisionMeta: { gap: 4, paddingBottom: 4 },
  ledgerRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  historyRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  historyDot: { width: 8, height: 8, borderRadius: 4 },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  loadingRow: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 10 },
  errorBanner: { minHeight: 54, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  retryButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  actionButton: { minHeight: 48 },
  abandonButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
