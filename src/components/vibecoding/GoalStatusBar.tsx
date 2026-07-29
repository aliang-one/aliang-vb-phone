import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { IconBadge } from '../visual/IconBadge';
import type { GoalSummary } from '../../data/platformModels';
import { goalStateLabel, goalToneForState } from '../../utils/goalStatePresentation';

type GoalStatusBarProps = {
  summary?: GoalSummary;
  onView: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRecover?: () => void;
  onAccept?: () => void;
  onDelete?: () => void;
  onMore?: () => void;
  actionLoading?: 'pause' | 'resume' | 'recover' | 'accept' | 'delete';
};

const GoalAction: React.FC<{
  label: string;
  testID: string;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}> = ({ label, testID, onPress, disabled, destructive }) => {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={0.65}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={styles.actionButton}>
      <Text
        style={[
          theme.typography.labelSm,
          {
            color: destructive ? theme.colors.error : theme.colors.primary,
            opacity: disabled || !onPress ? 0.45 : 1,
          },
        ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

export const GoalStatusBar: React.FC<GoalStatusBarProps> = ({
  summary,
  onView,
  onPause,
  onResume,
  onRecover,
  onAccept,
  onDelete,
  onMore,
  actionLoading,
}) => {
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
  const label = goalStateLabel(state);
  const hasAttention = Boolean(summary?.attention) || state === 'blocked';
  const pausePending = state === 'pause_requested';
  const paused = state === 'paused';
  const canPause = ['active', 'approval_pending', 'verifying'].includes(state ?? '');

  return (
    <View
      testID="goal-status-bar"
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surfaceContainerLow,
          borderColor: theme.colors.outlineVariant,
        },
      ]}>
      <View style={styles.topRow}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`查看 Goal，${label}${hasProgress ? `，已完成 ${completed}/${total}` : ''}`}
          activeOpacity={0.72}
          onPress={onView}
          style={styles.summaryButton}>
          <IconBadge name="goal" tone={goalToneForState(state)} size={30} iconSize={15} />
          <View style={styles.titleRow}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>GOAL</Text>
            <Text style={[theme.typography.labelMd, { color: theme.colors.onSurface }]} numberOfLines={1}>
              {label}
            </Text>
            {hasAttention ? <View style={[styles.attentionDot, { backgroundColor: theme.colors.error }]} /> : null}
          </View>
        </TouchableOpacity>
        <View style={styles.actions}>
          <GoalAction label="查看" testID="goal-action-view" onPress={onView} />
          {paused ? (
            <GoalAction
              label={actionLoading === 'resume' ? '继续中' : '继续'}
              testID="goal-action-resume"
              onPress={onResume}
              disabled={Boolean(actionLoading)}
            />
          ) : canPause || pausePending ? (
            <GoalAction
              label={pausePending || actionLoading === 'pause' ? '暂停中' : '暂停'}
              testID="goal-action-pause"
              onPress={onPause}
              disabled={pausePending || Boolean(actionLoading)}
            />
          ) : null}
          {summary?.primaryActionKind === 'accept_completion' && state === 'awaiting_user_acceptance' ? (
            <GoalAction
              label={actionLoading === 'accept' ? '确认中' : '确认完成'}
              testID="goal-action-accept"
              onPress={onAccept}
              disabled={Boolean(actionLoading)}
            />
          ) : null}
          {summary?.recoverable ? (
            <GoalAction
              label={
                actionLoading === 'recover'
                  ? '恢复中'
                  : summary.primaryActionLabel ?? '继续'
              }
              testID="goal-action-recover"
              onPress={onRecover}
              disabled={Boolean(actionLoading)}
            />
          ) : null}
          <GoalAction
            label={actionLoading === 'delete' ? '删除中' : '删除'}
            testID="goal-action-delete"
            onPress={onDelete}
            disabled={Boolean(actionLoading)}
            destructive
          />
          <GoalAction label="更多" testID="goal-action-more" onPress={onMore} />
        </View>
      </View>
      <View style={styles.copy}>
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
    </View>
  );
};

export const GoalDraftBar: React.FC<{
  creating?: boolean;
  onExit: () => void;
}> = ({ creating = false, onExit }) => {
  const { theme } = useTheme();
  // Draft 阶段只显示静态提示，不实时回显输入框内容。
  // 用户的输入在 composer 里已经可见， Goal 真正的内容在发送成功后由
  // GoalStatusBar (session.purpose==='goal') 承接显示，避免 draft 时上方
  // 出现逐字 echo 造成「发送前就显示」的错觉。
  return (
    <View
      testID="goal-draft-bar"
      style={[
        styles.draftContainer,
        {
          backgroundColor: theme.colors.surfaceContainerLow,
          borderColor: theme.colors.primary,
        },
      ]}>
      <IconBadge name="goal" tone="primary" size={28} iconSize={14} />
      <View style={styles.draftCopy}>
        <Text style={[theme.typography.labelMd, { color: theme.colors.onSurface }]}>Goal</Text>
        <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
          {creating ? '正在创建 Goal' : '正在编辑 Goal'}
        </Text>
      </View>
      <TouchableOpacity
        testID="goal-draft-exit"
        accessibilityRole="button"
        accessibilityLabel="退出 Goal 输入"
        disabled={creating}
        onPress={onExit}
        style={styles.actionButton}>
        <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant, opacity: creating ? 0.45 : 1 }]}>退出</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    minHeight: 56,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 5,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryButton: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  actions: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  actionButton: { minHeight: 28, minWidth: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  copy: { minWidth: 0, gap: 2, paddingLeft: 37 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  attentionDot: { width: 6, height: 6, borderRadius: 3 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  fill: { height: 3, borderRadius: 2 },
  draftContainer: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  draftCopy: { flex: 1, minWidth: 0 },
});
