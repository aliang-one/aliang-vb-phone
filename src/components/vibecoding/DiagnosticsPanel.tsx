import React, { useEffect, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
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
import type { VibeCodingRun } from '../../data/platformModels';
import { GlassPanel } from '../shared/GlassPanel';
import { ProgressBar } from '../shared/ProgressBar';
import { IconBadge } from '../visual/IconBadge';
import { formatContextWindow } from '../../utils/contextWindow';

// 右侧滑出诊断面板：动画结构与 BottomSheet 同族（shared value + withTiming，
// 关闭动画走完再卸载），只是轴从 translateY 换成 translateX、锚点从底部换
// 右缘、圆角从顶部换左侧。
const SCREEN_WIDTH = Dimensions.get('window').width;
const OPEN_MS = 300;
const CLOSE_MS = 240;

/** 守卫阈值与内核常量对齐（agentcore loop.go：maxIdenticalToolTurns /
 *  maxConsecutiveToolErrors / maxTruncationRetries）。 */
const GUARD_MAX = { dup: 3, err: 5, trunc: 2 } as const;

interface DiagnosticsPanelProps {
  /** Drives the slide animation; closing animates out before unmount. */
  open: boolean;
  onClose: () => void;
  run: VibeCodingRun;
}

/** ms → 「1 分 23 秒」；<1s 显示毫秒。 */
function formatElapsed(ms?: number, t?: (k: string, o?: Record<string, unknown>) => string): string {
  if (ms === undefined || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return t ? (t('session.diagnostics.elapsedSec', { sec }) as string) : `${sec}s`;
  return t
    ? (t('session.diagnostics.elapsedMinSec', { min, sec }) as string)
    : `${min}m ${sec}s`;
}

export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({
  open,
  onClose,
  run,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const insets = useSafeAreaInsets();
  const translateX = useSharedValue(SCREEN_WIDTH);
  const backdropOpacity = useSharedValue(0);
  const [mounted, setMounted] = useState(open);

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

  if (!mounted) {
    return null;
  }

  const scrim = isDark ? 'rgba(2,5,8,0.74)' : 'rgba(12,18,28,0.4)';
  const divider = isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant;

  const diag = run.diagnostics;
  const windowTokens = diag?.contextWindow || run.contextWindow;
  const usedTokens = diag?.contextTokens ?? 0;
  const usageFraction =
    windowTokens && windowTokens > 0 && usedTokens > 0
      ? Math.min(1, usedTokens / windowTokens)
      : 0;

  // 最新一次 usage 事件 → 本回合输入/输出/缓存细分（口径与 activitySummary
  // 一致：usage 是 run 级最近一次上报，不是全 run 累计）。
  const lastUsage = [...(run.structuredEvents ?? [])]
    .reverse()
    .find(event => event.kind === 'usage');

  const phaseKey = `phaseLabel.${run.phase}`;
  const phaseLabel = t(phaseKey, { defaultValue: run.phase ?? '' });
  const guardRows: Array<{ key: string; value: number; max: number }> = [
    { key: 'dup', value: diag?.dupStreak ?? 0, max: GUARD_MAX.dup },
    { key: 'err', value: diag?.errStreak ?? 0, max: GUARD_MAX.err },
    { key: 'trunc', value: diag?.truncStreak ?? 0, max: GUARD_MAX.trunc },
  ];
  const failureReason = diag?.reason;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill}>
          <Animated.View
            style={[StyleSheet.absoluteFill, backdropStyle, { backgroundColor: scrim }]}
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
            <IconBadge name="fingerprint" tone="secondary" size={36} iconSize={18} />
            <View style={styles.headerCopy}>
              <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                {t('session.diagnostics.title')}
              </Text>
              <Text
                numberOfLines={1}
                style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                {phaseLabel}
                {diag?.stopReason ? ` · ${diag.stopReason}` : ''}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('session.diagnostics.closeA11y')}>
              <IconBadge name="close" tone="neutral" size={32} iconSize={16} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {/* 上下文用量 */}
            <GlassPanel style={styles.card}>
              <View style={styles.cardHeader}>
                <IconBadge name="quota" tone="secondary" size={36} iconSize={18} />
                <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                  {t('session.diagnostics.context.title').toUpperCase()}
                </Text>
              </View>
              <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
                {!windowTokens
                  ? '—'
                  : usedTokens > 0
                    ? t('session.diagnostics.context.usedOf', {
                        used: usedTokens.toLocaleString(),
                        total: formatContextWindow(windowTokens),
                      })
                    // 上游没报过用量（旧内核 / 该通道无 usage 上报）时给「暂无
                    // 用量数据」而不是「0 / 1M」——「还没用」和「没有数据」是
                    // 两回事，2026-10-29 诊断面板长期为空的 RCA 收口。
                    : t('session.diagnostics.context.noUsage')}
              </Text>
              <ProgressBar progress={usageFraction} style={styles.contextBar} />
              <View style={styles.rowGroup}>
                <Row label={t('session.diagnostics.context.used')} value={usedTokens ? usedTokens.toLocaleString() : '—'} />
                <Row label={t('session.diagnostics.context.window')} value={windowTokens ? formatContextWindow(windowTokens) : '—'} />
                <Row
                  label={t('session.diagnostics.context.remain')}
                  value={windowTokens ? Math.max(0, windowTokens - usedTokens).toLocaleString() : '—'}
                />
                <Row
                  label={t('session.diagnostics.context.lastTurn')}
                  value={
                    lastUsage && lastUsage.kind === 'usage'
                      ? `${lastUsage.inputTokens ?? 0} / ${lastUsage.outputTokens ?? 0}${
                          lastUsage.cacheReadTokens ? ` (+${lastUsage.cacheReadTokens.toLocaleString()})` : ''
                        }`
                      : '—'
                  }
                />
              </View>
              <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                {t('session.diagnostics.context.compactHint')}
              </Text>
            </GlassPanel>

            {/* 运行状态 */}
            <GlassPanel style={styles.card}>
              <View style={styles.cardHeader}>
                <IconBadge name="agent" tone="primary" size={36} iconSize={18} />
                <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                  {t('session.diagnostics.run.title').toUpperCase()}
                </Text>
              </View>
              <View style={styles.rowGroup}>
                <Row label={t('session.diagnostics.run.phase')} value={phaseLabel || '—'} />
                <Row label={t('session.diagnostics.run.turns')} value={diag ? String(diag.turns) : '—'} />
                <Row label={t('session.diagnostics.run.elapsed')} value={formatElapsed(diag?.elapsedMs, t)} />
                <Row
                  label={t('session.diagnostics.run.filesTouched')}
                  value={run.filesTouchedCount !== undefined ? String(run.filesTouchedCount) : '—'}
                />
                <Row
                  label={t('session.diagnostics.run.gitChanged')}
                  value={run.gitChangedCount !== undefined ? String(run.gitChangedCount) : '—'}
                />
                <Row label={t('session.diagnostics.run.stopReason')} value={diag?.stopReason ?? '—'} />
              </View>
            </GlassPanel>

            {/* 无进展守卫 */}
            <GlassPanel style={styles.card}>
              <View style={styles.cardHeader}>
                <IconBadge name="shield" tone="warning" size={36} iconSize={18} />
                <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                  {t('session.diagnostics.guards.title').toUpperCase()}
                </Text>
              </View>
              <View style={styles.rowGroup}>
                {guardRows.map(row => (
                  <View key={row.key} style={styles.guardRow}>
                    <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                      {t(`session.diagnostics.guards.${row.key}`)}
                    </Text>
                    <View style={styles.guardMeter}>
                      <ProgressBar
                        progress={row.max > 0 ? Math.min(1, row.value / row.max) : 0}
                        style={styles.guardBar}
                      />
                      <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                        {`${row.value}/${row.max}`}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </GlassPanel>

            {/* 失败原因 */}
            <GlassPanel style={styles.card}>
              <View style={styles.cardHeader}>
                <IconBadge name="warning" tone="error" size={36} iconSize={18} />
                <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                  {t('session.diagnostics.failure.title').toUpperCase()}
                </Text>
              </View>
              {failureReason || run.lastErrorStatus !== undefined ? (
                <View style={styles.rowGroup}>
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                    {failureReason ?? '—'}
                  </Text>
                  {(run.lastErrorStatus !== undefined || run.lastErrorType) && (
                    <Row
                      label={t('session.diagnostics.failure.lastError')}
                      value={
                        [run.lastErrorStatus, run.lastErrorType].filter(Boolean).join(' · ') || '—'
                      }
                    />
                  )}
                  {(run.lastRetryAttempt !== undefined || run.retryAttempt !== undefined) && (
                    <Row
                      label={t('session.diagnostics.failure.retry')}
                      value={`${run.retryAttempt ?? run.lastRetryAttempt}/${run.retryMax ?? run.lastRetryMax ?? '—'}`}
                    />
                  )}
                </View>
              ) : (
                <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurfaceVariant }]}>
                  {t('session.diagnostics.failure.none')}
                </Text>
              )}
            </GlassPanel>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const { theme } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Text numberOfLines={2} style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
        {value}
      </Text>
    </View>
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
    gap: 12,
  },
  card: {
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contextBar: {
    height: 8,
    borderRadius: 4,
  },
  rowGroup: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  guardRow: {
    gap: 4,
  },
  guardMeter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  guardBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
  },
});
