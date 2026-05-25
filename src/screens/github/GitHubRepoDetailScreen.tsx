import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { GlowButton } from '../../components/shared/GlowButton';
import { mockGitHubRepos } from '../../data/mockData';

export const GitHubRepoDetailScreen: React.FC = () => {
  const { theme } = useTheme();
  const repo = mockGitHubRepos[0];

  const fileTree = [
    { type: 'dir', name: 'src' },
    { type: 'dir', name: 'tests' },
    { type: 'file', name: 'main.go' },
    { type: 'file', name: 'go.mod' },
    { type: 'file', name: 'Dockerfile' },
    { type: 'file', name: 'README.md' },
    { type: 'file', name: '.gitignore' },
  ];

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={repo.name}
        subtitle={repo.fullName.toUpperCase()}
        onBack={() => {}}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        {/* Repo Info */}
        <GlassPanel style={styles.infoPanel}>
          <Text
            style={[
              theme.typography.bodyMd,
              { color: theme.colors.onSurfaceVariant },
            ]}>
            {repo.description}
          </Text>
          <View style={styles.tags}>
            <StatusChip label={repo.language} type="info" />
            <StatusChip label={repo.visibility.toUpperCase()} type="neutral" />
            <StatusChip label={`${repo.openPRs} PRS`} type="warning" />
          </View>
          <View style={styles.stats}>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              ★ {repo.stars}
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              ⑂ {repo.forks}
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {repo.lastUpdated}
            </Text>
          </View>
        </GlassPanel>

        {/* File Tree */}
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          FILES
        </Text>
        <GlassPanel style={styles.fileTree}>
          {fileTree.map((item, index) => (
            <View key={index} style={styles.fileRow}>
              <Text
                style={[
                  theme.typography.codeSm,
                  {
                    color:
                      item.type === 'dir'
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                  },
                ]}>
                {item.type === 'dir' ? '[DIR]' : '  - -'}
              </Text>
              <Text
                style={[
                  theme.typography.codeSm,
                  {
                    color:
                      item.type === 'dir'
                        ? theme.colors.primary
                        : theme.colors.onSurface,
                  },
                ]}>
                {item.name}
              </Text>
            </View>
          ))}
        </GlassPanel>

        {/* Actions */}
        <View style={styles.actions}>
          <GlowButton title="CLONE" onPress={() => {}} variant="primary" />
          <GlowButton title="NEW PR" onPress={() => {}} variant="secondary" />
        </View>
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  infoPanel: {
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  tags: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  stats: {
    flexDirection: 'row',
    gap: 16,
  },
  sectionTitle: {
    marginTop: 16,
    marginBottom: 8,
  },
  fileTree: {
    padding: 12,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  actions: {
    marginTop: 20,
    gap: 8,
  },
});
