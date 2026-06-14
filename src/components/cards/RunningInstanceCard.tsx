import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { ProgressBar } from '../shared/ProgressBar';
import { StatusChip } from '../shared/StatusChip';
import { RunningInstance } from '../../data/platformModels';

interface RunningInstanceCardProps {
  instance: RunningInstance;
}

const statusLabels: Record<string, string> = {
  building: 'BUILDING',
  deploying: 'DEPLOYING',
  running: 'LIVE',
  stopping: 'STOPPING',
};

const statusTypes: Record<string, 'success' | 'info' | 'warning'> = {
  building: 'info',
  deploying: 'info',
  running: 'success',
  stopping: 'warning',
};

export const RunningInstanceCard: React.FC<RunningInstanceCardProps> = ({
  instance,
}) => {
  const { theme } = useTheme();

  return (
    <GlassPanel style={styles.card}>
      <View style={styles.header}>
        <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
          {instance.name}
        </Text>
        <StatusChip
          label={statusLabels[instance.status]}
          type={statusTypes[instance.status]}
        />
      </View>
      <Text
        style={[
          theme.typography.labelSm,
          { color: theme.colors.onSurfaceVariant },
          styles.meta,
        ]}>
        {instance.cluster} · {instance.startedAt}
      </Text>
      <View style={styles.progressRow}>
        <ProgressBar
          progress={instance.progress}
          color={
            instance.status === 'running'
              ? theme.colors.secondary
              : theme.colors.primary
          }
        />
        <Text
          style={[
            theme.typography.codeSm,
            { color: theme.colors.onSurfaceVariant },
          ]}>
          {instance.progress}%
        </Text>
      </View>
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  meta: {
    marginBottom: 8,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
