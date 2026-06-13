import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
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
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export const TerminalListScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const devices = useControlCenterStore(state => state.devices);
  const [search, setSearch] = useState('');

  const filtered = devices.filter(
    device =>
      device.name.toLowerCase().includes(search.toLowerCase()) ||
      device.host.toLowerCase().includes(search.toLowerCase()) ||
      device.location.toLowerCase().includes(search.toLowerCase()),
  );

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
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
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

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          COMPUTE WORKSTATIONS
        </Text>
        {filtered.map(device => (
          <DeviceControlCard
            key={device.id}
            device={device}
            onPress={() => navigation.navigate('DeviceDetail', { deviceId: device.id })}
          />
        ))}
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
