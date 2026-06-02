import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Device } from '../../data/mockData';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';

interface DeviceControlCardProps {
  device: Device;
  onPress?: () => void;
}

const statusType = {
  online: 'success',
  warning: 'warning',
  offline: 'neutral',
} as const;

export const DeviceControlCard: React.FC<DeviceControlCardProps> = ({
  device,
  onPress,
}) => {
  const { theme } = useTheme();

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
      <GlassPanel
        glowColor={device.status === 'warning' ? 'secondary' : 'none'}
        style={styles.card}>
        <View style={styles.header}>
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
          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            {device.os}
          </Text>
          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            {device.location}
          </Text>
        </View>
        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              CPU
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
              {device.cpuLoad}%
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              MEM
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
              {device.memLoad}%
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              PROJECTS
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
              {device.projectIds.length}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              AGENTS
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
              {device.activeSessionIds.length}
            </Text>
          </View>
        </View>
      </GlassPanel>
    </TouchableOpacity>
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
    justifyContent: 'space-between',
    gap: 12,
  },
  metrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metric: {
    gap: 2,
  },
});
