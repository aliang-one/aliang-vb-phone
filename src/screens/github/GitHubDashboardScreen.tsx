import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GitHubRepoCard } from '../../components/cards/GitHubRepoCard';
import { SearchBar } from '../../components/input/SearchBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { mockGitHubRepos } from '../../data/mockData';

export const GitHubDashboardScreen: React.FC = () => {
  const { theme } = useTheme();

  return (
    <SafeAreaWrapper>
      <TopAppBar title="GitHub" subtitle="REPOSITORIES" />
      <View style={styles.searchContainer}>
        <SearchBar value="" onChangeText={() => {}} placeholder="Search repos..." />
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        {/* Quick Stats */}
        <GlassPanel style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={[theme.typography.headlineMd, { color: theme.colors.primary }]}>
              {mockGitHubRepos.length}
            </Text>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              REPOS
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={[theme.typography.headlineMd, { color: theme.colors.secondary }]}>
              {mockGitHubRepos.reduce((sum, r) => sum + r.openPRs, 0)}
            </Text>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              OPEN PRS
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={[theme.typography.headlineMd, { color: theme.colors.onSurface }]}>
              {mockGitHubRepos.reduce((sum, r) => sum + r.stars, 0)}
            </Text>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              STARS
            </Text>
          </View>
        </GlassPanel>

        {/* Repo List */}
        {mockGitHubRepos.map(repo => (
          <GitHubRepoCard key={repo.id} repo={repo} />
        ))}
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  statsRow: {
    padding: 12,
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  stat: {
    alignItems: 'center',
    gap: 4,
  },
});
