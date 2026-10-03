import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { fetchGoals, type ServerGoalSnapshot } from '../../api/goals';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { goalStateLabel } from '../../utils/goalStatePresentation';
import { formatActivityLabel } from '../../store/internals';
import type { RootStackParamList } from '../../app/navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const TERMINAL_GOAL_STATES = new Set(['completed', 'cancelled', 'abandoned']);

type GoalRow = ServerGoalSnapshot & {
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

/**
 * Tasks 入口：Goal 专属列表(进行中/待审批/待验收/阻塞在前，历史在后)。
 * 数据走 /api/goals(per-device)，与普通对话列表(vibe 列表已过滤 purpose=
 * 'goal')完全解耦；点击进入 GoalDetailScreen，审批/暂停/恢复/验收均沿用
 * 既有 Goal 通道。
 */
export const GoalInboxPanel: React.FC<{ reloadKey?: number }> = ({
  reloadKey = 0,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation('common');
  const navigation = useNavigation<Navigation>();
  const devices = useControlCenterStore(state => state.devices);
  const [rows, setRows] = useState<GoalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // 部分设备同步失败:保留成功设备的任务,但必须可见,不能伪装成"没有任务"。
  const [partialError, setPartialError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (devices.length === 0) {
      setRows([]);
      setPartialError(undefined);
      return;
    }
    setLoading(true);
    setError(undefined);
    setPartialError(undefined);
    try {
      const settled = await Promise.allSettled(
        devices.map(device => fetchGoals({ deviceId: device.id })),
      );
      const next: GoalRow[] = [];
      let failed = 0;
      settled.forEach((result, index) => {
        const device = devices[index];
        if (result.status === 'rejected') {
          failed += 1;
          return;
        }
        for (const goal of result.value) {
          next.push({ ...goal, deviceId: device.id, deviceName: device.name });
        }
      });
      // 全部失败 = 明确报错(不能伪装成"没有任务");部分失败 = 保留成功
      // 设备的任务 + 醒目提示。
      if (failed > 0 && failed === settled.length) {
        setRows([]);
        setError(
          t('goalInbox.syncFailed', 'Failed to sync tasks. Pull to retry.'),
        );
        return;
      }
      setRows(organizeGoalRows(next));
      if (failed > 0) {
        setPartialError(
          t('goalInbox.partialSync', {
            count: failed,
            defaultValue: `${failed} device(s) failed to sync; their tasks may be missing`,
          }),
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [devices, t]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const activeRows = useMemo(() => rows.filter(isActive), [rows]);
  const historyRows = useMemo(() => rows.filter(row => !isActive(row)), [rows]);

  const renderRow = (row: GoalRow) => (
    <Pressable
      key={`${row.deviceId}:${row.goal_id}`}
      accessibilityRole="button"
      onPress={() =>
        navigation.navigate('GoalDetail', { goalId: row.goal_id })
      }
      style={[
        styles.row,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant },
      ]}
    >
      <View style={styles.rowHead}>
        <Text
          numberOfLines={2}
          style={[theme.typography.bodyMd, { color: theme.colors.onSurface, flex: 1 }]}
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
      {typeof row.completed_tasks === 'number' && typeof row.total_tasks === 'number' ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
          {row.completed_tasks}/{row.total_tasks} tasks
        </Text>
      ) : null}
      {row.current_task ? (
        <Text
          numberOfLines={1}
          style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
        >
          {row.current_task}
        </Text>
      ) : null}
      {row.primary_action_label ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.primary }]}>
          {row.primary_action_label}
        </Text>
      ) : null}
      <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
        {row.deviceName}
        {row.updated_at
          ? ` · ${formatActivityLabel(Date.parse(row.updated_at) || 0)}`
          : ''}
      </Text>
    </Pressable>
  );

  const sectionTitle = (text: string, count: number) => (
    <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }, styles.section]}>
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
        <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }, styles.center]}>
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
