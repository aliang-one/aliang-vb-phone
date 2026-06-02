import React from 'react';
import { Text, StyleSheet, ScrollView, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { VibeSessionCard } from '../../components/vibecoding/VibeSessionCard';
import {
  mockDevices,
  mockProjects,
  mockVibeCodingRuns,
} from '../../data/mockData';
import { RootStackParamList } from '../../app/navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type ProjectRoute = RouteProp<RootStackParamList, 'ProjectDetail'>;

export const ProjectDetailScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<ProjectRoute>();
  const project = mockProjects.find(item => item.id === route.params.projectId);
  const device =
    mockDevices.find(item => item.id === route.params.deviceId) ||
    mockDevices.find(item => item.projectIds.includes(route.params.projectId));

  if (!project) {
    return (
      <SafeAreaWrapper>
        <TopAppBar title="Project" subtitle="NOT FOUND" onBack={navigation.goBack} />
      </SafeAreaWrapper>
    );
  }

  const sessions = mockVibeCodingRuns.filter(
    session => session.projectId === project.id,
  );

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={project.name}
        subtitle={device?.name ?? 'PROJECT DETAIL'}
        onBack={navigation.goBack}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <GlassPanel style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.titleBlock}>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                {project.language}
              </Text>
              <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
                {project.branch}
              </Text>
            </View>
            <StatusChip
              label={project.status.toUpperCase()}
              type={
                project.status === 'active'
                  ? 'success'
                  : project.status === 'error'
                  ? 'error'
                  : 'neutral'
              }
            />
          </View>
          <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurfaceVariant }]}>
            {project.description}
          </Text>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
            Last deploy {project.lastDeploy}
          </Text>
        </GlassPanel>

        <GlowButton
          title="CREATE VIBECODING"
          onPress={() =>
            navigation.navigate('CreateVibeCoding', {
              projectId: project.id,
              deviceId: device?.id,
            })
          }
          style={styles.createButton}
        />

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          VIBECODING HISTORY
        </Text>
        {sessions.map(session => (
          <VibeSessionCard
            key={session.id}
            session={session}
            project={project}
            device={mockDevices.find(item => item.id === session.deviceId)}
            onPress={() =>
              navigation.navigate('VibeCodingSession', { sessionId: session.id })
            }
          />
        ))}
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
    paddingTop: 12,
  },
  hero: {
    padding: 14,
    gap: 10,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleBlock: {
    gap: 4,
  },
  createButton: {
    marginTop: 12,
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
  },
});
