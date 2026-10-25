import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';
import { IconBadge } from '../visual/IconBadge';
import { useNowTick } from '../../hooks/useNowTick';
import { formatActivityLabel } from '../../store/internals';
import { getTerminalStatusChip } from '../../utils/terminalInteraction';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { useSessionStore } from '../../../stores/useSettingsStore';
import type { TerminalSession } from '../../store/types';
import { RootStackParamList } from '../../app/navigation/types';
import { TerminalCardMenuSheet } from './TerminalCardMenuSheet';
import { useTranslation } from 'react-i18next';

interface TerminalCardProps {
  terminal: TerminalSession;
  deviceName?: string;
  /** 设备离线时置灰并禁用 Resume;菜单里的"续期"随之禁用。删除不在此列
   * ——与设备状态彻底解绑,离线也能删(2026-10-25 拍板,server 离线收刀兜底)。 */
  disabled?: boolean;
  onPress?: () => void;
  onClose?: () => void;
}

const HISTORY_PREVIEW = 3;

type ExitState = 'ok' | 'err' | 'muted';
const exitState = (exitCode?: number | null): ExitState =>
  exitCode == null ? 'muted' : exitCode === 0 ? 'ok' : 'err';

/**
 * Two-column terminal card. Left: directory / device / live status + a recent
 * command-history strip (loaded per-session from the platform). Right: a slim
 * action rail — Resume (reopens the same PTY) and a "⋯" menu (delete / web-pair
 * scan / info sheet). The layout deliberately keeps the action rail narrow so
 * the left has room to surface more of what was actually run.
 */
export const TerminalCard = React.memo<TerminalCardProps>(
  ({ terminal, deviceName, disabled = false, onPress, onClose }) => {
    const { theme, isDark } = useTheme();
    const { t } = useTranslation('terminals');
    const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    const accountUser = useSessionStore(state => state.user);
    const renewTerminalSession = useControlCenterStore(
      state => state.renewTerminalSession,
    );
    const [menuOpen, setMenuOpen] = useState(false);
    // Re-render on the shared 30s cadence so relative time labels stay fresh.
    useNowTick();
    const sessionHistory = useControlCenterStore(
      state => state.terminalCommandHistory[`session:${terminal.id}`],
    );
    const deviceHistory = useControlCenterStore(
      state => state.terminalCommandHistory[`device:${terminal.deviceId}`],
    );

    const chip = getTerminalStatusChip(terminal.status);
    const activityMs = Date.parse(terminal.lastCommandAt ?? terminal.updatedAt);
    const activityLabel = formatActivityLabel(activityMs);
    // A freshly opened terminal has its own session id and therefore no
    // per-session history yet, so RECENT would otherwise be empty right after
    // opening — even though the device has plenty of recent commands. Merge the
    // device-wide history (already loaded by loadTerminalCommandHistory under
    // device:<id>) with this session's, dedup by id, and show the newest few.
    const recent = useMemo(() => {
      const byId = new Map<
        string,
        NonNullable<typeof sessionHistory>[number]
      >();
      for (const item of sessionHistory ?? []) byId.set(item.id, item);
      for (const item of deviceHistory ?? []) byId.set(item.id, item);
      return Array.from(byId.values())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, HISTORY_PREVIEW);
    }, [sessionHistory, deviceHistory]);

    const surfaceMuted = isDark
      ? 'rgba(255,255,255,0.035)'
      : theme.colors.surfaceContainer;
    const stateColor = (s: ExitState) =>
      s === 'ok'
        ? theme.colors.secondary
        : s === 'err'
          ? theme.colors.error
          : theme.colors.onSurfaceVariant;
    const faded = disabled ? 0.4 : 1;

    return (
      <>
      <GlassPanel style={styles.card}>
        <View style={styles.body}>
          {/* ---- Left: identity + recent commands ---- */}
          <View style={styles.left}>
            <View style={styles.header}>
              <IconBadge name="terminal" tone="primary" size={34} iconSize={17} />
              <View style={styles.titleBlock}>
                <Text
                  style={[
                    theme.typography.titleMd,
                    { color: theme.colors.onSurface },
                  ]}
                  numberOfLines={1}>
                  {terminal.directory || '~'}
                </Text>
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                  numberOfLines={1}>
                  {deviceName ?? terminal.deviceId}
                  {' · '}
                  {terminal.shell || 'shell'}
                  {' · '}
                  {activityLabel}
                  {disabled ? t('card.offlineSuffix') : ''}
                </Text>
              </View>
              <StatusChip label={chip.label} type={chip.type} />
            </View>

            <View style={[styles.historyWrap, { backgroundColor: surfaceMuted }]}>
              <Text
                style={[
                  theme.typography.labelCaps,
                  styles.sectionLabel,
                  { color: theme.colors.onSurfaceVariant },
                ]}>
                {t('card.recent')}
              </Text>
              {recent.length ? (
                recent.map(item => {
                  const st = exitState(item.exitCode);
                  return (
                    <View key={item.id} style={styles.cmdRow}>
                      <Text
                        style={[
                          theme.typography.codeSm,
                          { color: theme.colors.primary },
                        ]}>
                        $
                      </Text>
                      <Text
                        style={[
                          theme.typography.codeSm,
                          styles.cmdText,
                          { color: theme.colors.onSurface },
                        ]}
                        numberOfLines={1}>
                        {item.command.trim()}
                      </Text>
                      <View
                        style={[styles.dot, { backgroundColor: stateColor(st) }]}
                      />
                      <Text
                        style={[
                          theme.typography.labelSm,
                          styles.cmdTime,
                          { color: theme.colors.onSurfaceVariant },
                        ]}>
                        {formatActivityLabel(Date.parse(item.createdAt))}
                      </Text>
                    </View>
                  );
                })
              ) : (
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                    styles.emptyHistory,
                  ]}
                  numberOfLines={1}>
                  {terminal.lastCommand && terminal.lastCommand.trim()
                    ? `$ ${terminal.lastCommand.trim()}`
                    : t('card.emptyHistory')}
                </Text>
              )}
            </View>
          </View>

          {/* ---- Right: action rail ---- */}
          <View
            style={[
              styles.actions,
              {
                borderLeftColor: isDark
                  ? 'rgba(255,255,255,0.06)'
                  : theme.colors.outlineVariant,
              },
            ]}>
            <TouchableOpacity
              activeOpacity={0.7}
              disabled={disabled}
              onPress={onPress}
              style={[
                styles.actionBtn,
                { backgroundColor: theme.colors.primary, opacity: faded },
                isDark ? theme.glow.primary : null,
              ]}>
              <Svg width={13} height={13} viewBox="0 0 24 24">
                <Path d="M7 5l13 7-13 7V5z" fill={theme.colors.onPrimary} />
              </Svg>
            </TouchableOpacity>
            <Text
              style={[
                theme.typography.labelSm,
                styles.actionLabel,
                { color: theme.colors.primary, opacity: faded },
              ]}>
              {t('card.resume')}
            </Text>

            <View style={styles.actionSpacer} />

            {/* 菜单按钮:删除/扫码/简介。不随设备离线置灰——删除与设备状态
                彻底解绑(2026-10-25),扫码/简介本就不依赖终端存续;只有菜单
                里的"续期"条目跟随 disabled。 */}
            <TouchableOpacity
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('menu.title')}
              testID="terminal-card-menu"
              onPress={() => setMenuOpen(true)}
              style={[styles.actionBtn, styles.closeBtn, { borderColor: theme.colors.outline }]}>
              <Svg width={14} height={14} viewBox="0 0 24 24">
                <Circle cx={5} cy={12} r={1.7} fill={theme.colors.onSurfaceVariant} />
                <Circle cx={12} cy={12} r={1.7} fill={theme.colors.onSurfaceVariant} />
                <Circle cx={19} cy={12} r={1.7} fill={theme.colors.onSurfaceVariant} />
              </Svg>
            </TouchableOpacity>
            <Text
              style={[
                theme.typography.labelSm,
                styles.actionLabel,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {t('card.more')}
            </Text>
          </View>
        </View>
      </GlassPanel>
      <TerminalCardMenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        terminal={terminal}
        deviceName={deviceName}
        renewDisabled={disabled}
        createdBy={accountUser?.username || accountUser?.email}
        onDelete={() => {
          setMenuOpen(false);
          onClose?.();
        }}
        onRenew={hours => renewTerminalSession(terminal.id, hours)}
        onScan={() => {
          setMenuOpen(false);
          navigation.navigate('DeviceCameraScanner', {
            mode: 'terminalWebPair',
            deviceId: terminal.deviceId,
            terminalId: terminal.id,
            directory: terminal.directory,
          });
        }}
      />
      </>
    );
  },
  (prev, next) =>
    prev.terminal === next.terminal &&
    prev.deviceName === next.deviceName &&
    prev.disabled === next.disabled,
);

const styles = StyleSheet.create({
  card: {
    padding: 0,
    marginBottom: 10,
  },
  body: {
    flexDirection: 'row',
  },
  left: {
    flex: 1,
    padding: 12,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  historyWrap: {
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  sectionLabel: {
    fontSize: 9,
    letterSpacing: 0.6,
    marginBottom: 1,
  },
  cmdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cmdText: {
    flex: 1,
  },
  cmdTime: {
    fontSize: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  emptyHistory: {
    paddingVertical: 2,
  },
  actions: {
    width: 60,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    borderWidth: 1,
  },
  actionLabel: {
    fontSize: 9,
    letterSpacing: 0.4,
    marginTop: 4,
  },
  actionSpacer: {
    height: 8,
  },
});
