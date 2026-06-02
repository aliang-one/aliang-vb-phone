import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Device, Project, VibeCodingRun } from '../../data/mockData';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { ProgressBar } from '../shared/ProgressBar';
import { StatusChip } from '../shared/StatusChip';
import { vibeStatusLabel, vibeStatusType } from './status';

interface VibeSessionCardProps {
  session: VibeCodingRun;
  project?: Project;
  device?: Device;
  onPress?: () => void;
}

export const VibeSessionCard: React.FC<VibeSessionCardProps> = ({
  session,
  project,
  device,
  onPress,
}) => {
  const { theme } = useTheme();
  const progress = Math.min(
    100,
    (session.elapsedMinutes / session.timeLimitMinutes) * 100,
  );

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
      <GlassPanel
        glowColor={
          session.status === 'waiting_approval'
            ? 'secondary'
            : session.status === 'failed'
            ? 'error'
            : 'none'
        }
        style={styles.card}>
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Text
              style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}
              numberOfLines={1}>
              {session.title}
            </Text>
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}
              numberOfLines={1}>
              {project?.name ?? session.projectId} / {device?.name ?? session.deviceId}
            </Text>
          </View>
          <StatusChip
            label={vibeStatusLabel[session.status]}
            type={vibeStatusType[session.status]}
          />
        </View>
        <Text
          style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
          numberOfLines={2}>
          {session.currentStep}
        </Text>
        <View style={styles.progressBlock}>
          <View style={styles.progressMeta}>
            <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
              ${session.budgetUsed.toFixed(2)} / ${session.budgetLimit}
            </Text>
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {session.elapsedMinutes}m / {session.timeLimitMinutes}m
            </Text>
          </View>
          <ProgressBar progress={progress} color={theme.colors.primary} />
        </View>
        <View style={styles.footer}>
          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            {session.branch}
          </Text>
          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            {session.updatedAt}
          </Text>
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
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  progressBlock: {
    gap: 6,
  },
  progressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
});
