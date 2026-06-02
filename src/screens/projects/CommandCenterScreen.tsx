import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { UsageSummaryCard } from '../../components/vibecoding/UsageSummaryCard';
import { VibeSessionCard } from '../../components/vibecoding/VibeSessionCard';
import { DeviceControlCard } from '../../components/vibecoding/DeviceControlCard';
import {
  mockDevices,
  mockPreviewLinks,
  mockProjects,
  mockUserPlan,
  mockVibeCodingRuns,
} from '../../data/mockData';
import { RootStackParamList } from '../../app/navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export const CommandCenterScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();

  const waitingRuns = mockVibeCodingRuns.filter(session =>
    ['waiting_user', 'waiting_approval', 'preview_ready'].includes(
      session.status,
    ),
  );
  const onlineDevices = mockDevices.filter(device => device.status === 'online');
  const activeRuns = mockVibeCodingRuns.filter(session =>
    ['running', 'testing', 'preview_ready', 'waiting_approval'].includes(
      session.status,
    ),
  );

  const getProject = (projectId: string) =>
    mockProjects.find(project => project.id === projectId);
  const getDevice = (deviceId: string) =>
    mockDevices.find(device => device.id === deviceId);

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Vibe Command"
        subtitle="MOBILE AGENT CONTROL"
        rightAction={
          <View style={styles.avatar}>
            <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
              AL
            </Text>
          </View>
        }
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <UsageSummaryCard plan={mockUserPlan} />

        <View style={styles.statsGrid}>
          <GlassPanel style={styles.statCard}>
            <Text style={[theme.typography.headlineMd, { color: theme.colors.secondary }]}>
              {onlineDevices.length}
            </Text>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              ONLINE DEVICES
            </Text>
          </GlassPanel>
          <GlassPanel style={styles.statCard}>
            <Text style={[theme.typography.headlineMd, { color: theme.colors.primary }]}>
              {activeRuns.length}
            </Text>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              ACTIVE AGENTS
            </Text>
          </GlassPanel>
          <GlassPanel style={styles.statCard}>
            <Text style={[theme.typography.headlineMd, { color: theme.colors.tertiary }]}>
              {waitingRuns.length}
            </Text>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              NEEDS YOU
            </Text>
          </GlassPanel>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.tertiary }]}>
            NEEDS ATTENTION
          </Text>
          <StatusChip label={`${waitingRuns.length} QUEUED`} type="warning" />
        </View>
        {waitingRuns.map(session => (
          <VibeSessionCard
            key={session.id}
            session={session}
            project={getProject(session.projectId)}
            device={getDevice(session.deviceId)}
            onPress={() =>
              navigation.navigate('VibeCodingSession', { sessionId: session.id })
            }
          />
        ))}

        <View style={styles.sectionHeader}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
            RECENT PREVIEWS
          </Text>
        </View>
        {mockPreviewLinks.map(preview => {
          const session = mockVibeCodingRuns.find(item => item.id === preview.sessionId);
          return (
            <TouchableOpacity
              key={preview.id}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('Preview', { previewId: preview.id })}>
              <GlassPanel style={styles.previewCard}>
                <View style={styles.previewTop}>
                  <Text
                    style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}
                    numberOfLines={1}>
                    {session?.title ?? preview.targetUrl}
                  </Text>
                  <StatusChip label={`${preview.port}`} type="info" />
                </View>
                <Text
                  style={[theme.typography.codeSm, { color: theme.colors.primary }]}
                  numberOfLines={1}>
                  {preview.shortUrl}
                </Text>
                <Text
                  style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  {preview.access.toUpperCase()} / expires in {preview.expiresIn}
                </Text>
              </GlassPanel>
            </TouchableOpacity>
          );
        })}

        <View style={styles.sectionHeader}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
            DEVICE SNAPSHOT
          </Text>
        </View>
        {mockDevices.slice(0, 2).map(device => (
          <DeviceControlCard
            key={device.id}
            device={device}
            onPress={() => navigation.navigate('DeviceDetail', { deviceId: device.id })}
          />
        ))}
      </ScrollView>

      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => navigation.navigate('CreateVibeCoding', {})}
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
    paddingBottom: 92,
    paddingTop: 12,
  },
  avatar: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  statCard: {
    flex: 1,
    minHeight: 82,
    padding: 10,
    justifyContent: 'space-between',
  },
  sectionHeader: {
    marginTop: 20,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewCard: {
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  previewTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
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
