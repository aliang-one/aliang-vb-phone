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

export const DeviceTerminalScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<DeviceTerminalRoute>();
  const terminalBridgeRef = useRef<TerminalEmulatorHandle | null>(null);
  const directoryPathRef = useRef<ScrollView>(null);
  const devices = useControlCenterStore(state => state.devices);
  const terminalSessions = useControlCenterStore(
    state => state.terminalSessions,
  );
  const createTerminalSession = useControlCenterStore(
    state => state.createTerminalSession,
  );
  const serverMode = useControlCenterStore(state => state.serverMode);
  const [terminalId, setTerminalId] = useState(route.params.terminalId);
  const [command, setCommand] = useState('');
  const [terminalOpening, setTerminalOpening] = useState(false);
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
    command,
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
    const suggestions = new Set<string>([
      'pwd',
      'ls -la',
      'git status --short',
      'git log --oneline -5',
      'npm run lint',
      'npm test -- --runInBand',
    ]);

    return Array.from(suggestions).slice(0, 4);
  }, []);
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
  const currentDirectoryDotColor = isDark ? theme.colors.secondary : '#16A34A';
  const disabledSurfaceColor = isDark
    ? 'rgba(255,255,255,0.08)'
    : theme.colors.surfaceContainerHigh;
  const terminalInputEnabled =
    serverMode &&
    device?.status === 'online' &&
    terminal?.status === 'running' &&
    !terminalOpening;

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
      quickDirectoryInitializedRef.current = true;
      setCurrentQuickDirectory(nextDirectory);
      setFocusedDirectory(nextDirectory);
      setCommand('');
    } finally {
      setTerminalOpening(false);
    }
  };

  const handleDirectorySelect = async (nextDirectory: string) => {
    setFocusedDirectory(nextDirectory);
  };

  const handleDirectoryEnter = async () => {
    if (visibleDirectory === directory) {
      return;
    }
    await handleDirectoryChange(visibleDirectory);
  };

  const sendToTerminal = (data: string) => {
    if (!terminalInputEnabled || !data) return;
    terminalBridgeRef.current?.sendText(data);
    terminalBridgeRef.current?.focus();
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

  const handleExecute = () => {
    const trimmed = command.trim();

    if (!canExecute || !terminalInputEnabled || !trimmed) {
      return;
    }

    sendToTerminal(`${trimmed}\r`);
    setCommand('');
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
                      const active = item === visibleDirectory;
                      const current = item === currentQuickDirectory;
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
                    activeOpacity={0.76}
                    onPress={() => void handleDirectoryEnter()}
                    disabled={
                      !terminalInteraction.canChangeDirectory ||
                      visibleDirectory === directory
                    }
                    style={[
                      styles.directoryPathRow,
                      {
                        backgroundColor: recessedSurfaceColor,
                        borderColor: outlineColor,
                        opacity:
                          !terminalInteraction.canChangeDirectory ||
                          visibleDirectory === directory
                            ? 0.72
                            : 1,
                      },
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
            </View>
          </View>

          <View
            style={[
              styles.outputPane,
              { backgroundColor: theme.colors.surfaceContainerLowest },
            ]}
          >
            {terminal ? (
              <TerminalEmulator
                sessionId={terminal.id}
                enabled={terminalInputEnabled}
                terminalRef={terminalBridgeRef}
              />
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
                  disabled={!terminalInputEnabled}
                  onPress={() => sendToTerminal(`${item}\r`)}
                  style={[
                    styles.aiBubble,
                    {
                      backgroundColor: surfaceColor,
                      borderColor: outlineColor,
                      opacity: !terminalInputEnabled ? 0.48 : 1,
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

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.keyRow}
            >
              {Object.entries(terminalKeyBytes).map(([label, value]) => (
                <TouchableOpacity
                  key={label}
                  activeOpacity={0.74}
                  onPress={() => sendToTerminal(value)}
                  disabled={!terminalInputEnabled}
                  style={[
                    styles.keyButton,
                    {
                      backgroundColor: elevatedSurfaceColor,
                      borderColor: outlineColor,
                      opacity: !terminalInputEnabled ? 0.45 : 1,
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
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

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
                    : 'Send text to terminal...'
                }
                placeholderTextColor={theme.colors.onSurfaceVariant}
                editable={terminalInputEnabled}
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
                disabled={!canExecute || !terminalInputEnabled}
                style={[
                  styles.executeButton,
                  {
                    backgroundColor:
                      canExecute && terminalInputEnabled
                        ? theme.colors.primary
                        : disabledSurfaceColor,
                    opacity: canExecute && terminalInputEnabled ? 1 : 0.7,
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
  },
  terminalPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
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
