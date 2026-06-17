import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { SearchBar } from '../../components/input/SearchBar';
import { StatusChip } from '../../components/shared/StatusChip';
import { VibeSessionCard } from '../../components/vibecoding/VibeSessionCard';
import { TerminalCard } from '../../components/terminals/TerminalCard';
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
import { isActiveTerminalSessionStatus } from '../../utils/terminalInteraction';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const filters: Array<{ label: string; value: 'all' | VibeStatus }> = [
  { label: 'ALL', value: 'all' },
  { label: 'RUNNING', value: 'running' },
  { label: 'APPROVAL', value: 'waiting_approval' },
  { label: 'PREVIEW', value: 'preview_ready' },
  { label: 'DONE', value: 'completed' },
];

const getActiveChipBackground = (isDark: boolean) =>
  isDark ? 'rgba(86, 156, 214, 0.15)' : 'rgba(0, 81, 174, 0.1)';

const getFilterChipBackground = (active: boolean, isDark: boolean) => {
  if (!active) return 'transparent';
  return getActiveChipBackground(isDark);
};

type VibecodingTab = { key: 'vibecoding'; title: string } | { key: 'terminals'; title: string };
const TABS: VibecodingTab[] = [
  { key: 'vibecoding', title: 'Vibecoding' },
  { key: 'terminals', title: 'Terminals' },
];

export const VibeCodingListScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { width } = useWindowDimensions();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const vibeRuns = useControlCenterStore(state => state.vibeRuns);
  const refreshFromServer = useControlCenterStore(
    state => state.refreshFromServer,
  );
  const terminalSessions = useControlCenterStore(state => state.terminalSessions);
  const stopTerminal = useControlCenterStore(state => state.stopTerminal);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | VibeStatus>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const pagerRef = useRef<ScrollView>(null);

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
  const sessionList = useIncrementalList(filtered, {
    initialCount: 10,
    step: 12,
    resetKey: `${normalizedQuery}:${filter}`,
  });

  // All live remote shells across every device (Tab 2). Resume reopens the same
  // PTY; Close kills it. Closed/stopped sessions are filtered out. Searchable by
  // directory / device / shell / last command.
  const activeTerminals = useMemo(
    () =>
      terminalSessions
        .filter(t => isActiveTerminalSessionStatus(t.status))
        .map(terminal => ({
          terminal,
          device: devices.find(item => item.id === terminal.deviceId),
        }))
        .filter(({ terminal, device }) =>
          matchesQuery([
            terminal.directory,
            terminal.shell,
            terminal.lastCommand,
            device?.name,
            device?.id,
          ]),
        )
        .sort((a, b) =>
          b.terminal.updatedAt > a.terminal.updatedAt ? 1 : -1,
        ),
    [terminalSessions, devices, matchesQuery],
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshFromServer();
    } finally {
      setRefreshing(false);
    }
  };

  const goToTab = (index: number) => {
    setActiveTab(index);
    pagerRef.current?.scrollTo({ x: index * width, animated: true });
  };

  const onPagerScroll = (event: {
    nativeEvent: { contentOffset: { x: number } };
  }) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    if (index !== activeTab && index >= 0 && index < TABS.length) {
      setActiveTab(index);
    }
  };

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handleRefresh}
      tintColor={theme.colors.primary}
      colors={[theme.colors.primary]}
    />
  );

  return (
    <SafeAreaWrapper>
      <TopAppBar title="VibeCoding" subtitle="SESSIONS · TERMINALS" />
      <View style={styles.tabBar}>
        {TABS.map((tab, index) => {
          const active = activeTab === index;
          const activeStyle = active
            ? isDark
              ? styles.activeTabButtonDark
              : styles.activeTabButtonLight
            : null;
          return (
            <TouchableOpacity
              key={tab.key}
              activeOpacity={0.75}
              onPress={() => goToTab(index)}
              style={[
                styles.tabButton,
                activeStyle,
                {
                  borderColor: active
                    ? theme.colors.primary
                    : theme.colors.outlineVariant,
                },
              ]}>
              <Text
                style={[
                  theme.typography.labelMd,
                  {
                    color: active
                      ? theme.colors.primary
                      : theme.colors.onSurfaceVariant,
                  },
                ]}>
                {tab.title}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.searchContainer}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search sessions, terminals, directories..."
        />
      </View>

      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onPagerScroll}
        onMomentumScrollEnd={onPagerScroll}
        style={styles.pager}>
        {/* ---------- Page 1: Vibecoding sessions ---------- */}
        <View style={{ width }}>
          <ScrollView
            nestedScrollEnabled
            contentContainerStyle={styles.content}
            refreshControl={refreshControl}>
            <View style={styles.sectionHeader}>
              <Text
                style={[
                  theme.typography.labelCaps,
                  { color: theme.colors.onSurfaceVariant },
                ]}>
                VIBECODING SESSIONS
              </Text>
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => navigation.navigate('CreateVibeCoding', {})}>
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.primary },
                  ]}>
                  NEW TASK
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}>
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
                        backgroundColor: getFilterChipBackground(active, isDark),
                        borderColor: active
                          ? theme.colors.primary
                          : theme.colors.outlineVariant,
                      },
                    ]}>
                    <Text
                      style={[
                        theme.typography.labelSm,
                        {
                          color: active
                            ? theme.colors.primary
                            : theme.colors.onSurfaceVariant,
                        },
                      ]}>
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
                  filtered.filter(item => item.status === 'waiting_approval')
                    .length
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
            {!filtered.length ? (
              <Text
                style={[
                  theme.typography.bodySm,
                  { color: theme.colors.onSurfaceVariant },
                  styles.emptyText,
                ]}>
                没有匹配的 Vibecoding 会话。
              </Text>
            ) : null}
          </ScrollView>
        </View>

        {/* ---------- Page 2: Terminals ---------- */}
        <View style={{ width }}>
          <ScrollView
            nestedScrollEnabled
            contentContainerStyle={styles.content}
            refreshControl={refreshControl}>
            <View style={styles.sectionHeader}>
              <Text
                style={[
                  theme.typography.labelCaps,
                  { color: theme.colors.onSurfaceVariant },
                ]}>
                REMOTE TERMINALS
              </Text>
              <StatusChip
                label={`${activeTerminals.length} ACTIVE`}
                type="info"
              />
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
            {!activeTerminals.length ? (
              <Text
                style={[
                  theme.typography.bodySm,
                  { color: theme.colors.onSurfaceVariant },
                  styles.emptyText,
                ]}>
                没有进行中的远程终端。在设备页打开 Terminal 即可开始。
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  tabButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTabButtonLight: {
    backgroundColor: 'rgba(0, 81, 174, 0.1)',
  },
  activeTabButtonDark: {
    backgroundColor: 'rgba(86, 156, 214, 0.16)',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  pager: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    paddingTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
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
  emptyText: {
    paddingVertical: 12,
  },
});
