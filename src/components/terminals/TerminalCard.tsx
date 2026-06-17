import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';
import { IconBadge } from '../visual/IconBadge';
import { useNowTick } from '../../hooks/useNowTick';
import { formatActivityLabel } from '../../store/internals';
import { getTerminalStatusChip } from '../../utils/terminalInteraction';
import type { TerminalSession } from '../../store/types';

interface TerminalCardProps {
  terminal: TerminalSession;
  deviceName?: string;
  /** 设备离线时置灰并禁用 Resume/Close。 */
  disabled?: boolean;
  onPress?: () => void;
  onClose?: () => void;
}

/**
 * Single-column terminal status card (mirrors VibeSessionCard's look). Shows the
 * working directory, owning device, shell, live status, last-active time and the
 * most recent submitted command. Resume reopens the same PTY; Close kills it.
 */
export const TerminalCard = React.memo<TerminalCardProps>(
  ({ terminal, deviceName, disabled = false, onPress, onClose }) => {
    const { theme, isDark } = useTheme();
    // Re-render on the shared 30s cadence so the relative last-active label
    // stays fresh instead of freezing.
    useNowTick();

    const chip = getTerminalStatusChip(terminal.status);
    const activityMs = Date.parse(terminal.lastCommandAt ?? terminal.updatedAt);
    const activityLabel = formatActivityLabel(activityMs);
    const surfaceMuted = isDark
      ? 'rgba(255,255,255,0.05)'
      : theme.colors.surfaceContainer;
    const disabledStyle = disabled ? styles.actionDisabled : null;

    return (
      <GlassPanel style={styles.card}>
        <View style={styles.header}>
          <IconBadge name="terminal" tone="primary" size={38} iconSize={19} />
          <View style={styles.titleBlock}>
            <Text
              style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}
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
              {disabled ? ' · 设备离线' : ''}
            </Text>
          </View>
          <StatusChip label={chip.label} type={chip.type} />
        </View>

        <View style={styles.metaRow}>
          <View style={[styles.pill, { backgroundColor: surfaceMuted }]}>
            <Text
              numberOfLines={1}
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {terminal.shell || 'shell'}
            </Text>
          </View>
          <View style={[styles.pill, { backgroundColor: surfaceMuted }]}>
            <Text
              numberOfLines={1}
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {activityLabel}
            </Text>
          </View>
        </View>

        <Text
          style={[
            theme.typography.codeSm,
            styles.lastCommand,
            { color: theme.colors.onSurface },
          ]}
          numberOfLines={1}>
          {terminal.lastCommand && terminal.lastCommand.trim()
            ? `$ ${terminal.lastCommand.trim()}`
            : '（暂无指令）'}
        </Text>

        <View style={styles.footer}>
          <TouchableOpacity
            activeOpacity={0.75}
            disabled={disabled}
            onPress={onPress}
            style={[
              styles.action,
              { borderColor: theme.colors.primary },
              disabledStyle,
            ]}>
            <Text
              style={[theme.typography.labelMd, { color: theme.colors.primary }]}>
              RESUME
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.75}
            disabled={disabled}
            onPress={onClose}
            style={[
              styles.action,
              { borderColor: theme.colors.outlineVariant },
              disabledStyle,
            ]}>
            <Text
              style={[
                theme.typography.labelMd,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              CLOSE
            </Text>
          </TouchableOpacity>
        </View>
      </GlassPanel>
    );
  },
  (prev, next) =>
    prev.terminal === next.terminal &&
    prev.deviceName === next.deviceName &&
    prev.disabled === next.disabled,
);

const styles = StyleSheet.create({
  card: {
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  lastCommand: {
    fontFamily: 'Inter',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
  },
  action: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionDisabled: {
    opacity: 0.45,
  },
});
