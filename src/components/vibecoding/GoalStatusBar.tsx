import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { IconBadge } from '../visual/IconBadge';
import type { GoalSummary } from '../../data/platformModels';

type GoalStatusBarProps = {
  summary?: GoalSummary;
  onPress: () => void;
};

const stateLabels: Record<string, string> = {
  planning: '规划中',
  planning_failed: '规划需处理',
  awaiting_approval: '等待确认',
  active: '执行中',
  verifying: '验证中',
  paused: '已暂停',
  blocked: '需要处理',
  budget_limited: '预算受限',
  cancel_requested: '正在停止',
  abandoned: '已放弃',
  cancelled: '已取消',
  completed: '已完成',
};

const toneForState = (state?: string): 'primary' | 'success' | 'warning' | 'error' | 'neutral' => {
  switch (state) {
    case 'completed':
      return 'success';
    case 'blocked':
    case 'planning_failed':
    case 'budget_limited':
      return 'error';
    case 'awaiting_approval':
      return 'warning';
    case 'paused':
    case 'cancelled':
    case 'abandoned':
      return 'neutral';
    default:
      return 'primary';
  }
};

export const GoalStatusBar: React.FC<GoalStatusBarProps> = ({ summary, onPress }) => {
  const { theme } = useTheme();
  const state = summary?.state;
  const completed = summary?.completedTasks;
  const total = summary?.totalTasks;
  const hasProgress =
    typeof completed === 'number' &&
    Number.isFinite(completed) &&
    typeof total === 'number' &&
    Number.isFinite(total) &&
    total > 0;
  const progress = hasProgress
    ? Math.min(1, Math.max(0, completed! / total!))
    : undefined;
  const label = state ? stateLabels[state] ?? state : '同步中';
  const hasAttention = Boolean(summary?.attention) || state === 'blocked';

  return (
    <TouchableOpacity
      testID="goal-status-bar"
      accessibilityRole="button"
      accessibilityLabel={`Goal，${label}${hasProgress ? `，已完成 ${completed}/${total}` : ''}`}
      activeOpacity={0.78}
      onPress={onPress}
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surfaceContainerLow,
          borderColor: theme.colors.outlineVariant,
        },
      ]}>
      <IconBadge name="goal" tone={toneForState(state)} size={32} iconSize={16} />
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>GOAL</Text>
          <Text style={[theme.typography.labelMd, { color: theme.colors.onSurface }]} numberOfLines={1}>
            {label}
          </Text>
          {hasAttention ? <View style={[styles.attentionDot, { backgroundColor: theme.colors.error }]} /> : null}
        </View>
        <View style={styles.metaRow}>
          {hasProgress ? (
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
              {completed}/{total} 个任务
            </Text>
          ) : (
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
              {summary?.currentTask ?? '正在获取 Goal 状态'}
            </Text>
          )}
          {summary?.currentRunHealth ? (
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
              {summary.currentRunHealth}
            </Text>
          ) : null}
        </View>
        {progress !== undefined ? (
          <View style={[styles.track, { backgroundColor: theme.colors.outlineVariant }]}>
            <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: theme.colors.primary }]} />
          </View>
        ) : null}
      </View>
      <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>查看</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  attentionDot: { width: 6, height: 6, borderRadius: 3 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  fill: { height: 3, borderRadius: 2 },
});
