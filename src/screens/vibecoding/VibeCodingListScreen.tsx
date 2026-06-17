import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { SearchBar } from '../../components/input/SearchBar';
import { StatusChip } from '../../components/shared/StatusChip';
import { VibeSessionCard } from '../../components/vibecoding/VibeSessionCard';
import { DeviceControlCard } from '../../components/vibecoding/DeviceControlCard';
import { VibeStatus } from '../../data/platformModels';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { ACTIVE_RUN_STATUS } from '../../store/internals';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { formatVibeSessionTitle } from '../../utils/vibeSessionTitle';
import {
  buildDeviceStatusIndex,
  isDeviceStatusOffline,
  offlineLastComparator,
} from '../../utils/deviceStatus';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const filters: Array<{ label: string; value: 'all' | VibeStatus }> = [
  { label: 'ALL', value: 'all' },
  { label: 'RUNNING', value: 'running' },
  { label: 'APPROVAL', value: 'waiting_approval' },
  { label: 'PREVIEW', value: 'preview_ready' },
  { label: 'DONE', value: 'completed' },
];

export const VibeCodingListScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);
  const refreshFromServer = useControlCenterStore(
    state => state.refreshFromServer,
  );
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | VibeStatus>('all');
  const [refreshing, setRefreshing] = useState(false);

  const deviceStatusIndex = useMemo(
    () => buildDeviceStatusIndex(devices),
    [devices],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = useCallback(
    (values: Array<string | undefined>) =>
      !normalizedQuery ||
      values
        .filter((value): value is string => Boolean(value))
        .some(value => value.toLowerCase().includes(normalizedQuery)),
    [normalizedQuery],
  );
  const filteredDevices = useMemo(
    () =>
      devices.filter(device => {
        return matchesQuery([
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
          ...device.tools.flatMap(tool => [
            tool.id,
            tool.name,
            tool.command,
            tool.path,
            tool.description,
          ]),
          ...device.history.flatMap(entry => [
            entry.tool,
            entry.path,
            entry.updated_at,
          ]),
        ]);
      }),
    [devices, matchesQuery],
  );
  const filtered = useMemo(
    () =>
      vibeRuns
        .filter(session => {
          const project = projects.find(item => item.id === session.projectId);
          const device = devices.find(item => item.id === session.deviceId);
          const displayTitle = formatVibeSessionTitle(session.title, {
            directory: session.directory,
            projectName: project?.name,
          });
          const sessionMatchesQuery = matchesQuery([
            session.id,
            session.title,
            displayTitle,
            session.objective,
            session.model,
            session.status,
            session.directory,
            session.branch,
            session.currentStep,
            session.risk,
            session.previewId,
            session.lastMessage?.content,
            project?.id,
            project?.name,
            project?.path,
            project?.branch,
            project?.language,
            project?.description,
            project?.packageManager,
            ...(project?.detectedPorts ?? []).map(String),
            ...(project?.sourceTools ?? []),
            device?.id,
            device?.name,
            device?.host,
            device?.location,
            device?.os,
            device?.agentVersion,
            ...(device?.authorizedDirectories ?? []),
            ...(device?.tools ?? []).flatMap(tool => [
              tool.id,
              tool.name,
              tool.command,
              tool.path,
              tool.description,
            ]),
          ]);
          const matchesFilter = filter === 'all' || session.status === filter;
          return sessionMatchesQuery && matchesFilter;
        })
        .sort(
          offlineLastComparator(
            deviceStatusIndex,
            session => session.deviceId,
            (left, right) => {
              // Active (streaming / waiting) sessions stay pinned above idle
              // ones even when lastActivityMs goes stale during a long silent
              // tool run; only within the same activity tier do we fall back
              // to recency.
              const leftActive = ACTIVE_RUN_STATUS.has(left.status) ? 1 : 0;
              const rightActive = ACTIVE_RUN_STATUS.has(right.status) ? 1 : 0;
              if (leftActive !== rightActive) return rightActive - leftActive;
              return (right.lastActivityMs ?? 0) - (left.lastActivityMs ?? 0);
            },
          ),
        ),
    [vibeRuns, projects, devices, filter, matchesQuery, deviceStatusIndex],
  );
  const sortedDevices = [...filteredDevices].sort(
    offlineLastComparator(deviceStatusIndex, device => device.id, () => 0),
  );
  const deviceList = useIncrementalList(sortedDevices, {
    initialCount: 8,
    step: 10,
    resetKey: normalizedQuery,
  });
  const sessionList = useIncrementalList(filtered, {
    initialCount: 10,
    step: 12,
    resetKey: `${normalizedQuery}:${filter}`,
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
        title="Agents"
        subtitle="REGISTERED DESKTOP AGENTS"
        rightAction={
          <TouchableOpacity
            onPress={() => navigation.navigate('DeviceCameraScanner')}
            style={styles.addButton}
          >
            <Text
              style={[theme.typography.codeMd, { color: theme.colors.primary }]}
            >
              +
            </Text>
          </TouchableOpacity>
        }
      />
      <View style={styles.searchContainer}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search agents, hosts, sessions..."
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
        }
      >
        <View style={styles.summary}>
          <StatusChip label={`${devices.length} AGENTS`} type="info" />
          <StatusChip
            label={`${
              devices.filter(item => item.status === 'online').length
            } ONLINE`}
            type="success"
          />
          <StatusChip
            label={`${
              devices.filter(item => item.aiControlEnabled).length
            } AI READY`}
            type="info"
          />
        </View>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}
        >
          REGISTERED AGENTS
        </Text>
        {deviceList.visibleItems.map(device => (
          <DeviceControlCard
            key={device.id}
            device={device}
            onPress={() =>
              navigation.navigate('DeviceDetail', { deviceId: device.id })
            }
          />
        ))}
        <LoadMoreRow
          visibleCount={deviceList.visibleCount}
          totalCount={deviceList.totalCount}
          onPress={deviceList.showMore}
        />

        <View style={styles.sectionHeader}>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            VIBECODING SESSIONS
          </Text>
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => navigation.navigate('CreateVibeCoding', {})}
          >
            <Text
              style={[theme.typography.codeSm, { color: theme.colors.primary }]}
            >
              NEW TASK
            </Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {filters.map(item => {
            const active = filter === item.value;
            return (
              <TouchableOpacity
                key={item.value}
                onPress={() => setFilter(item.value)}
                style={[
                  styles.filterChip,
                  {
                    borderRadius: theme.borderRadius.full,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(86, 156, 214, 0.15)'
                        : 'rgba(0, 81, 174, 0.1)'
                      : 'transparent',
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                  },
                ]}
              >
                <Text
                  style={[
                    theme.typography.labelSm,
                    {
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                    },
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.summary}>
          <StatusChip label={`${filtered.length} SESSIONS`} type="info" />
          <StatusChip
            label={`${
              filtered.filter(item => item.status === 'waiting_approval').length
            } APPROVAL`}
            type="warning"
          />
          <StatusChip
            label={`${filtered.filter(item => item.previewId).length} PREVIEWS`}
            type="info"
          />
        </View>

        {sessionList.visibleItems.map(session => (
          <VibeSessionCard
            key={session.id}
            session={session}
            project={projects.find(project => project.id === session.projectId)}
            device={devices.find(device => device.id === session.deviceId)}
            disabled={isDeviceStatusOffline(
              deviceStatusIndex.get(session.deviceId),
            )}
            onPress={() =>
              navigation.navigate('VibeCodingSession', {
                sessionId: session.id,
              })
            }
          />
        ))}
        <LoadMoreRow
          visibleCount={sessionList.visibleCount}
          totalCount={sessionList.totalCount}
          onPress={sessionList.showMore}
        />
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  addButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  sectionTitle: {
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 2,
  },
  filters: {
    gap: 8,
    paddingTop: 12,
    paddingBottom: 10,
  },
  filterChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  summary: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
});
