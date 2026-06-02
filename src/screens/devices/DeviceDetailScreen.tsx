import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { ProgressBar } from '../../components/shared/ProgressBar';
import { StatusChip } from '../../components/shared/StatusChip';
import { VibeSessionCard } from '../../components/vibecoding/VibeSessionCard';
import {
  mockDevices,
  mockProjects,
  mockVibeCodingRuns,
} from '../../data/mockData';
import { RootStackParamList } from '../../app/navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type DeviceRoute = RouteProp<RootStackParamList, 'DeviceDetail'>;

const statusType = {
  online: 'success',
  warning: 'warning',
  offline: 'neutral',
} as const;

export const DeviceDetailScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<DeviceRoute>();
  const device = mockDevices.find(item => item.id === route.params.deviceId);

  if (!device) {
    return (
      <SafeAreaWrapper>
        <TopAppBar title="Device" subtitle="NOT FOUND" onBack={navigation.goBack} />
      </SafeAreaWrapper>
    );
  }

  const projects = mockProjects.filter(project =>
    device.projectIds.includes(project.id),
  );
  const sessions = mockVibeCodingRuns.filter(session =>
    device.activeSessionIds.includes(session.id),
  );

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={device.name}
        subtitle={device.host}
        onBack={navigation.goBack}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <GlassPanel style={styles.hero}>
          <View style={styles.heroTop}>
            <View>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                {device.os}
              </Text>
              <Text
                style={[
                  theme.typography.titleLg,
                  { color: theme.colors.onSurface },
                  styles.heroTitle,
                ]}>
                {device.location}
              </Text>
            </View>
            <StatusChip
              label={device.status.toUpperCase()}
              type={statusType[device.status]}
            />
          </View>
          <View style={styles.metricBlock}>
            <View style={styles.metricLabel}>
              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                CPU load
              </Text>
              <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
                {device.cpuLoad}%
              </Text>
            </View>
            <ProgressBar progress={device.cpuLoad} color={theme.colors.primary} />
          </View>
          <View style={styles.metricBlock}>
            <View style={styles.metricLabel}>
              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                Memory
              </Text>
              <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
                {device.memLoad}%
              </Text>
            </View>
            <ProgressBar progress={device.memLoad} color={theme.colors.secondary} />
          </View>
          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            Last seen {device.lastSeen}
          </Text>
        </GlassPanel>

        <GlowButton
          title="CREATE VIBECODING HERE"
          onPress={() =>
            navigation.navigate('CreateVibeCoding', { deviceId: device.id })
          }
          variant="primary"
          style={styles.createButton}
        />
        <GlowButton
          title="OPEN DEVICE TERMINAL"
          onPress={() =>
            navigation.navigate('DeviceTerminal', {
              deviceId: device.id,
              directory: device.authorizedDirectories[0],
            })
          }
          variant="secondary"
          style={styles.secondaryAction}
        />

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          AUTHORIZED DIRECTORIES
        </Text>
        <GlassPanel style={styles.listPanel}>
          {device.authorizedDirectories.map((directory, index) => (
            <View key={directory}>
              <View style={styles.directoryRow}>
                <Text
                  numberOfLines={1}
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurface },
                    styles.directoryPath,
                  ]}>
                  {directory}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() =>
                    navigation.navigate('DeviceTerminal', {
                      deviceId: device.id,
                      directory,
                    })
                  }
                  style={[
                    styles.directoryTerminalButton,
                    {
                      borderColor: theme.colors.outlineVariant,
                      borderRadius: theme.borderRadius.full,
                    },
                  ]}>
                  <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                    TERM
                  </Text>
                </TouchableOpacity>
              </View>
              {index < device.authorizedDirectories.length - 1 && (
                <View style={styles.divider} />
              )}
            </View>
          ))}
        </GlassPanel>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          PROJECTS ON DEVICE
        </Text>
        {projects.map(project => (
          <TouchableOpacity
            key={project.id}
            activeOpacity={0.75}
            onPress={() =>
              navigation.navigate('ProjectDetail', {
                projectId: project.id,
                deviceId: device.id,
              })
            }>
            <GlassPanel style={styles.projectCard}>
              <View style={styles.projectTop}>
                <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                  {project.name}
                </Text>
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
              <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                {project.description}
              </Text>
              <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                {project.branch}
              </Text>
            </GlassPanel>
          </TouchableOpacity>
        ))}

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          ACTIVE VIBECODING
        </Text>
        {sessions.map(session => (
          <VibeSessionCard
            key={session.id}
            session={session}
            project={mockProjects.find(project => project.id === session.projectId)}
            device={device}
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
    gap: 12,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroTitle: {
    marginTop: 4,
  },
  metricBlock: {
    gap: 6,
  },
  metricLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  createButton: {
    marginTop: 12,
  },
  secondaryAction: {
    marginTop: 8,
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
  },
  listPanel: {
    padding: 0,
  },
  directoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  directoryPath: {
    flex: 1,
  },
  directoryTerminalButton: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginHorizontal: 12,
  },
  projectCard: {
    padding: 12,
    gap: 8,
    marginBottom: 10,
  },
  projectTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
});
