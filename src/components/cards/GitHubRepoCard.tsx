import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { GitHubRepo } from '../../data/mockData';

interface GitHubRepoCardProps {
  repo: GitHubRepo;
  onPress?: () => void;
}

export const GitHubRepoCard: React.FC<GitHubRepoCardProps> = ({
  repo,
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
            {repo.fullName}
          </Text>
          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            {repo.visibility}
          </Text>
        </View>
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
            styles.description,
          ]}
          numberOfLines={2}>
          {repo.description}
        </Text>
        <View style={styles.footer}>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
            {repo.language}
          </Text>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
            ★ {repo.stars}
          </Text>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
            ⑂ {repo.forks}
          </Text>
          {repo.openPRs > 0 && (
            <Text style={[theme.typography.codeSm, { color: theme.colors.tertiary }]}>
              PR:{repo.openPRs}
            </Text>
          )}
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
            {repo.lastUpdated}
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
    marginBottom: 4,
  },
  description: {
    marginBottom: 8,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
});
