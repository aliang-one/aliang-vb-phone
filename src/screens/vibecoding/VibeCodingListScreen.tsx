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
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  interpolateColor,
  SharedValue,
} from 'react-native-reanimated';
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

// Light-mode elevation for the sliding indicator (dark mode uses theme glow).
const INDICATOR_LIGHT_SHADOW = {
  shadowColor: '#0B1F3A',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.18,
  shadowRadius: 3,
  elevation: 2,
};

type ProgressValue = SharedValue<number>;

interface SegmentedTabProps {
  progress: ProgressValue;
  index: number;
  title: string;
  count: number;
  onPress: () => void;
}

// A single folder-tab. Its card lifts up (top shrinks while the bottom stays
// glued to the baseline, so it reads as a folder divider rising, not a block
// floating free) and cross-fades color as the shared `progress` glides past.
const SegmentedTab: React.FC<SegmentedTabProps> = ({
  progress,
  index,
  title,
  count,
  onPress,
}) => {
  const { theme, isDark } = useTheme();
  const fill = isDark ? 'rgba(86, 156, 214, 0.16)' : 'rgba(0, 81, 174, 0.09)';
  const primary = theme.colors.primary;

  // The card itself: rounded top corners, sits on the baseline, grows taller
  // (top: 16 → 2) as it activates. Bottom edge is open so it fuses with the
  // shared baseline — the folder-tab silhouette.
  const fillStyle = useAnimatedStyle(() => {
    const a = Math.max(0, Math.min(1, 1 - Math.abs(progress.value - index)));
    return {
      top: interpolate(a, [0, 1], [16, 2]),
      opacity: a,
      backgroundColor: interpolateColor(a, [0, 1], ['rgba(0,0,0,0)', fill]),
      borderColor: interpolateColor(a, [0, 1], [`${primary}00`, primary]),
    };
  });

  const titleStyle = useAnimatedStyle(() => {
    const a = Math.max(0, Math.min(1, 1 - Math.abs(progress.value - index)));
    return {
      color: interpolateColor(a, [0, 1], [
        theme.colors.onSurfaceVariant,
        primary,
      ]),
      opacity: interpolate(a, [0, 1], [0.7, 1]),
      transform: [{ scale: interpolate(a, [0, 1], [0.95, 1]) }],
    };
  });

  const countStyle = useAnimatedStyle(() => {
    const a = Math.max(0, Math.min(1, 1 - Math.abs(progress.value - index)));
    return {
      color: interpolateColor(a, [0, 1], [
        theme.colors.onSurfaceVariant,
        primary,
      ]),
      opacity: interpolate(a, [0, 1], [0.4, 0.85]),
    };
  });

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={styles.tabButton}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.tabFill,
          fillStyle,
          isDark ? theme.glow.primary : INDICATOR_LIGHT_SHADOW,
        ]}
      />
      <View style={styles.tabContent}>
        <Animated.Text
          style={[theme.typography.labelMd, styles.tabTitle, titleStyle]}>
          {title}
        </Animated.Text>
        <Animated.Text
          style={[theme.typography.codeSm, styles.tabCount, countStyle]}>
          {count}
        </Animated.Text>
      </View>
    </TouchableOpacity>
  );
};

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

  // Folder-tab activeness driven directly by the horizontal pager's scroll
  // offset, so each tab's card lifts/fades in real time as you swipe (and
  // follows the animated scrollTo on tap) — single source of truth.
  const progress = useSharedValue(0);

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
    // progress updates via onScroll while the pager animates — keeps the
    // indicator perfectly in sync with the page glide.
    pagerRef.current?.scrollTo({ x: index * width, animated: true });
  };

  const onPagerScroll = (event: {
    nativeEvent: { contentOffset: { x: number } };
  }) => {
    const offset = event.nativeEvent.contentOffset.x;
    progress.value = offset / width;
    const index = Math.round(offset / width);
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
      <View
        style={[
          styles.tabBarContainer,
          {
            borderBottomColor: isDark
              ? `${theme.colors.primary}66`
              : theme.colors.outlineVariant,
          },
        ]}>
        {TABS.map((tab, index) => (
          <SegmentedTab
            key={tab.key}
            progress={progress}
            index={index}
            title={tab.title}
            count={index === 0 ? filtered.length : activeTerminals.length}
            onPress={() => goToTab(index)}
          />
        ))}
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
  tabBarContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 10,
    paddingTop: 8,
    height: 52,
    borderBottomWidth: 2,
    position: 'relative',
  },
  tabButton: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 9,
  },
  tabFill: {
    position: 'absolute',
    bottom: 0,
    left: 5,
    right: 5,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    borderWidth: 1,
    borderBottomWidth: 0,
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  tabCount: {
    fontSize: 11,
    fontWeight: '700',
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
