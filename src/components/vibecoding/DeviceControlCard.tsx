import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Device } from '../../data/platformModels';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';
import { IconBadge } from '../visual/IconBadge';
import { RingMeter } from '../visual/RingMeter';

interface DeviceControlCardProps {
  device: Device;
  onPress?: () => void;
}

const statusType = {
  online: 'success',
  warning: 'warning',
  offline: 'neutral',
} as const;

export const DeviceControlCard = React.memo<DeviceControlCardProps>(({
  device,
  onPress,
}) => {
  const { theme, isDark } = useTheme();

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
      <GlassPanel
        glowColor={device.status === 'warning' ? 'secondary' : 'none'}
        style={styles.card}>
        <View style={styles.header}>
          <IconBadge
            name="device"
            tone={
              device.status === 'offline'
                ? 'neutral'
                : device.status === 'warning'
                ? 'tertiary'
                : 'primary'
            }
            filled={device.status === 'online'}
          />
          <View style={styles.titleBlock}>
            <Text
              style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}
              numberOfLines={1}>
              {device.name}
            </Text>
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}
              numberOfLines={1}>
              {device.host}
            </Text>
          </View>
          <StatusChip
            label={device.status.toUpperCase()}
            type={statusType[device.status]}
          />
        </View>
        <View style={styles.metaRow}>
          <View style={[styles.metaPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : theme.colors.surfaceContainer }]}>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {device.os}
            </Text>
          </View>
          <View style={[styles.metaPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : theme.colors.surfaceContainer }]}>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {device.location}
            </Text>
          </View>
        </View>
        <View style={styles.metrics}>
          <RingMeter
            progress={device.cpuLoad}
            label="CPU"
            value={`${device.cpuLoad}%`}
            color={theme.colors.primary}
            size={74}
          />
          <RingMeter
            progress={device.memLoad}
            label="MEM"
            value={`${device.memLoad}%`}
            color={theme.colors.secondary}
            size={74}
          />
          <View style={styles.statStack}>
            <MiniStat icon="project" value={`${device.projectIds.length}`} label="Projects" />
            <MiniStat icon="agent" value={`${device.activeSessionIds.length}`} label="Agents" />
          </View>
        </View>
      </GlassPanel>
    </TouchableOpacity>
  );
}, (prev, next) => prev.device === next.device);

interface MiniStatProps {
  icon: 'project' | 'agent';
  value: string;
  label: string;
}

const MiniStat: React.FC<MiniStatProps> = ({ icon, value, label }) => {
  const { theme, isDark } = useTheme();

  return (
    <View
      style={[
        styles.miniStat,
        {
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.05)'
            : theme.colors.surfaceContainer,
        },
      ]}>
      <IconBadge name={icon} tone={icon === 'agent' ? 'secondary' : 'primary'} size={30} iconSize={15} />
      <View>
        <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
          {value}
        </Text>
        <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
          {label}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  metaPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statStack: {
    flex: 1,
    gap: 8,
  },
  miniStat: {
    minHeight: 42,
    borderRadius: 8,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
