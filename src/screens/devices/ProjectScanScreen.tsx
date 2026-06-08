import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import { ProjectScanResult, useControlCenterStore } from '../../store/controlCenterStore';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type ScanRoute = RouteProp<RootStackParamList, 'ProjectScan'>;

const statusType: Record<
  ProjectScanResult['status'],
  'success' | 'warning' | 'neutral' | 'info'
> = {
  fresh: 'success',
  active: 'info',
  stale: 'neutral',
  warning: 'warning',
};

export const ProjectScanScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<ScanRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const scanResults = useControlCenterStore(state => state.scanResults);
  const scanDeviceProjects = useControlCenterStore(state => state.scanDeviceProjects);
  const device = devices.find(item => item.id === route.params.deviceId);
  const results = scanResults.filter(item => item.deviceId === route.params.deviceId);

  const portCount = results.reduce(
    (total, item) => total + item.detectedPorts.length,
    0,
  );
  const packageCount = results.filter(item => item.packageManager !== 'none').length;

  if (!device) {
    return (
      <SafeAreaWrapper>
        <TopAppBar
          title="Project Scan"
          subtitle="DEVICE NOT FOUND"
          onBack={navigation.goBack}
        />
      </SafeAreaWrapper>
    );
  }

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Project Scan"
        subtitle={device.name}
        onBack={navigation.goBack}
        rightAction={<StatusChip label={device.status.toUpperCase()} type={device.status === 'online' ? 'success' : device.status === 'warning' ? 'warning' : 'neutral'} />}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <GlassPanel style={styles.summaryPanel}>
          <View style={styles.summaryTop}>
            <View>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                AUTHORIZED ROOTS
              </Text>
              <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
                {device.authorizedDirectories.length} directories
              </Text>
            </View>
            <GlowButton
              title="SCAN NOW"
              onPress={() => scanDeviceProjects(device.id)}
              variant="secondary"
              style={styles.scanButton}
            />
          </View>
          <View style={styles.statRow}>
            <Metric label="GIT REPOS" value={`${results.length}`} />
            <Metric label="PACKAGES" value={`${packageCount}`} />
            <Metric label="PORTS" value={`${portCount}`} />
          </View>
        </GlassPanel>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          DISCOVERED PROJECTS
        </Text>

        {results.map(item => (
          <TouchableOpacity
            key={item.id}
            activeOpacity={0.75}
            onPress={() =>
              navigation.navigate('ProjectDetail', {
                projectId: item.projectId,
                deviceId: item.deviceId,
              })
            }>
            <GlassPanel style={styles.projectCard}>
              <View style={styles.cardHeader}>
                <View style={styles.titleBlock}>
                  <Text
                    numberOfLines={1}
                    style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                    {item.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                    {item.path}
                  </Text>
                </View>
                <StatusChip
                  label={item.status.toUpperCase()}
                  type={statusType[item.status]}
                />
              </View>
              <View style={styles.factGrid}>
                <Fact label="GIT" value={item.isGitRepo ? item.branch : 'none'} />
                <Fact label="PACKAGE" value={item.packageManager} />
                <Fact
                  label="PORTS"
                  value={
                    item.detectedPorts.length
                      ? item.detectedPorts.join(', ')
                      : 'none'
                  }
                />
                <Fact label="ACTIVE" value={item.lastActiveAt} />
              </View>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() =>
                    navigation.navigate('DeviceTerminal', {
                      deviceId: device.id,
                      directory: item.path,
                    })
                  }
                  style={[
                    styles.actionButton,
                    {
                      borderColor: theme.colors.outlineVariant,
                      borderRadius: theme.borderRadius.full,
                    },
                  ]}>
                  <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                    TERM
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() =>
                    navigation.navigate('AgentSessions', {
                      deviceId: device.id,
                      projectId: item.projectId,
                    })
                  }
                  style={[
                    styles.actionButton,
                    {
                      borderColor: theme.colors.outlineVariant,
                      borderRadius: theme.borderRadius.full,
                    },
                  ]}>
                  <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                    AGENT
                  </Text>
                </TouchableOpacity>
              </View>
            </GlassPanel>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaWrapper>
  );
};

interface MetricProps {
  label: string;
  value: string;
}

const Metric: React.FC<MetricProps> = ({ label, value }) => {
  const { theme } = useTheme();

  return (
    <View style={styles.metric}>
      <Text style={[theme.typography.headlineMd, { color: theme.colors.primary }]}>
        {value}
      </Text>
      <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
    </View>
  );
};

const Fact: React.FC<MetricProps> = ({ label, value }) => {
  const { theme } = useTheme();

  return (
    <View style={styles.fact}>
      <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
        {value}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  summaryPanel: {
    padding: 14,
    gap: 14,
  },
  summaryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  scanButton: {
    minWidth: 118,
    paddingHorizontal: 12,
  },
  statRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metric: {
    flex: 1,
    minHeight: 70,
    justifyContent: 'space-between',
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
  },
  projectCard: {
    padding: 12,
    marginBottom: 10,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 3,
  },
  factGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fact: {
    width: '48%',
    gap: 3,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    borderWidth: 1,
    minHeight: 36,
    minWidth: 82,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
