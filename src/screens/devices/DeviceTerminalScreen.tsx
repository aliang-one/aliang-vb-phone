import React, { useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { TerminalEmulator } from '../../components/terminal/TerminalEmulator';
import { useTheme } from '../../theme/useTheme';
import { RootStackParamList } from '../../app/navigation/types';
import {
  TerminalLineKind,
  TerminalSessionStatus,
  useControlCenterStore,
} from '../../store/controlCenterStore';
import { IconBadge } from '../../components/visual/IconBadge';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type DeviceTerminalRoute = RouteProp<RootStackParamList, 'DeviceTerminal'>;

const quickCommands = [
  'pwd',
  'ls -la',
  'git status',
  'npm test',
  'git push origin HEAD',
];

const terminalStateLabel: Record<TerminalSessionStatus, string> = {
  idle: 'READY',
  running: 'RUNNING',
  completed: 'DONE',
  failed: 'FAILED',
  stopped: 'STOPPED',
  waiting_approval: 'APPROVAL',
};

const terminalStateType: Record<
  TerminalSessionStatus,
  'success' | 'warning' | 'error' | 'neutral' | 'info'
> = {
  idle: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'error',
  stopped: 'warning',
  waiting_approval: 'warning',
};

export const DeviceTerminalScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<DeviceTerminalRoute>();
  const outputRef = useRef<ScrollView>(null);
  const devices = useControlCenterStore(state => state.devices);
  const terminalSessions = useControlCenterStore(state => state.terminalSessions);
  const createTerminalSession = useControlCenterStore(
    state => state.createTerminalSession,
  );
  const createPtySession = useControlCenterStore(state => state.createPtySession);
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
  const device = devices.find(item => item.id === route.params.deviceId);
  const terminal = terminalSessions.find(item => item.id === terminalId);
  const directory = terminal?.directory ?? route.params.directory ?? '~';
  const isRunning = terminal?.status === 'running';
  const canExecute =
    Boolean(command.trim()) &&
    Boolean(terminal) &&
    Boolean(device) &&
    device?.status !== 'offline' &&
    !isRunning;

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
        return theme.colors.onSurfaceVariant;
    }
  };

  const getLinePrefix = (kind: TerminalLineKind) => {
    switch (kind) {
      case 'command':
        return 'CMD';
      case 'stderr':
        return 'ERR';
      case 'success':
        return 'OK';
      case 'system':
        return 'SYS';
      default:
        return 'OUT';
    }
  };

  const handleDirectoryChange = async (nextDirectory: string) => {
    if (!device || isRunning) {
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
          rightAction={
            <StatusChip label="PTY" type="info" />
          }
        />
        <View style={styles.ptyContainer}>
          <TerminalEmulator
            sessionId={ptySessionId}
            enabled={device.status === 'online'}
          />
        </View>
      </SafeAreaWrapper>
    );
  }

  // Command executor mode (original)
  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Device Terminal"
        subtitle={device.name}
        onBack={navigation.goBack}
        rightAction={
          <StatusChip
            label={terminalStateLabel[terminal?.status ?? 'idle']}
            type={terminalStateType[terminal?.status ?? 'idle']}
          />
        }
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <GlassPanel style={styles.devicePanel}>
          <View style={styles.deviceHeader}>
            <IconBadge
              name="terminal"
              tone={terminal?.status === 'waiting_approval' ? 'tertiary' : 'primary'}
              size={46}
              iconSize={23}
              filled={terminal?.status === 'idle'}
            />
            <View style={styles.deviceTitle}>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                PTY TERMINAL
              </Text>
              <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
                {device.host}
              </Text>
            </View>
            <StatusChip
              label={device.status.toUpperCase()}
              type={
                device.status === 'online'
                  ? 'success'
                  : device.status === 'warning'
                  ? 'warning'
                  : 'neutral'
              }
            />
          </View>
          <View style={styles.metaRow}>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              SHELL {terminal?.shell ?? 'zsh'}
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              CPU {device.cpuLoad}%
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              MEM {device.memLoad}%
            </Text>
          </View>
        </GlassPanel>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          WORKING DIRECTORY
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.directoryList}>
          {device.authorizedDirectories.map(item => {
            const active = item === directory;

            return (
              <TouchableOpacity
                key={item}
                activeOpacity={0.75}
                disabled={isRunning}
                onPress={() => handleDirectoryChange(item)}
                style={[
                  styles.directoryChip,
                  {
                    borderRadius: theme.borderRadius.full,
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(0, 209, 255, 0.12)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : 'transparent',
                    opacity: isRunning && !active ? 0.5 : 1,
                  },
                ]}>
                <Text
                  numberOfLines={1}
                  style={[
                    theme.typography.codeSm,
                    {
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                    },
                  ]}>
                  {item}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <GlassPanel style={styles.terminalPanel}>
          <View
            style={[
              styles.terminalHeader,
              { borderBottomColor: theme.colors.outlineVariant },
            ]}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              LIVE OUTPUT
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              {terminal?.lines.length ?? 0} LINES
            </Text>
          </View>
          <ScrollView
            ref={outputRef}
            style={[
              styles.outputWindow,
              {
                backgroundColor: isDark
                  ? 'rgba(0, 0, 0, 0.24)'
                  : 'rgba(255, 255, 255, 0.42)',
              },
            ]}
            contentContainerStyle={styles.outputContent}>
            {(terminal?.lines ?? []).map(item => (
              <View key={item.id} style={styles.outputLine}>
                <Text
                  style={[
                    theme.typography.codeSm,
                    styles.outputPrefix,
                    { color: getLineColor(item.kind) },
                  ]}>
                  {getLinePrefix(item.kind)}
                </Text>
                <Text
                  selectable
                  style={[
                    theme.typography.codeSm,
                    styles.outputText,
                    { color: getLineColor(item.kind) },
                  ]}>
                  {item.timestamp}  {item.content}
                </Text>
              </View>
            ))}
          </ScrollView>
        </GlassPanel>

        <GlassPanel style={styles.commandPanel}>
          <Text
            numberOfLines={1}
            style={[theme.typography.codeSm, styles.promptPath, { color: theme.colors.primary }]}>
            {directory}
          </Text>
          <View
            style={[
              styles.inputRow,
              {
                borderColor: theme.colors.outlineVariant,
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.04)'
                  : theme.colors.surfaceContainer,
                borderRadius: theme.borderRadius.md,
              },
            ]}>
            <Text style={[theme.typography.codeMd, { color: theme.colors.primary }]}>
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
              editable={device.status !== 'offline' && !isRunning && !terminalOpening}
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
          </View>

          <View style={styles.quickCommandRow}>
            {quickCommands.map(item => (
              <TouchableOpacity
                key={item}
                activeOpacity={0.75}
                disabled={isRunning || device.status === 'offline' || terminalOpening}
                onPress={() => setCommand(item)}
                style={[
                  styles.quickCommand,
                  {
                    borderColor: theme.colors.outlineVariant,
                    borderRadius: theme.borderRadius.full,
                    opacity: isRunning || device.status === 'offline' || terminalOpening ? 0.5 : 1,
                  },
                ]}>
                <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                  {item}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.actionRow}>
            <GlowButton
              title={terminalOpening ? 'OPENING' : isRunning ? 'RUNNING' : 'EXECUTE'}
              onPress={handleExecute}
              variant="primary"
              disabled={!canExecute || terminalOpening}
              style={styles.executeButton}
            />
            <GlowButton
              title="STOP"
              onPress={() => {
                if (terminal) void stopTerminal(terminal.id).catch(() => {});
              }}
              variant="outline"
              disabled={!terminal || terminal.status === 'stopped'}
              style={styles.utilityButton}
            />
            <GlowButton
              title="CLEAR"
              onPress={() => terminal && clearTerminal(terminal.id)}
              variant="outline"
              disabled={!terminal}
              style={styles.utilityButton}
            />
          </View>

          {serverMode && device.status === 'online' && (
            <GlowButton
              title={ptyLoading ? 'OPENING PTY...' : 'OPEN INTERACTIVE TERMINAL'}
              onPress={handleOpenPty}
              variant="secondary"
              disabled={ptyLoading}
            />
          )}

          {terminal?.status === 'waiting_approval' ? (
            <GlowButton
              title="OPEN APPROVAL CENTER"
              onPress={() => navigation.navigate('ApprovalCenter')}
              variant="secondary"
            />
          ) : null}
        </GlassPanel>
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  ptyContainer: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  devicePanel: {
    padding: 14,
    gap: 12,
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  deviceTitle: {
    flex: 1,
    gap: 4,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    marginTop: 18,
    marginBottom: 8,
  },
  directoryList: {
    gap: 8,
    paddingRight: 16,
  },
  directoryChip: {
    borderWidth: 1,
    maxWidth: 260,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  terminalPanel: {
    padding: 0,
    marginTop: 14,
    overflow: 'hidden',
  },
  terminalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  outputWindow: {
    height: 330,
  },
  outputContent: {
    padding: 12,
    gap: 7,
  },
  outputLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  outputPrefix: {
    width: 32,
    fontSize: 11,
    fontWeight: '700',
  },
  outputText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  commandPanel: {
    padding: 12,
    marginTop: 14,
    gap: 10,
  },
  promptPath: {
    fontWeight: '600',
  },
  inputRow: {
    minHeight: 48,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  commandInput: {
    flex: 1,
    minHeight: 40,
    paddingVertical: 8,
  },
  quickCommandRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickCommand: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  executeButton: {
    flex: 1,
  },
  utilityButton: {
    minWidth: 76,
    paddingHorizontal: 12,
  },
});
