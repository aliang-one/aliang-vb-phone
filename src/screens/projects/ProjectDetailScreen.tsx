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
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type ProjectRoute = RouteProp<RootStackParamList, 'ProjectDetail'>;

export const ProjectDetailScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<ProjectRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);
  const project = projects.find(item => item.id === route.params.projectId);
  const device =
    devices.find(item => item.id === route.params.deviceId) ||
    devices.find(item => project?.deviceId && item.id === project.deviceId) ||
    devices.find(item => item.projectIds.includes(route.params.projectId));

  if (!project) {
    return (
      <SafeAreaWrapper>
        <TopAppBar title="Project" subtitle="NOT FOUND" onBack={navigation.goBack} />
      </SafeAreaWrapper>
    );
  }

  const terminalDirectory = project.path || device?.authorizedDirectories[0] || '~';
  const sessions = vibeRuns.filter(
    session =>
      session.projectId === project.id ||
      (Boolean(project.path) &&
        session.deviceId === device?.id &&
        session.directory === project.path),
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
          <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
            {project.path || 'path not reported'}
          </Text>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
            Last active {project.lastDeploy ?? 'unknown'}
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
        <View style={styles.actionGrid}>
          <GlowButton
            title="FILES"
            onPress={() =>
              navigation.navigate('FileBrowser', {
                projectId: project.id,
                deviceId: device?.id,
              })
            }
            variant="outline"
            style={styles.gridAction}
          />
          <GlowButton
            title="TERMINAL"
            onPress={() =>
	              device &&
	              navigation.navigate('DeviceTerminal', {
	                deviceId: device.id,
	                directory: terminalDirectory,
	              })
	            }
	            disabled={!device || !device.remoteTerminalEnabled}
            variant="outline"
            style={styles.gridAction}
          />
        </View>
        <View style={styles.actionGrid}>
          <GlowButton
            title="AGENT SESSIONS"
            onPress={() =>
              navigation.navigate('AgentSessions', {
                deviceId: device?.id,
                projectId: project.id,
              })
            }
            variant="outline"
            style={styles.gridAction}
          />
          {device ? (
            <GlowButton
              title="SCAN DEVICE"
              onPress={() =>
                navigation.navigate('ProjectScan', { deviceId: device.id })
              }
              variant="outline"
              style={styles.gridAction}
            />
          ) : null}
        </View>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          VIBECODING HISTORY
        </Text>
        {sessions.length ? (
          sessions.map(session => (
            <VibeSessionCard
              key={session.id}
              session={session}
              project={project}
              device={devices.find(item => item.id === session.deviceId)}
              onPress={() =>
                navigation.navigate('VibeCodingSession', { sessionId: session.id })
              }
            />
          ))
        ) : (
          <GlassPanel style={styles.emptyPanel}>
            <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
              No VibeCoding history
            </Text>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              Start a session from this project to record conversation and Agent events.
            </Text>
          </GlassPanel>
        )}
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
  actionGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  gridAction: {
    flex: 1,
    paddingHorizontal: 8,
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
  },
  emptyPanel: {
    padding: 14,
    gap: 6,
  },
});
