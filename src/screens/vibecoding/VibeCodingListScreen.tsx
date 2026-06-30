import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { DeferredMount } from '../../components/shared/DeferredMount';
import { StatusChip } from '../../components/shared/StatusChip';
import { VibeSessionCard } from '../../components/vibecoding/VibeSessionCard';
import { TerminalCard } from '../../components/terminals/TerminalCard';
import { VoiceToBashModal } from '../../components/terminal/VoiceToBashModal';
import { VibeStatus } from '../../data/platformModels';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore, useStableVibeRuns } from '../../store/controlCenterStore';
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
  const vibeRuns = useStableVibeRuns();
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
  const newTerminalDevice = useMemo(() => {
    const terminalEnabledDevices = devices.filter(
      device => device.remoteTerminalEnabled,
    );
    return (
      terminalEnabledDevices.find(device => device.status === 'online') ??
      terminalEnabledDevices[0] ??
      devices.find(device => device.status === 'online') ??
      devices[0]
    );
  }, [devices]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshFromServer();
    } finally {
      setRefreshing(false);
    }
  };

  const handleCreateTerminal = useCallback(() => {
    if (!newTerminalDevice) return;
    navigation.navigate('DeviceTerminal', {
      deviceId: newTerminalDevice.id,
      directory: newTerminalDevice.authorizedDirectories[0] ?? '~',
    });
  }, [navigation, newTerminalDevice]);

  // Voice → bash on the NEW TERM capsule: long-press records a spoken command,
  // the modal turns it into an editable bash line, and on confirm we open a
  // fresh terminal seeded with that command. Short tap (onPress) still creates
  // an empty terminal via handleCreateTerminal.
  const [voiceModal, setVoiceModal] = useState(false);
  const openVoiceModal = useCallback(() => {
    if (!newTerminalDevice) return;
    setVoiceModal(true);
  }, [newTerminalDevice]);
  const handleVoiceConfirm = useCallback(
    (command: string) => {
      setVoiceModal(false);
      if (!newTerminalDevice) return;
      navigation.navigate('DeviceTerminal', {
        deviceId: newTerminalDevice.id,
        directory: newTerminalDevice.authorizedDirectories[0] ?? '~',
        initialCommand: command,
      });
    },
    [navigation, newTerminalDevice],
  );

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

      <DeferredMount
        fallback={
          <View style={styles.deferredPlaceholder}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              正在加载会话…
            </Text>
          </View>
        }>
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
                disabled={isDeviceStatusOffline(
                  deviceStatusIndex.get(session.deviceId),
                )}
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
                {normalizedQuery
                  ? `没有匹配「${query}」的 Vibecoding 会话，换个关键词或清空搜索看看。`
                  : '还没有 Vibecoding 会话，点右上角 NEW TASK 创建一个。'}
              </Text>
            ) : null}
          </ScrollView>
        </View>

        {/* ---------- Page 2: Terminals ---------- */}
        <View style={{ width }}>
          <View style={styles.terminalPage}>
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
                <View style={styles.sectionHeaderRight}>
                  <StatusChip
                    label={`${activeTerminals.length} ACTIVE`}
                    type="info"
                  />
                </View>
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
                  {normalizedQuery
                    ? `没有匹配「${query}」的终端，换个关键词或清空搜索看看。`
                    : '没有进行中的远程终端。'}
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </ScrollView>
      </DeferredMount>

      {activeTab === 1 ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="New terminal"
          testID="new-term-fab"
          activeOpacity={0.85}
          disabled={!newTerminalDevice}
          onPress={handleCreateTerminal}
          onLongPress={openVoiceModal}
          style={[
            styles.newTermFab,
            { backgroundColor: theme.colors.primary },
            !newTerminalDevice ? styles.newTermFabDisabled : null,
          ]}>
          <Text
            style={[styles.newTermFabPlus, { color: theme.colors.onPrimary }]}>
            ＋
          </Text>
          <View
            style={[
              styles.newTermFabDivider,
              { backgroundColor: theme.colors.onPrimary },
            ]}
          />
          <Text
            style={[
              theme.typography.codeSm,
              styles.newTermFabLabel,
              { color: theme.colors.onPrimary },
            ]}>
            NEW
          </Text>
        </TouchableOpacity>
      ) : null}

      <VoiceToBashModal
        visible={voiceModal}
        mode="initial"
        deviceId={newTerminalDevice?.id ?? ''}
        cwd={newTerminalDevice?.authorizedDirectories?.[0] ?? '~'}
        deviceOs={newTerminalDevice?.os}
        onClose={() => setVoiceModal(false)}
        onConfirm={handleVoiceConfirm}
      />
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
  // Floating "NEW TERM" capsule — vertical, overlays the Terminals page, bottom-right.
  newTermFab: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 999,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  newTermFabDisabled: {
    opacity: 0.4,
  },
  newTermFabPlus: {
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 24,
  },
  newTermFabDivider: {
    width: 18,
    height: 1,
    marginVertical: 8,
    opacity: 0.45,
  },
  newTermFabLabel: {
    letterSpacing: 2,
    lineHeight: 16,
  },
  deferredPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    paddingTop: 4,
  },
  terminalPage: {
    flex: 1,
    position: 'relative',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 2,
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
