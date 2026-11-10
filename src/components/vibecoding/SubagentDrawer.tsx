import React, { useEffect, useState } from 'react';
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
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import {
  fetchStructuredEventDetail,
  type SubagentDetailTools,
} from '../../api/sessions';
import type { StructuredActivityEvent } from '../../data/platformModels';

// 右侧滑入抽屉（2026-11-10 子 agent 对话查看，对齐 aliangcode 网页面板的信息
// 结构：状态徽标 + 工具轨迹 + 结果全文）。宽 92%、全高、dimmed scrim；点击
// 遮罩 / 关闭按钮 / 硬件返回键收起。重字段（tools 轨迹 + result 全文）打开时
// 经 fetchStructuredEventDetail('synth:<task_id>') 按需拉——synth 事件不在
// 结构化缓存里，PhoneServer 详情端点按 task_id 从 subagents 镜像现取。
const SCREEN_WIDTH = Dimensions.get('window').width;
const OPEN_MS = 280;
const CLOSE_MS = 220;

interface SubagentDrawerProps {
  open: boolean;
  event: (Extract<StructuredActivityEvent, { kind: 'subagent' }> & { sessionId: string }) | null;
  onClose: () => void;
}

type Loaded = {
  text?: string;
  truncated?: boolean;
  tools?: SubagentDetailTools;
};

export const SubagentDrawer: React.FC<SubagentDrawerProps> = ({ open, event, onClose }) => {
  const { theme } = useTheme();
  const { t } = useTranslation('vibecoding');
  const insets = useSafeAreaInsets();
  const tx = useSharedValue(SCREEN_WIDTH);
  const [loaded, setLoaded] = useState<Loaded>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // 打开/关闭驱动滑入滑出动画；收起动画走完再真正卸载（unmount 由父层
  // visible=false + 300ms 延迟兜底——与 BottomSheet 的 CLOSE_MS 同款纪律，
  // 避免动画被卸载掐断闪烁）。
  useEffect(() => {
    tx.value = withTiming(open ? 0 : SCREEN_WIDTH, {
      duration: open ? OPEN_MS : CLOSE_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [open, tx]);

  // 打开时按需拉重字段（result 全文 + tools 轨迹）。event 为 null（已关闭）
  // 不拉；同 task_id 重开复用上一次结果（React state 随 event 切换重置）。
  useEffect(() => {
    if (!open || !event) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    fetchStructuredEventDetail(event.sessionId, `synth:${event.taskId}`)
      .then(r => {
        if (!cancelled) setLoaded({ text: r.text, truncated: r.truncated, tools: r.tools });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, event]);

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  if (!event) return null;
  const running = event.phase === 'started' || event.phase === 'progress';
  const seconds = !running && event.durationMs !== undefined
    ? Math.max(0, Math.round(event.durationMs / 1000))
    : undefined;
  const phaseLabel = t(`activity.subagent${event.phase[0].toUpperCase()}${event.phase.slice(1)}`);
  const phaseColor = event.phase === 'failed'
    ? theme.colors.error
    : event.phase === 'completed'
      ? theme.colors.primary
      : theme.colors.onSurfaceVariant;
  const title = event.description ?? event.subagentType ?? event.taskId;

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} />
        <Animated.View
          style={[
            styles.panel,
            {
              backgroundColor: theme.colors.surface,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
            },
            panelStyle,
          ]}
        >
          {/* 头部：标题 + 关闭 */}
          <View style={styles.header}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]} numberOfLines={2}>
                {title}
              </Text>
              <Text style={[theme.typography.labelSm, { color: phaseColor, marginTop: 2 }]}>
                {running ? `● ${phaseLabel}` : phaseLabel}
                {seconds !== undefined ? ` · ${t('activity.subagentDuration', { seconds })}` : ''}
                {event.totalTokens ? ` · ${t('activity.subagentTokens', { count: event.totalTokens })}` : ''}
              </Text>
            </View>
            <Pressable hitSlop={12} onPress={onClose} accessibilityLabel={t('common:close')}>
              <Text style={[theme.typography.titleMd, { color: theme.colors.onSurfaceVariant }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {/* 工具轨迹：重字段按需拉到才渲染（合成 envelope 只带聚合计数） */}
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
              </View>
            ) : loadError ? (
              <Text style={[theme.typography.labelSm, { color: theme.colors.error }]}>
                {t('activity.subagentDetailUnavailable')}
              </Text>
            ) : (
              <>
                {loaded.tools && loaded.tools.length > 0 ? (
                  <View style={styles.section}>
                    <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }, styles.sectionLabel]}>
                      {t('activity.subagentToolsLabel')}
                    </Text>
                    {loaded.tools.map((row: SubagentDetailTools[number], i: number) => (
                      <View key={`tool-${i}`} style={styles.toolRow}>
                        <Text
                          style={[theme.typography.codeSm, { color: row.is_error ? theme.colors.error : theme.colors.onSurface }]}
                          numberOfLines={1}
                        >
                          {row.is_error ? '✗ ' : ''}
                          {row.tool}
                        </Text>
                        {row.summary ? (
                          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }, styles.toolSummary]} numberOfLines={2}>
                            {row.summary}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* 结果/报告全文：synth detail 的 text 键（= journal finish 行 result） */}
                {loaded.text ? (
                  <View style={styles.section}>
                    <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }, styles.sectionLabel]}>
                      {t('activity.subagentResultLabel')}
                    </Text>
                    <Text style={[theme.typography.bodySm, { color: theme.colors.onSurface }]} selectable>
                      {loaded.text}
                    </Text>
                    {loaded.truncated ? (
                      <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }, styles.truncated]}>
                        {t('activity.outputTruncated')}
                      </Text>
                    ) : null}
                  </View>
                ) : !loading && !loadError ? (
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    {t('activity.subagentNoResult')}
                  </Text>
                ) : null}
              </>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  panel: {
    width: Math.round(SCREEN_WIDTH * 0.92),
    height: '100%',
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  body: { padding: 16, paddingBottom: 32 },
  section: { marginBottom: 20 },
  sectionLabel: { marginBottom: 8 },
  toolRow: { marginBottom: 10 },
  toolSummary: { marginTop: 2, opacity: 0.8 },
  center: { paddingVertical: 24, alignItems: 'center' },
  truncated: { marginTop: 8 },
});
