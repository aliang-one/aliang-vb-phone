import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../shared/BottomSheet';
import { GlowButton } from '../shared/GlowButton';
import { IconBadge } from '../visual/IconBadge';
import { useTheme } from '../../theme/useTheme';
import type { ServerGoalSnapshot } from '../../api/goals';

type ActiveGoal = ServerGoalSnapshot & { ai_session_id: string };

type GoalCreateSheetProps = {
  open: boolean;
  projectPath?: string;
  objective: string;
  activeGoal?: ActiveGoal;
  syncing: boolean;
  creating: boolean;
  error?: string;
  onClose: () => void;
  onObjectiveChange: (value: string) => void;
  onCreate: () => void;
  onOpenActive: (goal: ActiveGoal) => void;
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
  completed: '已完成',
};

export const GoalCreateSheet: React.FC<GoalCreateSheetProps> = ({
  open,
  projectPath,
  objective,
  activeGoal,
  syncing,
  creating,
  error,
  onClose,
  onObjectiveChange,
  onCreate,
  onOpenActive,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const completed = activeGoal?.completed_tasks ?? 0;
  const total = activeGoal?.total_tasks ?? 0;
  const progress = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('goalCreate.title')}
      subtitle={projectPath || t('goalCreate.subtitle')}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoider}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          {syncing ? (
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              {t('goalCreate.loading')}
            </Text>
          ) : null}

          {activeGoal ? (
            <TouchableOpacity
              testID="goal-open-active"
              accessibilityRole="button"
              accessibilityLabel={t('goalCreate.openActive')}
              activeOpacity={0.75}
              onPress={() => onOpenActive(activeGoal)}
              style={[
                styles.activeGoal,
                {
                  borderColor: theme.colors.primary,
                  backgroundColor: isDark
                    ? `${theme.colors.primary}12`
                    : theme.colors.surfaceContainerLow,
                },
              ]}>
              <IconBadge name="goal" tone="primary" size={36} iconSize={18} />
              <View style={styles.activeCopy}>
                <View style={styles.titleRow}>
                  <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
                    {t('goalCreate.activeTitle')}
                  </Text>
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    {stateLabels[activeGoal.state] ?? activeGoal.state}
                  </Text>
                </View>
                <Text
                  style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}
                  numberOfLines={2}>
                  {activeGoal.objective || activeGoal.goal_id}
                </Text>
                <View style={styles.progressRow}>
                  <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                    {total > 0
                      ? t('goalCreate.progress', { completed, total })
                      : activeGoal.current_task ?? stateLabels[activeGoal.state] ?? activeGoal.state}
                  </Text>
                  <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
                    {t('goalCreate.openActive')}
                  </Text>
                </View>
                {total > 0 ? (
                  <View style={[styles.track, { backgroundColor: theme.colors.outlineVariant }]}>
                    <View
                      style={[
                        styles.fill,
                        { width: `${progress * 100}%`, backgroundColor: theme.colors.primary },
                      ]}
                    />
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          ) : null}

          <View style={styles.createSection}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              {t('goalCreate.newTitle')}
            </Text>
            <TextInput
              testID="goal-objective-input"
              value={objective}
              onChangeText={onObjectiveChange}
              editable={!creating}
              autoFocus
              multiline
              maxLength={2000}
              placeholder={t('goalCreate.placeholder')}
              placeholderTextColor={theme.colors.onSurfaceVariant}
              style={[
                theme.typography.bodyMd,
                styles.input,
                {
                  color: theme.colors.onSurface,
                  borderColor: error ? theme.colors.error : theme.colors.outlineVariant,
                  backgroundColor: isDark
                    ? 'rgba(255,255,255,0.04)'
                    : theme.colors.surfaceContainerLow,
                },
              ]}
            />
            {error ? (
              <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
                {error}
              </Text>
            ) : null}
            <GlowButton
              testID="goal-create-submit"
              title={creating ? t('goalCreate.creating') : t('goalCreate.create')}
              onPress={onCreate}
              loading={creating}
              disabled={!objective.trim() || creating}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  keyboardAvoider: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, gap: 18 },
  activeGoal: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 12,
  },
  activeCopy: { flex: 1, minWidth: 0, gap: 5 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%' },
  createSection: { gap: 10 },
  input: {
    minHeight: 112,
    maxHeight: 200,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    textAlignVertical: 'top',
  },
});
