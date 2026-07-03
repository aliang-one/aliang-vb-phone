import React, { useState } from 'react';
import { ActivityIndicator, View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { SearchBar } from '../../components/input/SearchBar';
import { DeferredMount } from '../../components/shared/DeferredMount';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { StatusChip } from '../../components/shared/StatusChip';
import { DeviceControlCard } from '../../components/vibecoding/DeviceControlCard';
import { IconBadge } from '../../components/visual/IconBadge';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { useTranslation } from 'react-i18next';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export const TerminalListScreen: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('terminals');
  const navigation = useNavigation<Navigation>();
  const devices = useControlCenterStore(state => state.devices);
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
        title={t('list.title')}
        subtitle={t('list.subtitle')}
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
          placeholder={t('list.searchPlaceholder')}
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
        <DeferredMount
          fallback={
            <View style={styles.deferredPlaceholder}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                {t('list.loading')}
              </Text>
            </View>
          }>
          <View style={styles.summary}>
          <StatusChip label={t('list.summaryDevices', { count: filtered.length })} type="info" />
          <StatusChip
            label={t('list.summaryOnline', { count: filtered.filter(device => device.status === 'online').length })}
            type="success"
          />
          <StatusChip
            label={t('list.summaryWarning', { count: filtered.filter(device => device.status === 'warning').length })}
            type="warning"
          />
        </View>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          {t('list.sectionWorkstations')}
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
                {normalizedSearch ? t('list.emptySearchTitle', { query: search }) : t('list.emptyDefaultTitle')}
              </Text>
              <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                {normalizedSearch ? t('list.emptySearchBody') : t('list.emptyDefaultBody')}
              </Text>
            </View>
          </GlassPanel>
        ) : null}
        </DeferredMount>
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
  deferredPlaceholder: {
    paddingVertical: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
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
