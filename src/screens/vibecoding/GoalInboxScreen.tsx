import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import type { ServerGoalSnapshot } from '../../api/goals';
import { goalStateLabel } from '../../utils/goalStatePresentation';
import { formatActivityLabel } from '../../store/internals';
import type { RootStackParamList } from '../../app/navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const TERMINAL_GOAL_STATES = new Set(['completed', 'cancelled', 'abandoned']);

export type GoalRow = ServerGoalSnapshot & {
  deviceId: string;
  deviceName: string;
};

const isActive = (row: GoalRow): boolean =>
  !TERMINAL_GOAL_STATES.has(String(row.state));

/** 非终态在前；组内按最近更新降序；deleted 的丢弃。纯函数便于测试。 */
export function organizeGoalRows(rows: GoalRow[]): GoalRow[] {
  return rows
    .filter(row => !row.deleted_at)
    .sort((left, right) => {
      const leftActive = isActive(left) ? 0 : 1;
      const rightActive = isActive(right) ? 0 : 1;
      if (leftActive !== rightActive) return leftActive - rightActive;
      return (right.updated_at ?? '').localeCompare(left.updated_at ?? '');
    });
}

interface GoalInboxPanelProps {
  rows: GoalRow[];
  loading: boolean;
  error?: string;
  partialError?: string;
}

/**
 * Tasks 段内容：Goal 专属列表(进行中/待审批/待验收/阻塞在前，历史在后)。
 * 展示组件——数据由 VibeCodingListScreen 拉取(/api/goals, per-device)，
 * 点击进入 GoalDetailScreen，审批/暂停/恢复/验收均沿用既有 Goal 通道。
 */
export const GoalInboxPanel: React.FC<GoalInboxPanelProps> = ({
  rows,
  loading,
  error,
  partialError,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation('common');
  const navigation = useNavigation<Navigation>();

  const activeRows = rows.filter(isActive);
  const historyRows = rows.filter(row => !isActive(row));

  const renderRow = (row: GoalRow) => (
    <Pressable
      key={`${row.deviceId}:${row.goal_id}`}
      accessibilityRole="button"
      onPress={() =>
        navigation.navigate('GoalDetail', { goalId: row.goal_id })
      }
      style={[
        styles.row,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.outlineVariant,
        },
      ]}
    >
      <View style={styles.rowHead}>
        <Text
          numberOfLines={2}
          style={[
            theme.typography.bodyMd,
            { color: theme.colors.onSurface, flex: 1 },
          ]}
        >
          {row.objective || row.goal_id}
        </Text>
        <Text
          style={[
            styles.stateChip,
            { color: theme.colors.primary, borderColor: theme.colors.primary },
          ]}
        >
          {goalStateLabel(row.state)}
        </Text>
      </View>
      {typeof row.completed_tasks === 'number' &&
      typeof row.total_tasks === 'number' ? (
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
          ]}
        >
          {row.completed_tasks}/{row.total_tasks} tasks
        </Text>
      ) : null}
      {row.current_task ? (
        <Text
          numberOfLines={1}
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
          ]}
        >
          {row.current_task}
        </Text>
      ) : null}
      {row.primary_action_label ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.primary }]}>
          {row.primary_action_label}
        </Text>
      ) : null}
      <Text
        style={[
          theme.typography.labelSm,
          { color: theme.colors.onSurfaceVariant },
        ]}
      >
        {row.deviceName}
        {row.updated_at
          ? ` · ${formatActivityLabel(Date.parse(row.updated_at) || 0)}`
          : ''}
      </Text>
    </Pressable>
  );

  const sectionTitle = (text: string, count: number) => (
    <Text
      style={[
        theme.typography.labelCaps,
        { color: theme.colors.onSurfaceVariant },
        styles.section,
      ]}
    >
      {text} · {count}
    </Text>
  );

  return (
    <View style={styles.container}>
      {loading && rows.length === 0 ? (
        <ActivityIndicator color={theme.colors.primary} style={styles.center} />
      ) : error ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
          {error}
        </Text>
      ) : partialError ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
          {partialError}
        </Text>
      ) : rows.length === 0 ? (
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
            styles.center,
          ]}
        >
          {t('goalInbox.empty', 'No tasks yet')}
        </Text>
      ) : (
        <>
          {sectionTitle('ACTIVE', activeRows.length)}
          {activeRows.map(renderRow)}
          {historyRows.length > 0
            ? sectionTitle('HISTORY', historyRows.length)
            : null}
          {historyRows.map(renderRow)}
        </>
      )}
      {loading && rows.length > 0 ? (
        <ActivityIndicator color={theme.colors.primary} style={styles.center} />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  center: {
    marginVertical: 24,
  },
  section: {
    marginTop: 8,
  },
  row: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
    padding: 14,
  },
  rowHead: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
  },
  stateChip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 12,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
