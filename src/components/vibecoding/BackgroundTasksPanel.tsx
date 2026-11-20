import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import type { StructuredActivityEvent } from '../../data/platformModels';
import { IconBadge } from '../visual/IconBadge';
import { SubagentDrawer } from './SubagentDrawer';

// 右侧滑出「后台任务」面板：聚合本会话全部子 agent（含排队/运行/终态）的
// 实时状态。动画结构与 DiagnosticsPanel 同族（shared value + withTiming，
// 关闭动画走完再卸载）。行点击 → 复用 SubagentDrawer 查看单个任务的工具
// 轨迹与结果全文——重字段按需拉取的通道已有，不在这里重复。
const SCREEN_WIDTH = Dimensions.get('window').width;
const OPEN_MS = 300;
const CLOSE_MS = 240;

export type SubagentTaskEvent = Extract<
  StructuredActivityEvent,
  { kind: 'subagent' }
>;

const ACTIVE_PHASES = new Set<string>(['queued', 'started', 'progress']);

interface BackgroundTasksPanelProps {
  /** Drives the slide animation; closing animates out before unmount. */
  open: boolean;
  onClose: () => void;
  sessionId: string;
  /** 会话全部 subagent 结构化事件（调用方过滤好，含活跃与终态）。 */
  events: SubagentTaskEvent[];
}

export const BackgroundTasksPanel: React.FC<BackgroundTasksPanelProps> = ({
  open,
  onClose,
  sessionId,
  events,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const insets = useSafeAreaInsets();
  const translateX = useSharedValue(SCREEN_WIDTH);
  const backdropOpacity = useSharedValue(0);
  const [mounted, setMounted] = useState(open);
  // 行点击 → 单任务详情抽屉（task_id 存选中态，event 由 events 找回，与
  // ActivityBlock.SubagentRows 同款内聚手法）。
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (open && !mounted) {
      setMounted(true);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    if (open) {
      translateX.value = SCREEN_WIDTH;
      translateX.value = withTiming(0, {
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
      });
      backdropOpacity.value = withTiming(1, { duration: OPEN_MS });
      return;
    }
    translateX.value = withTiming(SCREEN_WIDTH, {
      duration: CLOSE_MS,
      easing: Easing.in(Easing.cubic),
    });
    backdropOpacity.value = withTiming(0, { duration: CLOSE_MS });
    const timer = setTimeout(() => setMounted(false), CLOSE_MS + 16);
    return () => clearTimeout(timer);
  }, [mounted, open, translateX, backdropOpacity]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  // 活跃在前（保持事件到达序），终态殿后——打开即先看到正在跑/排队的。
  const orderedEvents = useMemo(() => {
    const active: SubagentTaskEvent[] = [];
    const settled: SubagentTaskEvent[] = [];
    for (const event of events) {
      (ACTIVE_PHASES.has(event.phase) ? active : settled).push(event);
    }
    return [...active, ...settled];
  }, [events]);

  const activeCount = useMemo(
    () => events.filter(event => ACTIVE_PHASES.has(event.phase)).length,
    [events],
  );

  if (!mounted) {
    return null;
  }

  const openEvent = events.find(event => event.taskId === openTaskId);
  const drawerEvent = openEvent ? { ...openEvent, sessionId } : null;
  const divider = isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant;
  const subtitle = events.length
    ? t('session.backgroundTasks.countSummary', {
        active: activeCount,
        total: events.length,
      })
    : t('session.backgroundTasks.empty');

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              backdropStyle,
              { backgroundColor: 'rgba(0,0,0,0.45)' },
            ]}
          />
        </Pressable>
        <Animated.View
          style={[
            styles.panel,
            {
              backgroundColor: isDark
                ? theme.colors.surfaceContainerHigh
                : theme.colors.surfaceContainerLowest,
              paddingTop: insets.top + 8,
              paddingBottom: insets.bottom + 12,
            },
            panelStyle,
          ]}>
          <View style={[styles.header, { borderBottomColor: divider }]}>
            <IconBadge name="agent" tone={activeCount > 0 ? 'primary' : 'neutral'} size={36} iconSize={18} />
            <View style={styles.headerCopy}>
              <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                {t('session.backgroundTasks.title')}
              </Text>
              <Text
                numberOfLines={1}
                style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                {subtitle}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('common:close')}>
              <IconBadge name="close" tone="neutral" size={32} iconSize={16} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {orderedEvents.length === 0 ? (
              <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurfaceVariant }]}>
                {t('session.backgroundTasks.empty')}
              </Text>
            ) : (
              orderedEvents.map(event => (
                <TaskRow
                  key={event.eventId}
                  event={event}
                  onPress={() => setOpenTaskId(event.taskId)}
                />
              ))
            )}
          </ScrollView>
        </Animated.View>
      </View>
      {/* 单任务详情抽屉：Nested Modal 在 RN 可用，DiagnosticsPanel/SubagentDrawer
          已有同款叠加先例（面板 Modal 之上再开详情 Modal）。 */}
      <SubagentDrawer
        open={drawerEvent !== null}
        event={drawerEvent}
        onClose={() => setOpenTaskId(null)}
      />
    </Modal>
  );
};

const TaskRow: React.FC<{
  event: SubagentTaskEvent;
  onPress: () => void;
}> = ({ event, onPress }) => {
  const { theme } = useTheme();
  const { t } = useTranslation('vibecoding');
  const running = event.phase === 'started' || event.phase === 'progress';
  const queued = event.phase === 'queued';
  // duration_ms 只在终态行显示（progress 帧上的语义未经证实，与
  // ActivityBlock.SubagentRows 同一口径）。
  const seconds =
    !running && event.durationMs !== undefined
      ? Math.max(0, Math.round(event.durationMs / 1000))
      : undefined;
  const detail = [
    event.currentStep,
    event.lastTool,
    event.toolUses !== undefined && event.toolUses > 0
      ? t('activity.subagentToolUses', { count: event.toolUses })
      : undefined,
    seconds === undefined ? undefined : t('activity.subagentDuration', { seconds }),
  ]
    .filter(Boolean)
    .join(' · ');
  const mark =
    running || queued
      ? ''
      : event.phase === 'completed'
        ? '✓ '
        : event.phase === 'failed'
          ? '✗ '
          : '⊘ ';
  const nameColor =
    event.phase === 'failed' ? theme.colors.error : theme.colors.onSurface;
  const phaseLabel = t(
    `activity.subagent${event.phase[0].toUpperCase()}${event.phase.slice(1)}`,
  );

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.taskRow, pressed && styles.taskRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${event.description ?? event.subagentType ?? event.taskId} ${phaseLabel}`}>
      <View style={styles.taskRowMain}>
        {running && !queued ? (
          <ActivityIndicator
            size="small"
            color={theme.colors.primary}
            style={styles.taskSpinner}
          />
        ) : null}
        <View style={styles.taskCopy}>
          <Text style={[theme.typography.bodyMd, { color: nameColor }]} numberOfLines={2}>
            {mark}
            {event.description ?? event.subagentType ?? event.taskId}
            {running || queued ? ` · ${phaseLabel}` : ''}
          </Text>
          {detail ? (
            <Text
              style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }, styles.taskSub]}
              numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
          {event.summary ? (
            <Text
              style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }, styles.taskSub]}
              numberOfLines={2}>
              {event.summary}
            </Text>
          ) : null}
        </View>
        <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>›</Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  panel: {
    width: '92%',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(128,128,128,0.25)',
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 14,
    gap: 10,
  },
  taskRow: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.22)',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  taskRowPressed: {
    opacity: 0.72,
  },
  taskRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  taskSpinner: {
    marginLeft: -2,
  },
  taskCopy: {
    flex: 1,
    gap: 3,
  },
  taskSub: {
    opacity: 0.85,
  },
});
