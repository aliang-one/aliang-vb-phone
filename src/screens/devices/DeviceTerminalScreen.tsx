import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  LayoutAnimation,
  ActivityIndicator,
  Keyboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  UIManager,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { StatusChip } from '../../components/shared/StatusChip';
import {
  TerminalEmulator,
  TerminalEmulatorHandle,
} from '../../components/terminal/TerminalEmulator';
import { useTheme } from '../../theme/useTheme';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';
import {
  getTerminalInteractionState,
  getTerminalStatusChip,
} from '../../utils/terminalInteraction';
import {
  createTerminalKeyboardProxyState,
  markTerminalKeyboardProxyInputReset,
  resetTerminalKeyboardProxyInput,
  TERMINAL_KEYBOARD_PROXY_SELECTION,
  TERMINAL_KEYBOARD_PROXY_VALUE,
  terminalKeyboardProxyChangeAction,
  terminalKeyboardProxyKeyAction,
} from '../../utils/terminalKeyboardProxy';
import { buildTerminalSuggestions } from '../../utils/terminalSuggestions';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type DeviceTerminalRoute = RouteProp<RootStackParamList, 'DeviceTerminal'>;

const DIRECTORY_TILE_WIDTH = 74;
const DIRECTORY_TILE_GAP = 10;

const shortDirectoryName = (path: string) => {
  const normalized = path.replace(/[\\/]+$/g, '');
  if (!normalized || normalized === '~') return '~';
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
};

const terminalKeyBytes: Record<string, string> = {
  Esc: '\x1b',
  Tab: '\x09',
  Enter: '\r',
  Backspace: '\x7f',
  'Ctrl+C': '\x03',
  'Ctrl+D': '\x04',
  Up: '\x1b[A',
  Down: '\x1b[B',
  Left: '\x1b[D',
  Right: '\x1b[C',
};

const FolderGlyph: React.FC<{
  active: boolean;
  activeFill: string;
  activeStroke: string;
  inactiveFill: string;
  inactiveStroke: string;
}> = ({ active, activeFill, activeStroke, inactiveFill, inactiveStroke }) => (
  <Svg width={28} height={24} viewBox="0 0 28 24">
    <Path
      d="M2.5 7.5h8.2l2.2 2.5h12.6v9.2c0 1.4-1.1 2.5-2.5 2.5H5c-1.4 0-2.5-1.1-2.5-2.5V7.5Z"
      fill={active ? activeFill : inactiveFill}
      stroke={active ? activeStroke : inactiveStroke}
      strokeWidth={1.4}
      strokeLinejoin="round"
    />
    <Path
      d="M2.5 7.5V5.8c0-1.4 1.1-2.5 2.5-2.5h6.2l2.2 2.5h9.2c1.4 0 2.5 1.1 2.5 2.5V10"
      fill={active ? activeFill : inactiveFill}
      stroke={active ? activeStroke : inactiveStroke}
      strokeWidth={1.4}
      strokeLinejoin="round"
    />
  </Svg>
);

const EnterDirectoryIcon: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={18} height={18} viewBox="0 0 18 18">
    <Path
      d="M6.2 3.8H4.8c-1.1 0-2 .9-2 2v6.4c0 1.1.9 2 2 2h1.4"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
    />
    <Path
      d="M8 9h7M12.4 5.8 15.6 9l-3.2 3.2"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const TopStatusShape: React.FC<{
  fill: string;
  stroke: string;
  accent: string;
  muted: string;
}> = ({ fill, stroke, accent, muted }) => (
  <Svg
    pointerEvents="none"
    width="100%"
    height="100%"
    viewBox="0 0 360 214"
    preserveAspectRatio="none"
    style={StyleSheet.absoluteFill}
  >
    <Path
      d="M10 1H128C146 1 156 8 164 24L178 52C185 67 198 75 216 75H334C348 75 359 86 359 100V203C359 209 354 213 348 213H12C6 213 1 208 1 202V10C1 5 5 1 10 1Z"
      fill={fill}
      stroke={stroke}
      strokeWidth={1}
    />
    <Path
      d="M17 146C67 123 111 121 148 137C180 151 208 151 240 136C275 120 310 121 343 139"
      stroke={muted}
      strokeWidth={1}
      fill="none"
    />
    <Path
      d="M210 74C191 74 181 66 173 50L160 24"
      stroke={accent}
      strokeWidth={1.2}
      fill="none"
    />
  </Svg>
);

const PENDING_KEYBOARD_LIFT_INSET = 300;
export const getTerminalProxyKeyboardType = (os: typeof Platform.OS) =>
  os === 'android' ? 'visible-password' : 'ascii-capable';
const TERMINAL_PROXY_KEYBOARD_TYPE = getTerminalProxyKeyboardType(Platform.OS);
const testIdSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const DeviceTerminalScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<DeviceTerminalRoute>();
  const terminalBridgeRef = useRef<TerminalEmulatorHandle | null>(null);
  const keyboardProxyRef = useRef<TextInput>(null);
  const keyboardProxyStateRef = useRef(createTerminalKeyboardProxyState());
  const keyboardProxyFocusRetryRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const keyboardInsetCacheRef = useRef(0);
  const directoryPathRef = useRef<ScrollView>(null);
  const devices = useControlCenterStore(state => state.devices);
  const terminalSessions = useControlCenterStore(
    state => state.terminalSessions,
  );
  const createTerminalSession = useControlCenterStore(
    state => state.createTerminalSession,
  );
  const terminalCommandHistory = useControlCenterStore(
    state => state.terminalCommandHistory,
  );
  const loadTerminalCommandHistory = useControlCenterStore(
    state => state.loadTerminalCommandHistory,
  );
  const serverMode = useControlCenterStore(state => state.serverMode);
  const [terminalId, setTerminalId] = useState(route.params.terminalId);
  const [terminalOpening, setTerminalOpening] = useState(false);
  const [renderedTerminalId, setRenderedTerminalId] = useState(
    route.params.terminalId ?? '',
  );
  const [terminalRenderError, setTerminalRenderError] = useState<{
    sessionId: string;
    message: string;
  } | null>(null);
  const [keyboardProxyFocused, setKeyboardProxyFocused] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [floatingControlsHeight, setFloatingControlsHeight] = useState(0);
  const quickDirectoryInitializedRef = useRef(Boolean(route.params.directory));
  const [focusedDirectory, setFocusedDirectory] = useState(
    route.params.directory ?? '~',
  );
  const [currentQuickDirectory, setCurrentQuickDirectory] = useState(
    route.params.directory ?? '',
  );
  const device = devices.find(item => item.id === route.params.deviceId);
  const terminal = terminalSessions.find(item => item.id === terminalId);
  const directory = terminal?.directory ?? route.params.directory ?? '~';
  const terminalInteraction = getTerminalInteractionState({
    terminalStatus: terminal?.status,
    deviceStatus: device?.status,
    terminalOpening,
  });
  const terminalStatusChip = getTerminalStatusChip(terminal?.status);
  const availableDirectories = useMemo(() => {
    const base = device?.authorizedDirectories ?? [];
    const merged = [...base, directory].filter(Boolean);
    return Array.from(new Set(merged));
  }, [device?.authorizedDirectories, directory]);
  const visibleDirectory = availableDirectories.includes(focusedDirectory)
    ? focusedDirectory
    : directory;
  const aiSuggestions = useMemo(() => {
    const sessionHistory = terminal
      ? terminalCommandHistory[`session:${terminal.id}`] ?? []
      : [];
    const deviceHistory = device
      ? terminalCommandHistory[`device:${device.id}`] ?? []
      : [];

    return buildTerminalSuggestions({
      directory,
      history: [...sessionHistory, ...deviceHistory],
      max: 4,
    });
  }, [device, directory, terminal, terminalCommandHistory]);
  const surfaceColor = isDark
    ? 'rgba(255,255,255,0.04)'
    : theme.colors.surfaceContainerLow;
  const elevatedSurfaceColor = isDark
    ? 'rgba(255,255,255,0.06)'
    : theme.colors.surfaceContainerLowest;
  const recessedSurfaceColor = isDark
    ? theme.colors.surfaceContainerLowest
    : theme.colors.surfaceContainerLowest;
  const subtleSurfaceColor = isDark
    ? 'rgba(255,255,255,0.035)'
    : theme.colors.surfaceContainer;
  const outlineColor = isDark
    ? 'rgba(255,255,255,0.08)'
    : theme.colors.outlineVariant;
  const strongOutlineColor = isDark
    ? 'rgba(255,255,255,0.14)'
    : theme.colors.outline;
  const mutedLineColor = isDark
    ? 'rgba(255,255,255,0.16)'
    : theme.colors.outlineVariant;
  const selectedDirectoryColor = isDark
    ? 'rgba(0,209,255,0.12)'
    : 'rgba(0,81,174,0.08)';
  const currentDirectoryDotColor = isDark ? theme.colors.secondary : '#16A34A';
  const topPanelCollapsed = keyboardInset > 0 || keyboardProxyFocused;
  const keyboardLiftInset =
    keyboardInset > 0
      ? keyboardInset
      : keyboardProxyFocused
      ? keyboardInsetCacheRef.current || PENDING_KEYBOARD_LIFT_INSET
      : 0;
  const terminalViewportInset = terminal
    ? Math.max(floatingControlsHeight + keyboardLiftInset, 104)
    : 0;
  const terminalRendered = Boolean(terminal && renderedTerminalId === terminal.id);
  const terminalRenderErrorMessage =
    terminal && terminalRenderError?.sessionId === terminal.id
      ? terminalRenderError.message
      : '';
  const terminalInputEnabled =
    serverMode &&
    device?.status === 'online' &&
    terminal?.status === 'running' &&
    terminalRendered &&
    !terminalRenderErrorMessage &&
    !terminalOpening;

  const cancelKeyboardProxyFocusRetry = useCallback(() => {
    if (keyboardProxyFocusRetryRef.current) {
      clearTimeout(keyboardProxyFocusRetryRef.current);
      keyboardProxyFocusRetryRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!terminalId && device) {
      let cancelled = false;
      setTerminalOpening(true);
      createTerminalSession(device.id, route.params.directory)
        .then(sessionId => {
          if (!cancelled) setTerminalId(sessionId);
        })
        .catch(() => {
          if (!cancelled) setTerminalId(undefined);
        })
        .finally(() => {
          if (!cancelled) setTerminalOpening(false);
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [createTerminalSession, device, route.params.directory, terminalId]);

  useEffect(
    () => () => {
      cancelKeyboardProxyFocusRetry();
    },
    [cancelKeyboardProxyFocusRetry],
  );

  const resetKeyboardProxyInput = useCallback(() => {
    keyboardProxyStateRef.current = markTerminalKeyboardProxyInputReset(
      keyboardProxyStateRef.current,
    );
    resetTerminalKeyboardProxyInput(keyboardProxyRef.current);
  }, []);

  useEffect(() => {
    if (
      Platform.OS === 'android' &&
      UIManager.setLayoutAnimationEnabledExperimental
    ) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    const syncKeyboardInset = (event: {
      endCoordinates?: { height?: number };
    }) => {
      const nextKeyboardInset = Math.max(0, event.endCoordinates?.height ?? 0);
      if (nextKeyboardInset > 0) {
        keyboardInsetCacheRef.current = nextKeyboardInset;
      }
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardInset(nextKeyboardInset);
    };
    const clearKeyboardInset = () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardInset(0);
      setKeyboardProxyFocused(false);
      cancelKeyboardProxyFocusRetry();
    };
    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', syncKeyboardInset),
      Keyboard.addListener('keyboardDidShow', syncKeyboardInset),
      Keyboard.addListener('keyboardWillChangeFrame', syncKeyboardInset),
      Keyboard.addListener('keyboardWillHide', clearKeyboardInset),
      Keyboard.addListener('keyboardDidHide', clearKeyboardInset),
    ];

    return () => {
      subscriptions.forEach(subscription => subscription.remove());
    };
  }, [cancelKeyboardProxyFocusRetry]);

  useEffect(() => {
    keyboardProxyStateRef.current = createTerminalKeyboardProxyState();
    setKeyboardProxyFocused(false);
    resetKeyboardProxyInput();
  }, [resetKeyboardProxyInput, terminalId]);

  useEffect(() => {
    if (terminalInputEnabled) return;

    keyboardProxyStateRef.current = createTerminalKeyboardProxyState();
    setKeyboardProxyFocused(false);
    cancelKeyboardProxyFocusRetry();
    Keyboard.dismiss();
    resetKeyboardProxyInput();
  }, [
    cancelKeyboardProxyFocusRetry,
    resetKeyboardProxyInput,
    terminalInputEnabled,
  ]);

  useEffect(() => {
    setFocusedDirectory(directory);
    if (!quickDirectoryInitializedRef.current && terminal?.directory) {
      quickDirectoryInitializedRef.current = true;
      setCurrentQuickDirectory(terminal.directory);
    }
  }, [directory, terminal?.directory]);

  useEffect(() => {
    directoryPathRef.current?.scrollTo({ x: 0, animated: false });
    const timer = setTimeout(() => {
      directoryPathRef.current?.scrollToEnd({ animated: true });
    }, 500);

    return () => clearTimeout(timer);
  }, [visibleDirectory]);

  useEffect(() => {
    if (!terminal || !device || !serverMode) return;

    loadTerminalCommandHistory(terminal.id, device.id).catch(() => {
      // Suggestions are opportunistic; terminal input should never depend on them.
    });
  }, [device, loadTerminalCommandHistory, serverMode, terminal]);

  useEffect(() => {
    const timer = setTimeout(() => {
      terminalBridgeRef.current?.fit();
    }, 40);

    return () => clearTimeout(timer);
  }, [keyboardLiftInset, terminalViewportInset]);

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('MainTabs');
  };

  const handleDirectoryChange = async (nextDirectory: string) => {
    if (!device || !terminalInteraction.canChangeDirectory) {
      return;
    }

    setTerminalOpening(true);
    setRenderedTerminalId('');
    setTerminalRenderError(null);
    try {
      const nextTerminalId = await createTerminalSession(device.id, nextDirectory);
      setRenderedTerminalId('');
      setTerminalRenderError(null);
      setTerminalId(nextTerminalId);
      quickDirectoryInitializedRef.current = true;
      setCurrentQuickDirectory(nextDirectory);
      setFocusedDirectory(nextDirectory);
    } finally {
      setTerminalOpening(false);
    }
  };

  const handleDirectorySelect = (nextDirectory: string) => {
    setFocusedDirectory(nextDirectory);
  };

  const handleDirectoryEnter = async () => {
    if (visibleDirectory === directory) {
      return;
    }
    await handleDirectoryChange(visibleDirectory);
  };

  const sendToTerminal = (data: string, options?: { focus?: boolean }) => {
    if (!terminalInputEnabled || !data) return;
    const shouldFocus = options?.focus !== false;
    terminalBridgeRef.current?.sendText(data, { focus: shouldFocus });
    if (shouldFocus) terminalBridgeRef.current?.focus();
  };

  const focusKeyboardProxyInput = () => {
    if (!terminalInputEnabled) return;
    if (keyboardProxyFocusRetryRef.current) {
      clearTimeout(keyboardProxyFocusRetryRef.current);
    }
    setKeyboardProxyFocused(true);
    keyboardProxyStateRef.current = createTerminalKeyboardProxyState();
    resetKeyboardProxyInput();
    keyboardProxyRef.current?.focus();
    keyboardProxyFocusRetryRef.current = setTimeout(() => {
      keyboardProxyFocusRetryRef.current = null;
      resetKeyboardProxyInput();
      keyboardProxyRef.current?.focus();
    }, 40);
  };

  const focusTerminalInput = () => {
    focusKeyboardProxyInput();
  };

  const handleKeyboardProxyFocus = () => {
    setKeyboardProxyFocused(true);
    resetKeyboardProxyInput();
  };

  const handleKeyboardProxyBlur = () => {
    setKeyboardProxyFocused(false);
    cancelKeyboardProxyFocusRetry();
  };

  const handleKeyboardProxyChange = (value: string) => {
    const action = terminalKeyboardProxyChangeAction(
      keyboardProxyStateRef.current,
      value,
    );
    keyboardProxyStateRef.current = action.state;
    if (action.input) sendToTerminal(action.input, { focus: false });
    resetKeyboardProxyInput();
  };

  const handleKeyboardProxyKeyPress = ({
    nativeEvent,
  }: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const action = terminalKeyboardProxyKeyAction(
      keyboardProxyStateRef.current,
      nativeEvent.key,
    );
    keyboardProxyStateRef.current = action.state;
    if (action.input) sendToTerminal(action.input, { focus: false });
    resetKeyboardProxyInput();
  };

  const focusDirectoryFromScroll = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    if (!availableDirectories.length) return;
    const step = DIRECTORY_TILE_WIDTH + DIRECTORY_TILE_GAP;
    const index = Math.min(
      availableDirectories.length - 1,
      Math.max(0, Math.round(event.nativeEvent.contentOffset.x / step)),
    );
    setFocusedDirectory(availableDirectories[index]);
  };

  const handleDirectoryScroll = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    focusDirectoryFromScroll(event);
  };

  const handleDirectoryScrollEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    focusDirectoryFromScroll(event);
  };

  if (!device) {
    return (
      <SafeAreaWrapper>
        <TopAppBar
          title="Device Terminal"
          subtitle="NOT FOUND"
          onBack={navigation.goBack}
        />
      </SafeAreaWrapper>
    );
  }

  const terminalStatusType =
    device.status === 'online'
      ? terminalStatusChip.type
      : device.status === 'warning'
      ? 'warning'
      : 'neutral';

  return (
    <SafeAreaWrapper
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.keyboard}>
        <View
          style={[
            styles.consoleFrame,
            {
              backgroundColor: theme.colors.surfaceContainerLowest,
              borderColor: outlineColor,
            },
          ]}
        >
        <View
          testID="terminal-console-top"
          style={[
            styles.consoleTop,
            topPanelCollapsed && styles.consoleTopCollapsed,
            {
              backgroundColor: theme.colors.surfaceContainerLowest,
              borderBottomColor: outlineColor,
            },
          ]}
        >
            <TopStatusShape
              fill={elevatedSurfaceColor}
              stroke={strongOutlineColor}
              accent={theme.colors.primary}
              muted={mutedLineColor}
            />
            <View
              style={[
                styles.consoleTopContent,
                topPanelCollapsed && styles.consoleTopContentCollapsed,
              ]}
            >
              <View style={styles.headerRow}>
                <TouchableOpacity
                  activeOpacity={0.74}
                  onPress={handleBack}
                  style={[
                    styles.backButton,
                    {
                      borderColor: strongOutlineColor,
                      backgroundColor: elevatedSurfaceColor,
                    },
                  ]}
                >
                  <Text
                    style={[
                      theme.typography.codeMd,
                      styles.backButtonText,
                      { color: theme.colors.primary },
                    ]}
                  >
                    {'<'}
                  </Text>
                </TouchableOpacity>
                <View style={styles.headerCopy}>
                  <Text
                    style={[
                      theme.typography.labelCaps,
                      styles.headerEyebrow,
                      { color: theme.colors.primary },
                    ]}
                  >
                    TERMINAL
                  </Text>
                  <Text
                    style={[
                      theme.typography.codeMd,
                      styles.headerShell,
                      { color: theme.colors.onSurface },
                    ]}
                  >
                    shell {terminal?.shell ?? 'zsh'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.devicePod,
                    {
                      backgroundColor: elevatedSurfaceColor,
                      borderColor: outlineColor,
                    },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.labelMd,
                      styles.deviceName,
                      { color: theme.colors.onSurface },
                    ]}
                  >
                    {device.name}
                  </Text>
                  <StatusChip
                    label={device.status.toUpperCase()}
                    type={
                      device.status === 'online'
                        ? 'success'
                        : device.status === 'warning'
                        ? 'warning'
                        : 'neutral'
                    }
                    style={styles.deviceStatusChip}
                  />
                </View>
              </View>

              {!topPanelCollapsed ? (
                <View testID="terminal-top-grid" style={styles.topGrid}>
                  <View style={styles.metaRail}>
                  <View
                    style={[
                      styles.metaTile,
                      {
                        backgroundColor: elevatedSurfaceColor,
                        borderColor: outlineColor,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        theme.typography.labelCaps,
                        styles.metaLabel,
                        { color: theme.colors.onSurfaceVariant },
                      ]}
                    >
                      MEM
                    </Text>
                    <Text
                      style={[
                        theme.typography.codeSm,
                        styles.metaValue,
                        { color: theme.colors.onSurface },
                      ]}
                    >
                      {device.memLoad}%
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.metaTile,
                      {
                        backgroundColor: elevatedSurfaceColor,
                        borderColor: outlineColor,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        theme.typography.labelCaps,
                        styles.metaLabel,
                        { color: theme.colors.onSurfaceVariant },
                      ]}
                    >
                      CPU
                    </Text>
                    <Text
                      style={[
                        theme.typography.codeSm,
                        styles.metaValue,
                        { color: theme.colors.onSurface },
                      ]}
                    >
                      {device.cpuLoad}%
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.metaTile,
                      {
                        backgroundColor: elevatedSurfaceColor,
                        borderColor: outlineColor,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        theme.typography.labelCaps,
                        styles.metaLabel,
                        { color: theme.colors.onSurfaceVariant },
                      ]}
                    >
                      STATE
                    </Text>
                    <StatusChip
                      label={terminalStatusChip.label}
                      type={terminalStatusType}
                      style={styles.terminalStatusChip}
                    />
                  </View>
                </View>

                <View
                  style={[
                    styles.directoryPanel,
                    {
                      backgroundColor: elevatedSurfaceColor,
                      borderColor: outlineColor,
                    },
                  ]}
                >
                  <ScrollView
                    testID="terminal-directory-scroll"
                    horizontal
                    keyboardShouldPersistTaps="handled"
                    snapToInterval={DIRECTORY_TILE_WIDTH + DIRECTORY_TILE_GAP}
                    decelerationRate="fast"
                    showsHorizontalScrollIndicator={false}
                    onScroll={handleDirectoryScroll}
                    onMomentumScrollEnd={handleDirectoryScrollEnd}
                    scrollEventThrottle={16}
                    contentContainerStyle={styles.directoryFolders}
                  >
                    {availableDirectories.map(item => {
                      const active = item === visibleDirectory;
                      const current = item === currentQuickDirectory;
                      return (
                        <TouchableOpacity
                          testID={`terminal-directory-${testIdSlug(item)}`}
                          key={item}
                          activeOpacity={0.78}
                          disabled={!terminalInteraction.canChangeDirectory}
                          onPress={() => handleDirectorySelect(item)}
                          style={[
                            styles.folderTile,
                            {
                              backgroundColor: active
                                ? selectedDirectoryColor
                                : subtleSurfaceColor,
                              borderColor: active
                                ? theme.colors.primary
                                : outlineColor,
                            },
                            !terminalInteraction.canChangeDirectory &&
                              !active &&
                              styles.disabledDirectoryItem,
                          ]}
                        >
                          {current ? (
                            <View
                              style={[
                                styles.currentDirectoryDot,
                                {
                                  backgroundColor: currentDirectoryDotColor,
                                  borderColor:
                                    theme.colors.surfaceContainerLowest,
                                },
                              ]}
                            />
                          ) : null}
                          <FolderGlyph
                            active={active}
                            activeFill={selectedDirectoryColor}
                            activeStroke={theme.colors.primary}
                            inactiveFill={subtleSurfaceColor}
                            inactiveStroke={outlineColor}
                          />
                          <Text
                            numberOfLines={1}
                            style={[
                              theme.typography.labelSm,
                              styles.folderLabel,
                              {
                                color: active
                                  ? theme.colors.primary
                                  : theme.colors.onSurfaceVariant,
                              },
                            ]}
                          >
                            {shortDirectoryName(item)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <TouchableOpacity
                    testID="terminal-directory-enter"
                    activeOpacity={0.76}
                    onPress={() => {
                      handleDirectoryEnter().catch(() => {});
                    }}
                    disabled={
                      !terminalInteraction.canChangeDirectory ||
                      visibleDirectory === directory
                    }
                    style={[
                      styles.directoryPathRow,
                      {
                        backgroundColor: recessedSurfaceColor,
                        borderColor: outlineColor,
                      },
                      (!terminalInteraction.canChangeDirectory ||
                        visibleDirectory === directory) &&
                        styles.disabledDirectoryPath,
                    ]}
                  >
                    <View
                      style={[
                        styles.directoryEnterIcon,
                        {
                          backgroundColor: selectedDirectoryColor,
                          borderColor: outlineColor,
                        },
                      ]}
                    >
                      <EnterDirectoryIcon color={theme.colors.primary} />
                    </View>
                    <ScrollView
                      ref={directoryPathRef}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      scrollEnabled={false}
                      style={styles.directoryPathScroller}
                      contentContainerStyle={styles.directoryPathContent}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          theme.typography.codeSm,
                          styles.directoryPath,
                          { color: theme.colors.tertiary },
                        ]}
                      >
                        {visibleDirectory}
                      </Text>
                    </ScrollView>
                  </TouchableOpacity>
                </View>
                </View>
              ) : null}
            </View>
          </View>

          <View
            style={[
              styles.outputPane,
              { backgroundColor: theme.colors.surfaceContainerLowest },
            ]}
          >
            {terminal ? (
              <View
                testID="terminal-viewport"
                style={[
                  styles.terminalViewport,
                  { paddingBottom: terminalViewportInset },
                ]}
              >
                <TerminalEmulator
                  sessionId={terminal.id}
                  enabled={terminalInputEnabled}
                  terminalRef={terminalBridgeRef}
                  onFocusRequest={focusKeyboardProxyInput}
                  onRendered={() => setRenderedTerminalId(terminal.id)}
                  onRenderError={message =>
                    setTerminalRenderError({ sessionId: terminal.id, message })
                  }
                />
                {!terminalRendered && !terminalRenderErrorMessage ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.terminalStatusOverlay,
                      { backgroundColor: theme.colors.surfaceContainerLowest },
                    ]}>
                    <ActivityIndicator color={theme.colors.primary} />
                    <Text
                      style={[
                        theme.typography.labelMd,
                        { color: theme.colors.onSurfaceVariant },
                        styles.terminalStatusText,
                      ]}>
                      Rendering terminal...
                    </Text>
                  </View>
                ) : null}
                {terminalRenderErrorMessage ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.terminalStatusOverlay,
                      { backgroundColor: theme.colors.surfaceContainerLowest },
                    ]}>
                    <Text
                      style={[
                        theme.typography.labelMd,
                        { color: theme.colors.error },
                        styles.terminalStatusText,
                      ]}>
                      Terminal failed to load
                    </Text>
                    <Text
                      numberOfLines={3}
                      style={[
                        theme.typography.bodySm,
                        { color: theme.colors.onSurfaceVariant },
                        styles.terminalStatusDetail,
                      ]}>
                      {terminalRenderErrorMessage}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.terminalPlaceholder}>
                <Text
                  style={[
                    theme.typography.codeSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  {terminalOpening
                    ? 'Opening terminal session...'
                    : 'Terminal session unavailable'}
                </Text>
              </View>
            )}

            {terminal ? (
              <View
                testID="terminal-floating-controls"
                pointerEvents="box-none"
                onLayout={event =>
                  setFloatingControlsHeight(event.nativeEvent.layout.height)
                }
                style={[styles.floatingControls, { bottom: keyboardLiftInset }]}
              >
                <ScrollView
                  testID="terminal-suggestion-row"
                  horizontal
                  keyboardShouldPersistTaps="handled"
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.suggestionRow}
                >
                  {aiSuggestions.map(item => (
                    <TouchableOpacity
                      testID={`terminal-suggestion-${testIdSlug(item)}`}
                      key={item}
                      activeOpacity={0.76}
                      disabled={!terminalInputEnabled}
                      onPress={() => sendToTerminal(`${item}\r`, { focus: false })}
                      style={[
                        styles.aiBubble,
                        {
                          backgroundColor: surfaceColor,
                          borderColor: outlineColor,
                        },
                        !terminalInputEnabled && styles.disabledSuggestion,
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          theme.typography.codeSm,
                          styles.aiBubbleText,
                          { color: theme.colors.onSurfaceVariant },
                        ]}
                      >
                        {item}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <ScrollView
                  horizontal
                  keyboardShouldPersistTaps="handled"
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.keyRow}
                >
                  <TouchableOpacity
                    testID="terminal-keyboard-focus"
                    activeOpacity={0.74}
                    onPressIn={focusTerminalInput}
                    disabled={!terminalInputEnabled}
                    style={[
                      styles.keyButton,
                      {
                        backgroundColor: elevatedSurfaceColor,
                        borderColor: keyboardProxyFocused
                          ? theme.colors.primary
                          : outlineColor,
                      },
                      !terminalInputEnabled && styles.disabledControl,
                    ]}
                  >
                    <Text
                      style={[
                        theme.typography.labelCaps,
                        styles.quickActionText,
                        {
                          color: keyboardProxyFocused
                            ? theme.colors.primary
                            : theme.colors.onSurfaceVariant,
                        },
                      ]}
                    >
                      KB
                    </Text>
                    <TextInput
                      ref={keyboardProxyRef}
                      testID="terminal-keyboard-proxy"
                      defaultValue={TERMINAL_KEYBOARD_PROXY_VALUE}
                      onChangeText={handleKeyboardProxyChange}
                      onKeyPress={handleKeyboardProxyKeyPress}
                      onFocus={handleKeyboardProxyFocus}
                      onBlur={handleKeyboardProxyBlur}
                      selection={TERMINAL_KEYBOARD_PROXY_SELECTION}
                      editable={terminalInputEnabled}
                      pointerEvents="none"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      textContentType="none"
                      keyboardType={TERMINAL_PROXY_KEYBOARD_TYPE}
                      showSoftInputOnFocus
                      disableFullscreenUI
                      returnKeyType="done"
                      submitBehavior="newline"
                      multiline
                      blurOnSubmit={false}
                      caretHidden
                      contextMenuHidden
                      importantForAutofill="no"
                      spellCheck={false}
                      style={styles.keyboardProxy}
                    />
                  </TouchableOpacity>
                  {Object.entries(terminalKeyBytes).map(([label, value]) => (
                    <TouchableOpacity
                      key={label}
                      testID={`terminal-key-${label}`}
                      activeOpacity={0.74}
                      onPress={() => sendToTerminal(value, { focus: false })}
                      disabled={!terminalInputEnabled}
                      style={[
                        styles.keyButton,
                        {
                          backgroundColor: elevatedSurfaceColor,
                          borderColor: outlineColor,
                        },
                        !terminalInputEnabled && styles.disabledControl,
                      ]}
                    >
                      <Text
                        style={[
                          theme.typography.labelCaps,
                          styles.quickActionText,
                          { color: theme.colors.onSurfaceVariant },
                        ]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </View>

          {terminal?.status === 'waiting_approval' ? (
            <TouchableOpacity
              activeOpacity={0.76}
              onPress={() => navigation.navigate('ApprovalCenter')}
              style={[
                styles.approvalButton,
                {
                  backgroundColor: surfaceColor,
                  borderColor: theme.colors.tertiary,
                },
              ]}
            >
              <Text
                style={[
                  theme.typography.labelCaps,
                  styles.approvalText,
                  { color: theme.colors.tertiary },
                ]}
              >
                OPEN APPROVAL CENTER
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  safeArea: {},
  keyboard: {
    flex: 1,
  },
  consoleFrame: {
    flex: 1,
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  consoleTop: {
    minHeight: 224,
    borderBottomWidth: 1,
    overflow: 'hidden',
  },
  consoleTopCollapsed: {
    minHeight: 76,
  },
  consoleTopContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 14,
  },
  consoleTopContentCollapsed: {
    paddingTop: 9,
    paddingBottom: 9,
    gap: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 19,
  },
  backButtonText: {
    fontWeight: '700',
    lineHeight: 20,
    letterSpacing: 0,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerEyebrow: {
    letterSpacing: 0,
  },
  headerShell: {
    marginTop: 3,
    letterSpacing: 0,
  },
  devicePod: {
    minWidth: 132,
    maxWidth: 166,
    minHeight: 54,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: 16,
    paddingRight: 10,
    borderRadius: 28,
    borderWidth: 1,
  },
  deviceName: {
    fontWeight: '700',
    maxWidth: 116,
  },
  deviceStatusChip: {
    marginTop: 5,
  },
  topGrid: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  metaRail: {
    width: 60,
    gap: 8,
  },
  metaTile: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaLabel: {
    letterSpacing: 0,
  },
  metaValue: {
    marginTop: 2,
    letterSpacing: 0,
  },
  terminalStatusChip: {
    transform: [{ scale: 0.86 }],
  },
  directoryPanel: {
    flex: 1,
    minWidth: 0,
    minHeight: 140,
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  directoryFolders: {
    gap: DIRECTORY_TILE_GAP,
    paddingRight: 2,
  },
  folderTile: {
    width: DIRECTORY_TILE_WIDTH,
    height: 64,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  disabledDirectoryItem: {
    opacity: 0.45,
  },
  currentDirectoryDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 9,
    height: 9,
    borderWidth: 1,
    borderRadius: 5,
  },
  folderLabel: {
    width: 58,
    textAlign: 'center',
  },
  directoryPathRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingLeft: 6,
    paddingRight: 10,
  },
  disabledDirectoryPath: {
    opacity: 0.72,
  },
  directoryEnterIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
  },
  directoryPathScroller: {
    flex: 1,
    minWidth: 0,
  },
  directoryPathContent: {
    minHeight: 28,
    alignItems: 'center',
    paddingRight: 8,
  },
  directoryPath: {
    letterSpacing: 0,
  },
  outputPane: {
    flex: 1,
    minHeight: 180,
    position: 'relative',
  },
  keyboardProxy: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0,
    color: 'transparent',
  },
  terminalPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  terminalViewport: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  terminalStatusOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    zIndex: 2,
  },
  terminalStatusText: {
    letterSpacing: 0,
  },
  terminalStatusDetail: {
    maxWidth: 220,
    textAlign: 'center',
  },
  floatingControls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 10,
  },
  suggestionRow: {
    gap: 8,
    paddingRight: 12,
  },
  aiBubble: {
    maxWidth: 178,
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  disabledSuggestion: {
    opacity: 0.48,
  },
  aiBubbleText: {
    letterSpacing: 0,
  },
  quickActionText: {
    fontSize: 10,
    letterSpacing: 0,
  },
  keyRow: {
    gap: 8,
    paddingRight: 12,
  },
  keyButton: {
    minWidth: 54,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  disabledControl: {
    opacity: 0.45,
  },
  approvalButton: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  approvalText: {
    letterSpacing: 0,
  },
});
