import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { TerminalEmulator } from '../../components/terminal/TerminalEmulator';
import { useTheme } from '../../theme/useTheme';
import { RootStackParamList } from '../../app/navigation/types';
import {
  TerminalLineKind,
  useControlCenterStore,
} from '../../store/controlCenterStore';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import {
  getTerminalInteractionState,
  getTerminalStatusChip,
} from '../../utils/terminalInteraction';

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

const normalizeCommandLineContent = (content: string, directory: string) => {
  const currentPrompt = `${directory} $ `;
  if (content.startsWith(currentPrompt)) {
    return content.slice(currentPrompt.length);
  }

  const legacyPrompt = content.match(/^(.{1,240})\s+\$\s+(.+)$/);
  if (!legacyPrompt) return content;

  const promptPath = legacyPrompt[1];
  if (
    promptPath === '~' ||
    promptPath.startsWith('/') ||
    promptPath.includes('\\')
  ) {
    return legacyPrompt[2];
  }

  return content;
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

export const DeviceTerminalScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<DeviceTerminalRoute>();
  const outputRef = useRef<ScrollView>(null);
  const devices = useControlCenterStore(state => state.devices);
  const terminalSessions = useControlCenterStore(
    state => state.terminalSessions,
  );
  const createTerminalSession = useControlCenterStore(
    state => state.createTerminalSession,
  );
  const createPtySession = useControlCenterStore(
    state => state.createPtySession,
  );
  const executeTerminalCommand = useControlCenterStore(
    state => state.executeTerminalCommand,
  );
  const clearTerminal = useControlCenterStore(state => state.clearTerminal);
  const stopTerminal = useControlCenterStore(state => state.stopTerminal);
  const closeTerminalSessionAction = useControlCenterStore(
    state => state.closeTerminalSession,
  );
  const serverMode = useControlCenterStore(state => state.serverMode);
  const [terminalId, setTerminalId] = useState(route.params.terminalId);
  const [command, setCommand] = useState('');
  const [terminalOpening, setTerminalOpening] = useState(false);
  const [ptyMode, setPtyMode] = useState(false);
  const [ptySessionId, setPtySessionId] = useState<string | null>(null);
  const [ptyLoading, setPtyLoading] = useState(false);
  const [focusedDirectory, setFocusedDirectory] = useState(
    route.params.directory ?? '~',
  );
  const device = devices.find(item => item.id === route.params.deviceId);
  const terminal = terminalSessions.find(item => item.id === terminalId);
  const directory = terminal?.directory ?? route.params.directory ?? '~';
  const terminalInteraction = getTerminalInteractionState({
    terminalStatus: terminal?.status,
    deviceStatus: device?.status,
    terminalOpening,
    command,
  });
  const terminalStatusChip = getTerminalStatusChip(terminal?.status);
  const outputList = useIncrementalList(terminal?.lines ?? [], {
    initialCount: 180,
    step: 240,
    from: 'end',
    resetKey: terminal?.id ?? 'none',
  });
  const availableDirectories = useMemo(() => {
    const base = device?.authorizedDirectories ?? [];
    const merged = [...base, directory].filter(Boolean);
    return Array.from(new Set(merged));
  }, [device?.authorizedDirectories, directory]);
  const visibleDirectory = availableDirectories.includes(focusedDirectory)
    ? focusedDirectory
    : directory;
  const commandHistory = useMemo(
    () =>
      (terminal?.lines ?? [])
        .filter(item => item.kind === 'command')
        .map(item => normalizeCommandLineContent(item.content, directory)),
    [directory, terminal?.lines],
  );
  const aiSuggestions = useMemo(() => {
    const recent = commandHistory[commandHistory.length - 1] ?? '';
    const suggestions = new Set<string>();

    if (recent.startsWith('git')) {
      suggestions.add('git status --short');
      suggestions.add('git log --oneline -5');
    }
    if (recent.includes('npm')) {
      suggestions.add('npm run lint');
      suggestions.add('npm test -- --runInBand');
    }
    if (recent.includes('watch')) {
      suggestions.add('pkill -f watch');
    }

    suggestions.add('pwd');
    suggestions.add('ls -la');
    suggestions.add('git status');

    return Array.from(suggestions).slice(0, 4);
  }, [commandHistory]);
  const canExecute = terminalInteraction.canExecute;
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
  const disabledSurfaceColor = isDark
    ? 'rgba(255,255,255,0.08)'
    : theme.colors.surfaceContainerHigh;

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

  useEffect(() => {
    setFocusedDirectory(directory);
  }, [directory]);

  useEffect(() => {
    const timer = setTimeout(() => {
      outputRef.current?.scrollToEnd({ animated: true });
    }, 60);

    return () => clearTimeout(timer);
  }, [terminal?.lines.length]);

  const getLineColor = (kind: TerminalLineKind) => {
    switch (kind) {
      case 'command':
        return theme.colors.primary;
      case 'stderr':
        return theme.colors.error;
      case 'success':
        return isDark ? theme.colors.secondary : theme.colors.primary;
      case 'system':
        return theme.colors.tertiary;
      default:
        return theme.colors.onSurface;
    }
  };

  const getLinePrompt = (kind: TerminalLineKind) => {
    switch (kind) {
      case 'command':
        return '$';
      case 'stderr':
        return '!';
      case 'system':
        return '#';
      default:
        return '';
    }
  };

  const getTerminalLineContent = (kind: TerminalLineKind, content: string) => {
    if (kind !== 'command') return content;
    return normalizeCommandLineContent(content, directory);
  };

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
    try {
      setTerminalId(await createTerminalSession(device.id, nextDirectory));
      setCommand('');
    } finally {
      setTerminalOpening(false);
    }
  };

  const handleDirectorySelect = async (nextDirectory: string) => {
    setFocusedDirectory(nextDirectory);
    if (nextDirectory === directory) {
      return;
    }
    await handleDirectoryChange(nextDirectory);
  };

  const handleDirectoryScroll = (
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

  const handleDirectoryScrollEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    if (!availableDirectories.length) return;
    const step = DIRECTORY_TILE_WIDTH + DIRECTORY_TILE_GAP;
    const index = Math.min(
      availableDirectories.length - 1,
      Math.max(0, Math.round(event.nativeEvent.contentOffset.x / step)),
    );
    void handleDirectorySelect(availableDirectories[index]);
  };

  const handleExecute = () => {
    const trimmed = command.trim();

    if (!canExecute || !terminal || !trimmed) {
      return;
    }

    if (trimmed.toLowerCase() === 'clear') {
      clearTerminal(terminal.id);
      setCommand('');
      return;
    }

    executeTerminalCommand(terminal.id, trimmed);
    setCommand('');
  };

  const handleOpenPty = async () => {
    if (!device || ptyLoading) return;
    setPtyLoading(true);
    try {
      const sessionId = await createPtySession(device.id, {
        cwd: directory,
        cols: 80,
        rows: 24,
      });
      setPtySessionId(sessionId);
      setPtyMode(true);
    } catch {
      // Fall back to command mode on error
    } finally {
      setPtyLoading(false);
    }
  };

  const handleClosePty = () => {
    if (ptySessionId) {
      void closeTerminalSessionAction(ptySessionId).catch(() => {});
    }
    setPtyMode(false);
    setPtySessionId(null);
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

  // PTY interactive terminal mode
  if (ptyMode && ptySessionId) {
    return (
      <SafeAreaWrapper>
        <TopAppBar
          title="Interactive Terminal"
          subtitle={device.name}
          onBack={handleClosePty}
          rightAction={<StatusChip label="PTY" type="info" />}
        />
        <View
          style={[
            styles.ptyContainer,
            { backgroundColor: theme.colors.surfaceContainerLowest },
          ]}
        >
          <TerminalEmulator
            sessionId={ptySessionId}
            enabled={device.status === 'online'}
          />
        </View>
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
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
            style={[
              styles.consoleTop,
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
            <View style={styles.consoleTopContent}>
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

              <View style={styles.topGrid}>
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
                    horizontal
                    snapToInterval={DIRECTORY_TILE_WIDTH + DIRECTORY_TILE_GAP}
                    decelerationRate="fast"
                    showsHorizontalScrollIndicator={false}
                    onScroll={handleDirectoryScroll}
                    onMomentumScrollEnd={handleDirectoryScrollEnd}
                    scrollEventThrottle={16}
                    contentContainerStyle={styles.directoryFolders}
                  >
                    {availableDirectories.map(item => {
                      const active = item === directory;
                      return (
                        <TouchableOpacity
                          key={item}
                          activeOpacity={0.78}
                          disabled={!terminalInteraction.canChangeDirectory}
                          onPress={() => void handleDirectorySelect(item)}
                          style={[
                            styles.folderTile,
                            {
                              backgroundColor: active
                                ? selectedDirectoryColor
                                : subtleSurfaceColor,
                              borderColor: active
                                ? theme.colors.primary
                                : outlineColor,
                              opacity:
                                !terminalInteraction.canChangeDirectory &&
                                !active
                                  ? 0.45
                                  : 1,
                            },
                          ]}
                        >
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
                  <View
                    style={[
                      styles.directoryPathRow,
                      {
                        backgroundColor: recessedSurfaceColor,
                        borderColor: outlineColor,
                      },
                    ]}
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
                  </View>
                </View>
              </View>
            </View>
          </View>

          <View
            style={[
              styles.outputPane,
              { backgroundColor: theme.colors.surfaceContainerLowest },
            ]}
          >
            <ScrollView
              ref={outputRef}
              style={styles.outputWindow}
              contentContainerStyle={styles.outputContent}
            >
              {outputList.visibleCount < outputList.totalCount ? (
                <TouchableOpacity
                  activeOpacity={0.74}
                  onPress={outputList.showMore}
                  style={[
                    styles.loadEarlierButton,
                    {
                      backgroundColor: surfaceColor,
                      borderColor: outlineColor,
                    },
                  ]}
                >
                  <Text
                    style={[
                      theme.typography.labelCaps,
                      styles.loadEarlierText,
                      { color: theme.colors.primary },
                    ]}
                  >
                    LOAD EARLIER OUTPUT
                  </Text>
                  <Text
                    style={[
                      theme.typography.codeSm,
                      styles.loadEarlierCount,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    {outputList.visibleCount}/{outputList.totalCount}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {outputList.visibleItems.map(item => {
                const prompt = getLinePrompt(item.kind);

                return (
                  <View
                    key={item.id}
                    style={[
                      styles.outputLine,
                      item.kind === 'command' ? styles.outputCommandLine : null,
                    ]}
                  >
                    <Text
                      style={[
                        theme.typography.codeSm,
                        styles.outputPrompt,
                        { color: getLineColor(item.kind) },
                      ]}
                    >
                      {prompt}
                    </Text>
                    <Text
                      selectable
                      style={[
                        theme.typography.codeSm,
                        styles.outputText,
                        { color: getLineColor(item.kind) },
                      ]}
                    >
                      {getTerminalLineContent(item.kind, item.content)}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>

          <View
            style={[styles.inputDivider, { backgroundColor: outlineColor }]}
          />

          <View
            style={[
              styles.bottomDock,
              { backgroundColor: theme.colors.surfaceContainerLow },
            ]}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.suggestionRow}
            >
              {aiSuggestions.map(item => (
                <TouchableOpacity
                  key={item}
                  activeOpacity={0.76}
                  disabled={
                    !terminalInteraction.inputEnabled || terminalOpening
                  }
                  onPress={() => setCommand(item)}
                  style={[
                    styles.aiBubble,
                    {
                      backgroundColor: surfaceColor,
                      borderColor: outlineColor,
                      opacity:
                        !terminalInteraction.inputEnabled || terminalOpening
                          ? 0.48
                          : 1,
                    },
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

            <View style={styles.quickActionRow}>
              <TouchableOpacity
                activeOpacity={0.74}
                onPress={handleOpenPty}
                disabled={
                  !serverMode || device.status !== 'online' || ptyLoading
                }
                style={[
                  styles.quickActionButton,
                  {
                    backgroundColor: elevatedSurfaceColor,
                    borderColor: outlineColor,
                    opacity:
                      !serverMode || device.status !== 'online' || ptyLoading
                        ? 0.45
                        : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    theme.typography.labelCaps,
                    styles.quickActionText,
                    { color: theme.colors.primary },
                  ]}
                >
                  {ptyLoading ? 'OPENING PTY' : 'PTY'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.74}
                onPress={() => terminal && clearTerminal(terminal.id)}
                disabled={!terminal}
                style={[
                  styles.quickActionButton,
                  {
                    backgroundColor: elevatedSurfaceColor,
                    borderColor: outlineColor,
                    opacity: !terminal ? 0.45 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    theme.typography.labelCaps,
                    styles.quickActionText,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  CLEAR
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.74}
                onPress={() => {
                  if (terminal) void stopTerminal(terminal.id).catch(() => {});
                }}
                disabled={!terminal || terminal.status === 'stopped'}
                style={[
                  styles.quickActionButton,
                  {
                    backgroundColor: elevatedSurfaceColor,
                    borderColor: outlineColor,
                    opacity:
                      !terminal || terminal.status === 'stopped' ? 0.45 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    theme.typography.labelCaps,
                    styles.quickActionText,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  STOP
                </Text>
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.inputRow,
                {
                  backgroundColor: theme.colors.surfaceContainerLowest,
                  borderColor: strongOutlineColor,
                },
              ]}
            >
              <Text
                style={[
                  theme.typography.codeMd,
                  styles.promptMarker,
                  { color: theme.colors.primary },
                ]}
              >
                $
              </Text>
              <TextInput
                value={command}
                onChangeText={setCommand}
                placeholder={
                  terminalOpening
                    ? 'Opening terminal session...'
                    : device.status === 'offline'
                    ? 'Device offline'
                    : 'Type a command to execute...'
                }
                placeholderTextColor={theme.colors.onSurfaceVariant}
                editable={terminalInteraction.inputEnabled}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="send"
                onSubmitEditing={handleExecute}
                style={[
                  theme.typography.codeSm,
                  styles.commandInput,
                  { color: theme.colors.onSurface },
                ]}
              />
              <TouchableOpacity
                activeOpacity={0.76}
                onPress={handleExecute}
                disabled={!canExecute || terminalOpening}
                style={[
                  styles.executeButton,
                  {
                    backgroundColor:
                      canExecute && !terminalOpening
                        ? theme.colors.primary
                        : disabledSurfaceColor,
                    opacity: canExecute && !terminalOpening ? 1 : 0.7,
                  },
                ]}
              >
                <Text
                  style={[
                    theme.typography.labelCaps,
                    styles.executeText,
                    { color: theme.colors.onPrimary },
                  ]}
                >
                  {terminalInteraction.executeLabel}
                </Text>
              </TouchableOpacity>
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
      </KeyboardAvoidingView>
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
  consoleTopContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 14,
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
  folderLabel: {
    width: 58,
    textAlign: 'center',
  },
  directoryPathRow: {
    minHeight: 30,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  directoryPath: {
    letterSpacing: 0,
  },
  outputPane: {
    flex: 1,
    minHeight: 180,
  },
  ptyContainer: {
    flex: 1,
  },
  outputWindow: {
    flex: 1,
  },
  outputContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 18,
    gap: 2,
  },
  loadEarlierButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 8,
  },
  loadEarlierText: {
    letterSpacing: 0,
  },
  loadEarlierCount: {
    letterSpacing: 0,
  },
  outputLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    minHeight: 18,
  },
  outputCommandLine: {
    marginTop: 4,
  },
  outputPrompt: {
    width: 16,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'right',
    letterSpacing: 0,
  },
  outputText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0,
  },
  inputDivider: {
    height: 1,
  },
  bottomDock: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
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
  aiBubbleText: {
    letterSpacing: 0,
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickActionButton: {
    minHeight: 34,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  quickActionText: {
    letterSpacing: 0,
  },
  inputRow: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 6,
  },
  promptMarker: {
    fontWeight: '700',
    letterSpacing: 0,
  },
  commandInput: {
    flex: 1,
    minHeight: 40,
    paddingVertical: 8,
    letterSpacing: 0,
  },
  executeButton: {
    minWidth: 88,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  executeText: {
    letterSpacing: 0,
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
