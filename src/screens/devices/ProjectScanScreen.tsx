import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import { IconBadge } from '../../components/visual/IconBadge';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import {
  describeDeviceError,
  type DeviceErrorMessage,
} from '../../utils/deviceError';

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
  const projects = useControlCenterStore(state => state.projects);
  const scanResults = useControlCenterStore(state => state.scanResults);
  const scanDeviceProjects = useControlCenterStore(state => state.scanDeviceProjects);
  const refreshFromServer = useControlCenterStore(state => state.refreshFromServer);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<DeviceErrorMessage | null>(null);
  const device = devices.find(item => item.id === route.params.deviceId);
  const results = scanResults
    .filter(item => item.deviceId === route.params.deviceId)
    .sort((left, right) => right.lastActiveAt.localeCompare(left.lastActiveAt));
  const resultList = useIncrementalList(results, {
    initialCount: 12,
    step: 16,
    resetKey: route.params.deviceId,
  });

  const portCount = results.reduce(
    (total, item) => total + item.detectedPorts.length,
    0,
  );
  const packageCount = results.filter(item => item.packageManager !== 'none').length;

  const handleScan = async () => {
    if (!device || scanning) return;
    setScanError(null);
    // Agent 已知离线：扫描注定失败（结果是 Agent 跑出来的），直接给提示，不发请求。
    if (device.status === 'offline') {
      setScanError(describeDeviceError(new Error('device_offline')));
      return;
    }
    setScanning(true);
    const startCount = results.length;
    const hadResultsAtStart = startCount > 0;
    // The scan endpoint only ACKs ({ status, device_id }); the server emits
    // `projects.updated` once its filesystem scan finishes. Trigger it, then
    // poll the result count so the spinner reflects real result arrival.
    try {
      await scanDeviceProjects(device.id);
    } catch (error) {
      // 设备类错误（刚掉线/超时）需要明确告诉用户；其余错误仍可能由 WS/轮询兜底。
      const deviceMessage = describeDeviceError(error);
      if (deviceMessage) {
        setScanError(deviceMessage);
        setScanning(false);
        return;
      }
    }
    void refreshFromServer();
    let polls = 0;
    const MAX_POLLS = 4;
    const POLL_MS = 1200;
    const tick = () => {
      polls += 1;
      const current = useControlCenterStore.getState().scanResults.filter(
        r => r.deviceId === route.params.deviceId,
      ).length;
      const grew = current > startCount;
      // Stop when new results arrive, when we hit the max wait, or after the
      // first poll if the device already had results (no growth expected).
      if (grew || polls >= MAX_POLLS || (hadResultsAtStart && polls >= 1)) {
        setScanning(false);
        return;
      }
      void refreshFromServer();
      setTimeout(tick, POLL_MS);
    };
    setTimeout(tick, POLL_MS);
  };

  const handleProjectPress = (item: ProjectScanResult) => {
    // If the scan result has a valid projectId, navigate to ProjectDetail
    if (item.projectId) {
      navigation.navigate('ProjectDetail', {
        projectId: item.projectId,
        deviceId: item.deviceId,
      });
    } else {
      // Otherwise, find a matching project by path
      const matchedProject = projects.find(
        p => p.deviceId === item.deviceId && p.path === item.path,
      );
      if (matchedProject) {
        navigation.navigate('ProjectDetail', {
          projectId: matchedProject.id,
          deviceId: item.deviceId,
        });
      }
    }
  };

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
            <IconBadge name="scan" tone="primary" size={48} iconSize={24} filled />
            <View style={styles.summaryCopy}>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                AUTHORIZED ROOTS
              </Text>
              <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
                {device.authorizedDirectories.length} directories
              </Text>
            </View>
            {scanning ? (
              <View style={[styles.scanningBadge, { borderRadius: theme.borderRadius.md }]}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
                  SCANNING...
                </Text>
              </View>
            ) : (
              <GlowButton
                title="SCAN NOW"
                onPress={handleScan}
                variant="secondary"
                disabled={device.status === 'offline'}
                style={styles.scanButton}
              />
            )}
          </View>
          <View style={styles.statRow}>
            <Metric label="GIT REPOS" value={`${results.length}`} />
            <Metric label="PACKAGES" value={`${packageCount}`} />
            <Metric label="PORTS" value={`${portCount}`} />
          </View>
        </GlassPanel>

        {scanError ? (
          <GlassPanel style={styles.scanErrorPanel}>
            <Text
              style={[
                theme.typography.labelMd,
                {
                  color: scanError.offline
                    ? theme.colors.tertiary
                    : theme.colors.error,
                },
              ]}>
              {scanError.title}
            </Text>
            <Text
              style={[
                theme.typography.bodySm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {scanError.detail}
            </Text>
          </GlassPanel>
        ) : null}

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          DISCOVERED PROJECTS
        </Text>

        {results.length === 0 && !scanning ? (
          <GlassPanel style={styles.emptyPanel}>
            <IconBadge name="project" tone="neutral" size={42} iconSize={21} />
            <View style={styles.emptyCopy}>
              <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                No projects discovered
              </Text>
              <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                Run a scan to discover Git repositories and project directories on this device.
              </Text>
            </View>
          </GlassPanel>
        ) : null}

        {resultList.visibleItems.map(item => (
          <TouchableOpacity
            key={item.id}
            activeOpacity={0.75}
            onPress={() => handleProjectPress(item)}>
            <GlassPanel style={styles.projectCard}>
              <View style={styles.cardHeader}>
                <IconBadge
                  name={item.isGitRepo ? 'git' : 'project'}
                  tone={item.status === 'warning' ? 'tertiary' : 'primary'}
                  size={42}
                  iconSize={21}
                />
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
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => handleProjectPress(item)}
                  style={[
                    styles.actionButton,
                    styles.openButton,
                    {
                      borderColor: theme.colors.primary,
                      borderRadius: theme.borderRadius.full,
                    },
                  ]}>
                  <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                    OPEN
                  </Text>
                </TouchableOpacity>
              </View>
            </GlassPanel>
          </TouchableOpacity>
        ))}
        <LoadMoreRow
          visibleCount={resultList.visibleCount}
          totalCount={resultList.totalCount}
          onPress={resultList.showMore}
        />
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
    alignItems: 'center',
    gap: 12,
  },
  scanButton: {
    minWidth: 118,
    paddingHorizontal: 12,
  },
  scanningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 118,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(86, 156, 214, 0.08)',
  },
  summaryCopy: {
    flex: 1,
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
  emptyPanel: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  scanErrorPanel: {
    padding: 14,
    gap: 6,
  },
  emptyCopy: {
    flex: 1,
    gap: 4,
  },
  projectCard: {
    padding: 12,
    marginBottom: 10,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  openButton: {
    flex: 1,
  },
});
