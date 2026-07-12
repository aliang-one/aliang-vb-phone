import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  interpolateColor,
  SharedValue,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { SearchBar } from '../../components/input/SearchBar';
import { DeferredMount } from '../../components/shared/DeferredMount';
import { StatusChip } from '../../components/shared/StatusChip';
import { ConnectionFailedCard } from '../../components/shared/ConnectionFailedCard';
import { VibeSessionCard } from '../../components/vibecoding/VibeSessionCard';
import { TerminalCard } from '../../components/terminals/TerminalCard';
import { VoiceToBashModal } from '../../components/terminal/VoiceToBashModal';
import type { DevicePickerEntry } from '../../components/terminal/DevicePicker';
import type { Device, VibeStatus } from '../../data/platformModels';
import { RootStackParamList } from '../../app/navigation/types';
import {
  useControlCenterStore,
  useStableVibeRuns,
} from '../../store/controlCenterStore';
import { isConnectionFailed } from '../../store/internals';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { useRefreshWithFeedback } from '../../hooks/useRefreshWithFeedback';
import { formatVibeSessionTitle } from '../../utils/vibeSessionTitle';
import { compareSessionsByStableActivity } from '../../utils/sessionPhase';
import {
  buildDeviceStatusIndex,
  isDeviceStatusOffline,
  offlineLastComparator,
} from '../../utils/deviceStatus';
import { isActiveTerminalSessionStatus } from '../../utils/terminalInteraction';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type HoldTimer = ReturnType<typeof setTimeout>;

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

type VibecodingTab =
  | { key: 'vibecoding'; title: string }
  | { key: 'terminals'; title: string };
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

const NEW_TERM_HOLD_MS = 900;
const NEW_TERM_HOLD_PREVIEW_DELAY_MS = 120;
const NEW_TERM_FAB_WIDTH = 64;
const NEW_TERM_FAB_HEIGHT = 104;
const TERMINAL_DEVICE_PAGE_SIZE = 5;

type ProgressValue = SharedValue<number>;

const canCreateTerminalOnDevice = (device?: Device) =>
  Boolean(device?.remoteTerminalEnabled && device.status === 'online');

const sortTerminalDeviceChoices = (left: Device, right: Device) => {
  return left.name.localeCompare(right.name);
};

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
      color: interpolateColor(
        a,
        [0, 1],
        [theme.colors.onSurfaceVariant, primary],
      ),
      opacity: interpolate(a, [0, 1], [0.7, 1]),
      transform: [{ scale: interpolate(a, [0, 1], [0.95, 1]) }],
    };
  });

  const countStyle = useAnimatedStyle(() => {
    const a = Math.max(0, Math.min(1, 1 - Math.abs(progress.value - index)));
    return {
      color: interpolateColor(
        a,
        [0, 1],
        [theme.colors.onSurfaceVariant, primary],
      ),
      opacity: interpolate(a, [0, 1], [0.4, 0.85]),
    };
  });

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={styles.tabButton}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
    >
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
          style={[theme.typography.labelMd, styles.tabTitle, titleStyle]}
        >
          {title}
        </Animated.Text>
        <Animated.Text
          style={[theme.typography.codeSm, styles.tabCount, countStyle]}
        >
          {count}
        </Animated.Text>
      </View>
    </TouchableOpacity>
  );
};

export const VibeCodingListScreen: React.FC = () => {
  const { t } = useTranslation('vibecoding');
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { width } = useWindowDimensions();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const vibeRuns = useStableVibeRuns();
  const serverMode = useControlCenterStore(state => state.serverMode);
  const lastSyncedAt = useControlCenterStore(state => state.lastSyncedAt);
  const lastConnectError = useControlCenterStore(
    state => state.lastConnectError,
  );
  const connectionFailed = isConnectionFailed(
    serverMode,
    lastSyncedAt,
    lastConnectError,
  );
  const terminalSessions = useControlCenterStore(
    state => state.terminalSessions,
  );
  const stopTerminal = useControlCenterStore(state => state.stopTerminal);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | VibeStatus>('all');
  const { refreshing, handleRefresh } = useRefreshWithFeedback();
  const [activeTab, setActiveTab] = useState(0);
  const [terminalDevicePickerOpen, setTerminalDevicePickerOpen] =
    useState(false);
  const [terminalDevicePage, setTerminalDevicePage] = useState(0);
  const pagerRef = useRef<ScrollView>(null);
  const holdTimerRef = useRef<HoldTimer | null>(null);
  const holdPreviewTimerRef = useRef<HoldTimer | null>(null);
  const holdTriggeredRef = useRef(false);

  // Folder-tab activeness driven directly by the horizontal pager's scroll
  // offset, so each tab's card lifts/fades in real time as you swipe (and
  // follows the animated scrollTo on tap) — single source of truth.
  const progress = useSharedValue(0);
  const newTermHoldProgress = useSharedValue(0);
  const newTermHoldVisual = useSharedValue(0);

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
            compareSessionsByStableActivity,
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
        .sort((a, b) => (b.terminal.updatedAt > a.terminal.updatedAt ? 1 : -1)),
    [terminalSessions, devices, matchesQuery],
  );
  const terminalDeviceChoices = useMemo(
    () =>
      devices.filter(canCreateTerminalOnDevice).sort(sortTerminalDeviceChoices),
    [devices],
  );
  const newTerminalDevice = terminalDeviceChoices[0];
  // Entries for the voice→bash confirm-step device picker (online + terminal-enabled).
  const voiceSelectableDevices: DevicePickerEntry[] = useMemo(
    () =>
      terminalDeviceChoices.map(d => ({
        id: d.id,
        name: d.name,
        platform: d.os,
        online: d.status === 'online',
        cwd: d.authorizedDirectories[0] ?? '~',
      })),
    [terminalDeviceChoices],
  );
  const terminalDevicePageCount = Math.max(
    1,
    Math.ceil(terminalDeviceChoices.length / TERMINAL_DEVICE_PAGE_SIZE),
  );
  const terminalDevicePickerHasPages =
    terminalDeviceChoices.length > TERMINAL_DEVICE_PAGE_SIZE;
  const pagedTerminalDeviceChoices = useMemo(
    () =>
      terminalDeviceChoices.slice(
        terminalDevicePage * TERMINAL_DEVICE_PAGE_SIZE,
        terminalDevicePage * TERMINAL_DEVICE_PAGE_SIZE +
          TERMINAL_DEVICE_PAGE_SIZE,
      ),
    [terminalDeviceChoices, terminalDevicePage],
  );
  const devicePickerWidth = Math.min(328, Math.max(264, width - 96));
  const [voiceDevice, setVoiceDevice] = useState<Device | undefined>();
  const voiceTargetDevice = voiceDevice ?? newTerminalDevice;

  const clearNewTermHold = useCallback(
    (resetTrigger = false) => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      if (holdPreviewTimerRef.current) {
        clearTimeout(holdPreviewTimerRef.current);
        holdPreviewTimerRef.current = null;
      }
      if (resetTrigger) {
        holdTriggeredRef.current = false;
      }
      cancelAnimation(newTermHoldProgress);
      cancelAnimation(newTermHoldVisual);
      newTermHoldProgress.value = 0;
      newTermHoldVisual.value = 0;
    },
    [newTermHoldProgress, newTermHoldVisual],
  );

  useEffect(
    () => () => {
      clearNewTermHold(true);
    },
    [clearNewTermHold],
  );

  useEffect(() => {
    setTerminalDevicePage(page =>
      Math.min(page, Math.max(0, terminalDevicePageCount - 1)),
    );
  }, [terminalDevicePageCount]);

  const newTermHoldChargeStyle = useAnimatedStyle(() => {
    const hold = Math.max(0, Math.min(1, newTermHoldProgress.value));
    const visible = Math.max(0, Math.min(1, newTermHoldVisual.value));
    return {
      opacity: interpolate(hold, [0, 0.18, 1], [0, 0.14, 0.32]) * visible,
      transform: [
        {
          translateY: interpolate(hold, [0, 1], [NEW_TERM_FAB_HEIGHT, 0]),
        },
      ],
    };
  });

  const newTermHoldGlowStyle = useAnimatedStyle(() => {
    const hold = Math.max(0, Math.min(1, newTermHoldProgress.value));
    const visible = Math.max(0, Math.min(1, newTermHoldVisual.value));
    return {
      opacity: interpolate(hold, [0, 0.4, 1], [0, 0.22, 0.5]) * visible,
      transform: [{ scale: interpolate(hold, [0, 1], [0.96, 1.02]) }],
    };
  });

  const newTermHoldRingStyle = useAnimatedStyle(() => {
    const hold = Math.max(0, Math.min(1, newTermHoldProgress.value));
    const visible = Math.max(0, Math.min(1, newTermHoldVisual.value));
    return {
      opacity: interpolate(hold, [0, 0.3, 1], [0, 0.28, 0.62]) * visible,
      transform: [{ scale: interpolate(hold, [0, 1], [0.94, 1]) }],
    };
  });

  const newTermHoldScanStyle = useAnimatedStyle(() => {
    const hold = Math.max(0, Math.min(1, newTermHoldProgress.value));
    const visible = Math.max(0, Math.min(1, newTermHoldVisual.value));
    return {
      opacity:
        interpolate(hold, [0, 0.2, 0.82, 1], [0, 0.38, 0.58, 0]) * visible,
      transform: [
        {
          translateY: interpolate(
            hold,
            [0, 1],
            [NEW_TERM_FAB_HEIGHT - 18, 16],
          ),
        },
      ],
    };
  });

  const handleCreateTerminal = useCallback(
    (device: Device) => {
      if (!canCreateTerminalOnDevice(device)) return;
      setTerminalDevicePickerOpen(false);
      setTerminalDevicePage(0);
      navigation.navigate('DeviceTerminal', {
        deviceId: device.id,
        directory: device.authorizedDirectories[0] ?? '~',
      });
    },
    [navigation],
  );

  // Voice → bash on the NEW TERM capsule: a completed hold opens the command
  // dialog; short tap opens device choice so a fresh terminal starts on the
  // selected device.
  const [voiceModal, setVoiceModal] = useState(false);
  const openVoiceModal = useCallback((device: Device) => {
    setVoiceDevice(device);
    setTerminalDevicePickerOpen(false);
    setTerminalDevicePage(0);
    setVoiceModal(true);
  }, []);
  const closeVoiceModal = useCallback(() => {
    setVoiceModal(false);
    setVoiceDevice(undefined);
  }, []);
  const handleVoiceConfirm = useCallback(
    (command: string, deviceId?: string, cwd?: string) => {
      setVoiceModal(false);
      const targetDevice = voiceTargetDevice;
      setVoiceDevice(undefined);
      // Prefer the AI-chosen device/cwd (if any), else the pre-picked default.
      const chosenDeviceId = deviceId ?? targetDevice?.id;
      const chosenCwd = cwd ?? targetDevice?.authorizedDirectories?.[0] ?? '~';
      if (!chosenDeviceId) return;
      navigation.navigate('DeviceTerminal', {
        deviceId: chosenDeviceId,
        directory: chosenCwd,
        initialCommand: command,
      });
    },
    [navigation, voiceTargetDevice],
  );

  const handleNewTermPressIn = useCallback(() => {
    if (!newTerminalDevice) return;
    holdTriggeredRef.current = false;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
    }
    if (holdPreviewTimerRef.current) {
      clearTimeout(holdPreviewTimerRef.current);
    }
    newTermHoldProgress.value = 0;
    newTermHoldVisual.value = 0;
    newTermHoldProgress.value = withTiming(1, {
      duration: NEW_TERM_HOLD_MS,
      easing: Easing.linear,
    });
    holdPreviewTimerRef.current = setTimeout(() => {
      holdPreviewTimerRef.current = null;
      newTermHoldVisual.value = withTiming(1, {
        duration: 140,
        easing: Easing.out(Easing.cubic),
      });
    }, NEW_TERM_HOLD_PREVIEW_DELAY_MS);
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      holdTriggeredRef.current = true;
      cancelAnimation(newTermHoldProgress);
      cancelAnimation(newTermHoldVisual);
      newTermHoldProgress.value = 0;
      newTermHoldVisual.value = 0;
      openVoiceModal(newTerminalDevice);
    }, NEW_TERM_HOLD_MS);
  }, [
    newTerminalDevice,
    newTermHoldProgress,
    newTermHoldVisual,
    openVoiceModal,
  ]);

  const handleNewTermPressOut = useCallback(() => {
    if (holdTriggeredRef.current) return;
    clearNewTermHold();
  }, [clearNewTermHold]);

  const handleNewTermPress = useCallback(() => {
    if (holdTriggeredRef.current) {
      holdTriggeredRef.current = false;
      return;
    }
    if (!newTerminalDevice) return;
    setTerminalDevicePickerOpen(value => {
      const nextValue = !value;
      if (nextValue) {
        setTerminalDevicePage(0);
      }
      return nextValue;
    });
  }, [newTerminalDevice]);

  const goToTab = (index: number) => {
    setActiveTab(index);
    setTerminalDevicePickerOpen(false);
    setTerminalDevicePage(0);
    clearNewTermHold(true);
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
        ]}
      >
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
          placeholder={t('listScreen.searchPlaceholder')}
        />
      </View>

      <DeferredMount
        fallback={
          <View style={styles.deferredPlaceholder}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {t('listScreen.loading')}
            </Text>
          </View>
        }
      >
        {connectionFailed ? (
          <ConnectionFailedCard error={lastConnectError} onRetry={handleRefresh} />
        ) : null}
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onPagerScroll}
          onMomentumScrollEnd={onPagerScroll}
          style={styles.pager}
        >
          {/* ---------- Page 1: Vibecoding sessions ---------- */}
          <View style={{ width }}>
            <ScrollView
              nestedScrollEnabled
              contentContainerStyle={styles.content}
              refreshControl={refreshControl}
            >
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
                    style={[
                      theme.typography.codeSm,
                      { color: theme.colors.primary },
                    ]}
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
                          backgroundColor: getFilterChipBackground(
                            active,
                            isDark,
                          ),
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
                    filtered.filter(item => item.status === 'waiting_approval')
                      .length
                  } APPROVAL`}
                  type="warning"
                />
                <StatusChip
                  label={`${
                    filtered.filter(item => item.previewId).length
                  } PREVIEWS`}
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
                  ]}
                >
                  {normalizedQuery
                    ? t('listScreen.emptySessionsQuery', { query })
                    : t('listScreen.emptySessions')}
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
                refreshControl={refreshControl}
              >
                <View style={styles.sectionHeader}>
                  <Text
                    style={[
                      theme.typography.labelCaps,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
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
                    ]}
                  >
                    {normalizedQuery
                      ? t('listScreen.emptyTerminalsQuery', { query })
                      : t('listScreen.emptyTerminals')}
                  </Text>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </ScrollView>
      </DeferredMount>

      {activeTab === 1 && terminalDevicePickerOpen ? (
        <Pressable
          testID="new-term-device-picker-backdrop"
          style={styles.devicePickerBackdrop}
          onPress={() => {
            setTerminalDevicePickerOpen(false);
            setTerminalDevicePage(0);
          }}
        />
      ) : null}

      {activeTab === 1 && terminalDevicePickerOpen ? (
        <View
          testID="new-term-device-picker"
          style={[
            styles.newTermDevicePicker,
            { width: devicePickerWidth },
            {
              backgroundColor: isDark
                ? theme.colors.surfaceContainerHigh
                : theme.colors.surfaceContainerLowest,
              borderColor: isDark
                ? 'rgba(255,255,255,0.12)'
                : theme.colors.outlineVariant,
            },
          ]}
        >
          <View style={styles.devicePickerHeader}>
            <Text
              numberOfLines={1}
              style={[
                theme.typography.labelCaps,
                styles.devicePickerTitle,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              ONLINE TARGETS
            </Text>
            <View style={styles.devicePickerHeaderRight}>
              {terminalDevicePickerHasPages ? (
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {terminalDevicePage + 1}/{terminalDevicePageCount}
                </Text>
              ) : null}
              <StatusChip
                label={`${terminalDeviceChoices.length} READY`}
                type="success"
                style={styles.devicePickerReadyChip}
              />
            </View>
          </View>
          <View style={styles.devicePickerSubhead}>
            <View
              style={[
                styles.devicePickerRadarDot,
                { backgroundColor: theme.colors.primary },
              ]}
            />
            <Text
              numberOfLines={1}
              style={[
                theme.typography.codeSm,
                styles.devicePickerHint,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              Pick a live machine for the new shell
            </Text>
          </View>
          <View style={styles.devicePickerList}>
            {terminalDeviceChoices.length ? (
              pagedTerminalDeviceChoices.map((device, index) => {
                const displayIndex =
                  terminalDevicePage * TERMINAL_DEVICE_PAGE_SIZE + index + 1;
                return (
                  <Pressable
                    key={device.id}
                    testID={`new-term-device-${device.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Create terminal on ${device.name}`}
                    onPress={() => handleCreateTerminal(device)}
                    style={({ pressed }) => [
                      styles.deviceChoice,
                      {
                        borderRadius: theme.borderRadius.md,
                        backgroundColor: pressed
                          ? getActiveChipBackground(isDark)
                          : isDark
                          ? 'rgba(255,255,255,0.045)'
                          : theme.colors.surfaceContainerLow,
                        borderColor: pressed
                          ? theme.colors.primary
                          : `${theme.colors.primary}44`,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.deviceChoiceMarker,
                        {
                          borderColor: `${theme.colors.primary}66`,
                          backgroundColor: getActiveChipBackground(isDark),
                        },
                      ]}
                    >
                      <Text
                        style={[
                          theme.typography.codeSm,
                          styles.deviceChoiceIndex,
                          { color: theme.colors.primary },
                        ]}
                      >
                        {displayIndex}
                      </Text>
                      <View
                        style={[
                          styles.deviceChoicePulse,
                          { backgroundColor: theme.colors.primary },
                        ]}
                      />
                    </View>
                    <View style={styles.deviceChoiceCopy}>
                      <Text
                        numberOfLines={1}
                        style={[
                          theme.typography.labelMd,
                          styles.deviceChoiceName,
                          { color: theme.colors.onSurface },
                        ]}
                      >
                        {device.name}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          theme.typography.codeSm,
                          styles.deviceChoiceMeta,
                          { color: theme.colors.onSurfaceVariant },
                        ]}
                      >
                        {device.authorizedDirectories[0] ??
                          device.host ??
                          device.id}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.deviceChoiceLaunch,
                        {
                          borderColor: `${theme.colors.primary}44`,
                          backgroundColor: getActiveChipBackground(isDark),
                        },
                      ]}
                    >
                      <Text
                        style={[
                          theme.typography.codeSm,
                          styles.deviceChoiceLaunchText,
                          { color: theme.colors.primary },
                        ]}
                      >
                        ›
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <Text
                style={[
                  theme.typography.bodySm,
                  styles.devicePickerEmpty,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                No devices available.
              </Text>
            )}
          </View>
          {terminalDevicePickerHasPages ? (
            <View style={styles.devicePickerPager}>
              <Pressable
                testID="new-term-device-prev"
                accessibilityRole="button"
                accessibilityLabel="Previous terminal device page"
                disabled={terminalDevicePage === 0}
                onPress={() =>
                  setTerminalDevicePage(page => Math.max(0, page - 1))
                }
                style={({ pressed }) => [
                  styles.devicePickerPageButton,
                  {
                    borderColor:
                      terminalDevicePage === 0
                        ? theme.colors.outlineVariant
                        : `${theme.colors.primary}66`,
                    backgroundColor: pressed
                      ? getActiveChipBackground(isDark)
                      : 'transparent',
                    opacity: terminalDevicePage === 0 ? 0.4 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    theme.typography.labelMd,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  ‹
                </Text>
              </Pressable>
              <View
                style={[
                  styles.devicePickerPageTrack,
                  { backgroundColor: theme.colors.outlineVariant },
                ]}
              >
                <View
                  style={[
                    styles.devicePickerPageFill,
                    {
                      width: `${
                        ((terminalDevicePage + 1) / terminalDevicePageCount) *
                        100
                      }%`,
                      backgroundColor: theme.colors.primary,
                    },
                  ]}
                />
              </View>
              <Pressable
                testID="new-term-device-next"
                accessibilityRole="button"
                accessibilityLabel="Next terminal device page"
                disabled={terminalDevicePage >= terminalDevicePageCount - 1}
                onPress={() =>
                  setTerminalDevicePage(page =>
                    Math.min(terminalDevicePageCount - 1, page + 1),
                  )
                }
                style={({ pressed }) => [
                  styles.devicePickerPageButton,
                  {
                    borderColor:
                      terminalDevicePage >= terminalDevicePageCount - 1
                        ? theme.colors.outlineVariant
                        : `${theme.colors.primary}66`,
                    backgroundColor: pressed
                      ? getActiveChipBackground(isDark)
                      : 'transparent',
                    opacity:
                      terminalDevicePage >= terminalDevicePageCount - 1
                        ? 0.4
                        : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    theme.typography.labelMd,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  ›
                </Text>
              </Pressable>
            </View>
          ) : null}
          <View
            pointerEvents="none"
            style={[
              styles.devicePickerNub,
              {
                backgroundColor: isDark
                  ? theme.colors.surfaceContainerHigh
                  : theme.colors.surfaceContainerLowest,
                borderColor: isDark
                  ? 'rgba(255,255,255,0.12)'
                  : theme.colors.outlineVariant,
              },
            ]}
          />
        </View>
      ) : null}

      {activeTab === 1 ? (
        <View
          style={[
            styles.newTermFabShadow,
            !newTerminalDevice ? styles.newTermFabDisabled : null,
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New terminal"
            testID="new-term-fab"
            disabled={!newTerminalDevice}
            onPressIn={handleNewTermPressIn}
            onPressOut={handleNewTermPressOut}
            onPress={handleNewTermPress}
            style={[
              styles.newTermFab,
              { backgroundColor: theme.colors.primary },
            ]}
          >
            <Animated.View
              pointerEvents="none"
              style={[
                styles.newTermHoldGlow,
                {
                  backgroundColor: isDark
                    ? theme.colors.inversePrimary
                    : theme.colors.primaryContainer,
                },
                newTermHoldGlowStyle,
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.newTermHoldCharge,
                {
                  backgroundColor: isDark
                    ? theme.colors.inversePrimary
                    : theme.colors.primaryContainer,
                },
                newTermHoldChargeStyle,
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.newTermHoldRing,
                { borderColor: theme.colors.inversePrimary },
                newTermHoldRingStyle,
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.newTermHoldScan,
                { backgroundColor: theme.colors.inversePrimary },
                newTermHoldScanStyle,
              ]}
            />
            <View pointerEvents="none" style={styles.newTermFabContent}>
              <Text
                style={[
                  styles.newTermFabPlus,
                  { color: theme.colors.onPrimary },
                ]}
              >
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
                ]}
              >
                NEW
              </Text>
            </View>
          </Pressable>
        </View>
      ) : null}

      <VoiceToBashModal
        visible={voiceModal}
        mode="initial"
        deviceId={voiceTargetDevice?.id ?? ''}
        cwd={voiceTargetDevice?.authorizedDirectories?.[0] ?? '~'}
        deviceOs={voiceTargetDevice?.os}
        selectableDevices={voiceSelectableDevices}
        onClose={closeVoiceModal}
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
  devicePickerBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 7,
  },
  newTermDevicePicker: {
    position: 'absolute',
    right: 90,
    bottom: 18,
    maxHeight: 432,
    padding: 12,
    borderWidth: 1,
    borderRadius: 16,
    gap: 10,
    zIndex: 8,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 16,
  },
  devicePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 2,
  },
  devicePickerTitle: {
    flex: 1,
  },
  devicePickerHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 8,
  },
  devicePickerReadyChip: {
    flexShrink: 0,
  },
  devicePickerSubhead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
    minHeight: 18,
  },
  devicePickerRadarDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    opacity: 0.85,
  },
  devicePickerHint: {
    flex: 1,
    minWidth: 0,
  },
  devicePickerList: {
    gap: 8,
  },
  deviceChoice: {
    height: 64,
    paddingHorizontal: 9,
    paddingVertical: 9,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    overflow: 'hidden',
  },
  deviceChoiceMarker: {
    width: 36,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceChoiceIndex: {
    fontWeight: '700',
    lineHeight: 16,
  },
  deviceChoicePulse: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  deviceChoiceCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  deviceChoiceName: {
    fontWeight: '600',
  },
  deviceChoiceMeta: {
    lineHeight: 15,
  },
  deviceChoiceLaunch: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceChoiceLaunchText: {
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '700',
  },
  devicePickerEmpty: {
    paddingVertical: 8,
  },
  devicePickerPager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 2,
  },
  devicePickerPageButton: {
    width: 34,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  devicePickerPageTrack: {
    flex: 1,
    minWidth: 0,
    height: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  devicePickerPageFill: {
    height: 3,
    borderRadius: 999,
  },
  devicePickerNub: {
    position: 'absolute',
    right: -7,
    bottom: 42,
    width: 14,
    height: 14,
    borderTopWidth: 1,
    borderRightWidth: 1,
    transform: [{ rotate: '45deg' }],
  },
  // Floating "NEW TERM" capsule — vertical, overlays the Terminals page, bottom-right.
  newTermFabShadow: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    width: NEW_TERM_FAB_WIDTH,
    height: NEW_TERM_FAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    zIndex: 9,
  },
  newTermFabDisabled: {
    opacity: 0.4,
  },
  newTermFab: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    overflow: 'hidden',
  },
  newTermHoldGlow: {
    position: 'absolute',
    top: 10,
    right: 10,
    bottom: 10,
    left: 10,
    borderRadius: 999,
    zIndex: 0,
  },
  newTermHoldCharge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: NEW_TERM_FAB_HEIGHT,
    zIndex: 0,
  },
  newTermHoldRing: {
    position: 'absolute',
    top: 6,
    right: 6,
    bottom: 6,
    left: 6,
    borderRadius: 999,
    borderWidth: 1,
    zIndex: 1,
  },
  newTermHoldScan: {
    position: 'absolute',
    left: 11,
    right: 11,
    height: 2,
    borderRadius: 999,
    zIndex: 1,
  },
  newTermFabContent: {
    width: NEW_TERM_FAB_WIDTH,
    height: NEW_TERM_FAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.001)',
    zIndex: 2,
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
    letterSpacing: 0,
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
