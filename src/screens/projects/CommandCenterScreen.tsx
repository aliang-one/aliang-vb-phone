import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { ErrorCard } from '../../components/cards/ErrorCard';
import { RunningInstanceCard } from '../../components/cards/RunningInstanceCard';
import { ProjectCard } from '../../components/cards/ProjectCard';
import { GlassPanel } from '../../components/shared/GlassPanel';
import {
  mockProjects,
  mockRunningInstances,
  mockErrors,
} from '../../data/mockData';

export const CommandCenterScreen: React.FC = () => {
  const { theme, isDark } = useTheme();

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Command Center"
        subtitle="PROJECT OVERVIEW"
        rightAction={
          <View style={styles.avatar}>
            <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
              AG
            </Text>
          </View>
        }
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        {/* Alerts Section */}
        <View style={styles.section}>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.error },
              styles.sectionTitle,
            ]}>
            REQUIRES ATTENTION
          </Text>
          {mockErrors.map(error => (
            <ErrorCard
              key={error.id}
              type={error.type}
              title={error.title}
              message={error.message}
              time={error.time}
              project={error.project}
            />
          ))}
        </View>

        {/* Running Instances */}
        <View style={styles.section}>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.primary },
              styles.sectionTitle,
            ]}>
            RUNNING INSTANCES
          </Text>
          {mockRunningInstances.map(instance => (
            <RunningInstanceCard key={instance.id} instance={instance} />
          ))}
        </View>

        {/* Projects */}
        <View style={styles.section}>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.onSurfaceVariant },
              styles.sectionTitle,
            ]}>
            PROJECTS
          </Text>
          {mockProjects.map(project => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </View>

        {/* Quick Stats */}
        <View style={styles.section}>
          <GlassPanel style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text
                style={[
                  theme.typography.headlineMd,
                  { color: theme.colors.primary },
                ]}>
                4
              </Text>
              <Text
                style={[
                  theme.typography.labelCaps,
                  { color: theme.colors.onSurfaceVariant },
                ]}>
                PROJECTS
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text
                style={[
                  theme.typography.headlineMd,
                  { color: theme.colors.secondary },
                ]}>
                3
              </Text>
              <Text
                style={[
                  theme.typography.labelCaps,
                  { color: theme.colors.onSurfaceVariant },
                ]}>
                RUNNING
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text
                style={[
                  theme.typography.headlineMd,
                  { color: theme.colors.error },
                ]}>
                2
              </Text>
              <Text
                style={[
                  theme.typography.labelCaps,
                  { color: theme.colors.onSurfaceVariant },
                ]}>
                ALERTS
              </Text>
            </View>
          </GlassPanel>
        </View>
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={[
          styles.fab,
          {
            backgroundColor: theme.colors.primary,
            borderRadius: theme.borderRadius.full,
            ...(isDark ? theme.glow.primary : {}),
          },
        ]}>
        <Text style={[theme.typography.headlineMd, { color: theme.colors.onPrimary }]}>
          +
        </Text>
      </TouchableOpacity>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 80,
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsGrid: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    gap: 4,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
