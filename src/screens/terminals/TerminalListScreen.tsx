import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { SearchBar } from '../../components/input/SearchBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { DeviceControlCard } from '../../components/vibecoding/DeviceControlCard';
import { IconBadge } from '../../components/visual/IconBadge';
import { TerminalCard } from '../../components/terminals/TerminalCard';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import {
  buildDeviceStatusIndex,
  isDeviceStatusOffline,
} from '../../utils/deviceStatus';
import { isActiveTerminalSessionStatus } from '../../utils/terminalInteraction';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export const TerminalListScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const devices = useControlCenterStore(state => state.devices);
  const terminalSessions = useControlCenterStore(state => state.terminalSessions);
  const stopTerminal = useControlCenterStore(state => state.stopTerminal);
  const refreshFromServer = useControlCenterStore(state => state.refreshFromServer);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const normalizedSearch = search.trim().toLowerCase();
  const filtered = devices.filter(device => {
    if (!normalizedSearch) return true;
    const searchable = [
      device.id,
      device.name,
      device.host,
      device.location,
      device.os,
      device.status,
      device.uniqueCode,
      device.agentVersion,
      ...device.capabilities,
      ...device.authorizedDirectories,
      ...device.activePorts.map(String),
      ...device.projectIds,
      ...device.activeSessionIds,
      ...device.tools.flatMap(tool => [
        tool.id,
        tool.name,
        tool.command,
        tool.path,
        tool.description,
        tool.available === undefined ? undefined : tool.available ? 'available' : 'unavailable',
      ]),
      ...device.history.flatMap(entry => [
        entry.tool,
        entry.path,
        entry.exists === undefined ? undefined : entry.exists ? 'exists' : 'missing',
        entry.updated_at,
      ]),
    ];
    return searchable
      .filter((value): value is string => typeof value === 'string')
      .some(value => value.toLowerCase().includes(normalizedSearch));
  });
  const deviceList = useIncrementalList(filtered, {
    initialCount: 10,
    step: 12,
    resetKey: normalizedSearch,
  });
  const deviceStatusIndex = useMemo(() => buildDeviceStatusIndex(devices), [
    devices,
  ]);
  const activeTerminals = useMemo(
    () =>
      terminalSessions
        .filter(terminal => isActiveTerminalSessionStatus(terminal.status))
        .map(terminal => ({
          terminal,
          device: devices.find(device => device.id === terminal.deviceId),
        }))
        .sort(
          (left, right) =>
            Date.parse(right.terminal.updatedAt) -
            Date.parse(left.terminal.updatedAt),
        ),
    [devices, terminalSessions],
  );
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshFromServer();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Devices"
        subtitle="AUTHORIZED COMPUTERS"
        rightAction={
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => navigation.navigate('DeviceCameraScanner')}
            style={styles.addButton}>
            <Text style={[theme.typography.codeMd, { color: theme.colors.primary }]}>
              +
            </Text>
          </TouchableOpacity>
        }
      />
      <View style={styles.searchContainer}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search devices, hosts, locations..."
        />
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }>
        <View style={styles.summary}>
          <StatusChip label={`${filtered.length} DEVICES`} type="info" />
          <StatusChip
            label={`${filtered.filter(device => device.status === 'online').length} ONLINE`}
            type="success"
          />
          <StatusChip
            label={`${filtered.filter(device => device.status === 'warning').length} WARNING`}
            type="warning"
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.onSurfaceVariant },
            ]}>
            ACTIVE TERMINALS
          </Text>
          <StatusChip label={`${activeTerminals.length} ACTIVE`} type="info" />
        </View>
        {activeTerminals.map(({ terminal, device }) => (
          <TerminalCard
            key={terminal.id}
            terminal={terminal}
            deviceName={device?.name}
            disabled={isDeviceStatusOffline(
              deviceStatusIndex.get(terminal.deviceId),
            )}
            onPress={() =>
              navigation.navigate('DeviceTerminal', {
                deviceId: terminal.deviceId,
                terminalId: terminal.id,
                directory: terminal.directory,
              })
            }
            onClose={() => {
              stopTerminal(terminal.id).catch(() => {});
            }}
          />
        ))}

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          COMPUTE WORKSTATIONS
        </Text>
        {deviceList.visibleItems.map(device => (
          <DeviceControlCard
            key={device.id}
            device={device}
            onPress={() => navigation.navigate('DeviceDetail', { deviceId: device.id })}
          />
        ))}
        <LoadMoreRow
          visibleCount={deviceList.visibleCount}
          totalCount={deviceList.totalCount}
          onPress={deviceList.showMore}
        />
        {!filtered.length ? (
          <GlassPanel style={styles.emptyCard}>
            <IconBadge name="device" tone="neutral" size={44} iconSize={22} />
            <View style={styles.emptyCopy}>
              <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                还没有注册设备
              </Text>
              <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                在电脑端启动桌面 Agent 完成注册，或用右上角扫码绑定已有设备。
              </Text>
            </View>
          </GlassPanel>
        ) : null}
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
  summary: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  sectionTitle: {
    marginBottom: 8,
  },
  sectionHeader: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  addButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    padding: 14,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  emptyCopy: {
    flex: 1,
    gap: 4,
  },
});
