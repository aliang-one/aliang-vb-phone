import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';
import { Project } from '../../data/mockData';

interface ProjectCardProps {
  project: Project;
  onPress?: () => void;
}

const statusMap: Record<string, 'success' | 'error' | 'neutral'> = {
  active: 'success',
  error: 'error',
  idle: 'neutral',
};

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  onPress,
}) => {
  const { theme } = useTheme();

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <GlassPanel style={styles.card}>
        <View style={styles.header}>
          <Text
            style={[
              theme.typography.codeMd,
              { color: theme.colors.primary },
            ]}>
            {project.name}
          </Text>
          <StatusChip
            label={project.status.toUpperCase()}
            type={statusMap[project.status]}
          />
        </View>
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
            styles.description,
          ]}
          numberOfLines={2}>
          {project.description}
        </Text>
        <View style={styles.footer}>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
            {project.language}
          </Text>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
            {project.branch}
          </Text>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
            {project.lastDeploy}
          </Text>
        </View>
      </GlassPanel>
    </TouchableOpacity>
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
    marginBottom: 6,
  },
  description: {
    marginBottom: 8,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
  },
});
