import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { GlowButton } from '../../components/shared/GlowButton';
import { ResourceMetricsCard } from '../../components/cards/ResourceMetricsCard';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';

export const TerminalDetailScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const { deviceId } = (route.params as { deviceId?: string }) ?? {};
  const devices = useControlCenterStore(state => state.devices);

  // Find the device to show terminal details for
  const device = deviceId
    ? devices.find(d => d.id === deviceId)
    : devices.find(d => d.status === 'online');
  const directoryList = useIncrementalList(device?.authorizedDirectories ?? [], {
    initialCount: 10,
    step: 12,
    resetKey: device?.id ?? 'missing',
  });
  const portList = useIncrementalList(device?.activePorts ?? [], {
    initialCount: 20,
    step: 24,
    resetKey: device?.id ?? 'missing',
  });

  if (!device) {
    return (
      <SafeAreaWrapper>
        <TopAppBar title="Terminal" subtitle="NO DEVICE" onBack={() => navigation.goBack()} />
        <View style={styles.emptyContainer}>
          <Text style={[theme.typography.bodyLg, { color: theme.colors.onSurfaceVariant }]}>
            No device available for terminal connection
          </Text>
        </View>
      </SafeAreaWrapper>
    );
  }

  const statusMap: Record<string, 'success' | 'error' | 'neutral'> = {
    online: 'success',
    offline: 'error',
    warning: 'neutral',
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={device.name}
        subtitle="TERMINAL DETAIL"
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        {/* Status Header */}
        <GlassPanel style={styles.statusHeader}>
          <View style={styles.statusRow}>
            <StatusChip
              label={device.status.toUpperCase()}
              type={statusMap[device.status] ?? 'neutral'}
            />
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {device.host ?? device.id}
            </Text>
          </View>
          <Text
            style={[
              theme.typography.labelSm,
              { color: theme.colors.onSurfaceVariant },
              styles.group,
            ]}>
            OS: {device.os} / Location: {device.location}
          </Text>
        </GlassPanel>

        {/* Resource Metrics */}
        <ResourceMetricsCard
          metrics={[
            {
              label: 'CPU LOAD',
              value: `${device.cpuLoad}%`,
              progress: device.cpuLoad,
              color: device.cpuLoad > 80 ? theme.colors.error : theme.colors.primary,
            },
            {
              label: 'MEMORY',
              value: `${device.memLoad}%`,
              progress: device.memLoad,
              color: device.memLoad > 80 ? theme.colors.tertiary : theme.colors.primary,
            },
            ...(device.battery !== undefined ? [{
              label: 'BATTERY',
              value: `${device.battery}%`,
              progress: device.battery,
              color: device.battery < 20 ? theme.colors.error : theme.colors.secondary,
            }] : []),
          ]}
        />

        {/* Authorized Directories */}
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          AUTHORIZED DIRECTORIES
        </Text>
        <GlassPanel style={styles.processList}>
          {device.authorizedDirectories.length === 0 ? (
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              No directories
            </Text>
          ) : (
            directoryList.visibleItems.map((dir, index) => (
              <TouchableOpacity
                key={index}
                onPress={() =>
                  navigation.navigate('DeviceTerminal', {
                    deviceId: device.id,
                    directory: dir,
                  })
                }>
                <View style={styles.processRow}>
                  <Text
                    style={[
                      theme.typography.codeSm,
                      { color: theme.colors.primary },
                    ]}>
                    {dir}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
          <LoadMoreRow
            visibleCount={directoryList.visibleCount}
            totalCount={directoryList.totalCount}
            onPress={directoryList.showMore}
          />
        </GlassPanel>

        {/* Active Ports */}
        {device.activePorts.length > 0 && (
          <>
            <Text
              style={[
                theme.typography.labelCaps,
                { color: theme.colors.onSurfaceVariant },
                styles.sectionTitle,
              ]}>
              ACTIVE PORTS
            </Text>
            <GlassPanel style={styles.processList}>
              <View style={styles.portRow}>
                {portList.visibleItems.map((port, index) => (
                  <StatusChip key={index} label={`${port}`} type="info" />
                ))}
              </View>
              <LoadMoreRow
                visibleCount={portList.visibleCount}
                totalCount={portList.totalCount}
                onPress={portList.showMore}
              />
            </GlassPanel>
          </>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <GlowButton
            title="OPEN TERMINAL"
            onPress={() =>
              navigation.navigate('DeviceTerminal', {
                deviceId: device.id,
                directory: device.authorizedDirectories[0] ?? '~',
              })
            }
            variant="primary"
          />
          <GlowButton
            title="VIEW DETAILS"
            onPress={() => navigation.navigate('DeviceDetail', { deviceId: device.id })}
            variant="secondary"
          />
        </View>
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  statusHeader: {
    padding: 12,
    marginTop: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  group: {
    marginTop: 4,
  },
  sectionTitle: {
    marginTop: 16,
    marginBottom: 8,
  },
  processList: {
    padding: 12,
  },
  processRow: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  portRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actions: {
    marginTop: 20,
    gap: 8,
  },
});
