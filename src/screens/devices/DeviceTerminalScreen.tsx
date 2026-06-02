import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { mockDevices } from '../../data/mockData';
import { useTheme } from '../../theme/useTheme';
import { RootStackParamList } from '../../app/navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type DeviceTerminalRoute = RouteProp<RootStackParamList, 'DeviceTerminal'>;

type TerminalLineKind = 'command' | 'stdout' | 'stderr' | 'system' | 'success';
type TerminalState = 'idle' | 'running' | 'completed' | 'failed' | 'stopped';

interface TerminalLine {
  id: string;
  kind: TerminalLineKind;
  content: string;
  timestamp: string;
}

const quickCommands = ['pwd', 'ls -la', 'git status', 'npm test', 'npm run lint'];

const terminalStateLabel: Record<TerminalState, string> = {
  idle: 'READY',
  running: 'RUNNING',
  completed: 'DONE',
  failed: 'FAILED',
  stopped: 'STOPPED',
};

const terminalStateType: Record<
  TerminalState,
  'success' | 'warning' | 'error' | 'neutral' | 'info'
> = {
  idle: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'error',
  stopped: 'warning',
};

const getTimestamp = () =>
  new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

const createTerminalLine = (
  kind: TerminalLineKind,
  content: string,
): TerminalLine => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  kind,
  content,
  timestamp: getTimestamp(),
});

const buildCommandOutput = (
  command: string,
  directory: string,
  deviceName: string,
): Array<Omit<TerminalLine, 'id' | 'timestamp'>> => {
  const normalized = command.trim().toLowerCase();

  if (normalized === 'pwd') {
    return [{ kind: 'stdout', content: directory }];
  }

  if (normalized === 'ls' || normalized === 'ls -la') {
    return [
      { kind: 'stdout', content: 'drwxr-xr-x  src' },
      { kind: 'stdout', content: 'drwxr-xr-x  ios' },
      { kind: 'stdout', content: 'drwxr-xr-x  android' },
      { kind: 'stdout', content: '-rw-r--r--  package.json' },
      { kind: 'stdout', content: '-rw-r--r--  README.md' },
    ];
  }

  if (normalized.startsWith('git status')) {
    return [
      { kind: 'stdout', content: 'On branch codex/mobile-terminal-control' },
      { kind: 'stdout', content: 'Changes not staged for commit:' },
      { kind: 'stdout', content: '  modified: src/screens/devices/DeviceDetailScreen.tsx' },
      { kind: 'stdout', content: '  new file: src/screens/devices/DeviceTerminalScreen.tsx' },
      { kind: 'success', content: 'Working tree scanned.' },
    ];
  }

  if (normalized.includes('npm run lint')) {
    return [
      { kind: 'system', content: 'Starting lint task on remote device agent.' },
      { kind: 'stdout', content: '> AliangVibeCodingPhone@0.0.1 lint' },
      { kind: 'stdout', content: '> eslint .' },
      { kind: 'success', content: 'Lint completed with no blocking errors.' },
    ];
  }

  if (normalized.includes('npm test')) {
    return [
      { kind: 'system', content: 'Starting Jest in single-device terminal session.' },
      { kind: 'stdout', content: 'PASS __tests__/App.test.tsx' },
      { kind: 'stdout', content: 'Tests: 1 passed, 1 total' },
      { kind: 'success', content: 'Exit code 0' },
    ];
  }

  if (normalized.includes('npm run build')) {
    return [
      { kind: 'system', content: 'Preparing build command.' },
      { kind: 'stderr', content: 'No build script is configured in package.json.' },
      { kind: 'stderr', content: 'Exit code 1' },
    ];
  }

  if (normalized.startsWith('cd ')) {
    return [
      {
        kind: 'stderr',
        content:
          'Directory changes are controlled by the directory selector in this mobile console.',
      },
    ];
  }

  if (normalized.includes('rm -rf') || normalized.includes('sudo rm')) {
    return [
      { kind: 'system', content: 'Command blocked by mobile safety policy.' },
      { kind: 'stderr', content: 'Destructive commands require desktop confirmation.' },
    ];
  }

  return [
    { kind: 'system', content: `Opening remote shell on ${deviceName}.` },
    { kind: 'stdout', content: `Executing in ${directory}` },
    { kind: 'stdout', content: command },
    { kind: 'success', content: 'Command accepted by device agent. Exit code 0' },
  ];
};

export const DeviceTerminalScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<DeviceTerminalRoute>();
  const outputRef = useRef<ScrollView>(null);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const device = mockDevices.find(item => item.id === route.params.deviceId);
  const directories = useMemo(
    () => device?.authorizedDirectories ?? [],
    [device?.authorizedDirectories],
  );
  const initialDirectory = route.params.directory ?? directories[0] ?? '~';

  const [directory, setDirectory] = useState(initialDirectory);
  const [command, setCommand] = useState('');
  const [terminalState, setTerminalState] = useState<TerminalState>(
    device?.status === 'offline' ? 'stopped' : 'idle',
  );
  const [lines, setLines] = useState<TerminalLine[]>(() => {
    const initialLines = [
      createTerminalLine(
        'system',
        device
          ? `Terminal session created on ${device.name}.`
          : 'Device is unavailable.',
      ),
      createTerminalLine('system', `Working directory: ${initialDirectory}`),
    ];

    if (device?.status === 'offline') {
      initialLines.push(
        createTerminalLine(
          'stderr',
          'Device is offline. Reconnect before executing commands.',
        ),
      );
    }

    return initialLines;
  });

  const isRunning = terminalState === 'running';
  const canExecute =
    Boolean(command.trim()) && Boolean(device) && device?.status !== 'offline' && !isRunning;

  const clearTimers = () => {
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current = [];
  };

  useEffect(() => {
    return clearTimers;
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      outputRef.current?.scrollToEnd({ animated: true });
    }, 60);

    return () => clearTimeout(timer);
  }, [lines.length]);

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

  const handleDirectoryChange = (nextDirectory: string) => {
    if (isRunning || nextDirectory === directory) {
      return;
    }

    setDirectory(nextDirectory);
    setLines(current => [
      ...current,
      createTerminalLine('system', `Working directory changed to ${nextDirectory}`),
    ]);
  };

  const handleClear = () => {
    clearTimers();
    setTerminalState(device?.status === 'offline' ? 'stopped' : 'idle');
    setLines([
      createTerminalLine('system', 'Terminal output cleared.'),
      createTerminalLine('system', `Working directory: ${directory}`),
    ]);
  };

  const handleStop = () => {
    if (!isRunning) {
      return;
    }

    clearTimers();
    setTerminalState('stopped');
    setLines(current => [
      ...current,
      createTerminalLine('system', 'Process interrupted from mobile control.'),
    ]);
  };

  const handleExecute = () => {
    const trimmed = command.trim();

    if (!canExecute || !device || !trimmed) {
      return;
    }

    if (trimmed.toLowerCase() === 'clear') {
      setCommand('');
      handleClear();
      return;
    }

    clearTimers();
    setCommand('');
    setTerminalState('running');
    setLines(current => [
      ...current,
      createTerminalLine('command', `${directory} $ ${trimmed}`),
    ]);

    const outputLines = buildCommandOutput(trimmed, directory, device.name);
    const didFail = outputLines.some(line => line.kind === 'stderr');

    outputLines.forEach((line, index) => {
      const timer = setTimeout(() => {
        setLines(current => [
          ...current,
          createTerminalLine(line.kind, line.content),
        ]);

        if (index === outputLines.length - 1) {
          timersRef.current = [];
          setTerminalState(didFail ? 'failed' : 'completed');
        }
      }, 420 * (index + 1));

      timersRef.current.push(timer);
    });
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

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Device Terminal"
        subtitle={device.name}
        onBack={navigation.goBack}
        rightAction={
          <StatusChip
            label={terminalStateLabel[terminalState]}
            type={terminalStateType[terminalState]}
          />
        }
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <GlassPanel style={styles.devicePanel}>
          <View style={styles.deviceHeader}>
            <View style={styles.deviceTitle}>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                REMOTE TERMINAL
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
              CPU {device.cpuLoad}%
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              MEM {device.memLoad}%
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
              Ports {device.activePorts.length || 0}
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
          {directories.map(item => {
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
              {lines.length} LINES
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
            {lines.map(line => (
              <View key={line.id} style={styles.outputLine}>
                <Text
                  style={[
                    theme.typography.codeSm,
                    styles.outputPrefix,
                    { color: getLineColor(line.kind) },
                  ]}>
                  {getLinePrefix(line.kind)}
                </Text>
                <Text
                  selectable
                  style={[
                    theme.typography.codeSm,
                    styles.outputText,
                    { color: getLineColor(line.kind) },
                  ]}>
                  {line.timestamp}  {line.content}
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
                device.status === 'offline'
                  ? 'Device offline'
                  : 'Type a command to execute...'
              }
              placeholderTextColor={theme.colors.onSurfaceVariant}
              editable={device.status !== 'offline' && !isRunning}
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
                disabled={isRunning || device.status === 'offline'}
                onPress={() => setCommand(item)}
                style={[
                  styles.quickCommand,
                  {
                    borderColor: theme.colors.outlineVariant,
                    borderRadius: theme.borderRadius.full,
                    opacity: isRunning || device.status === 'offline' ? 0.5 : 1,
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
              title={isRunning ? 'RUNNING' : 'EXECUTE'}
              onPress={handleExecute}
              variant="primary"
              disabled={!canExecute}
              style={styles.executeButton}
            />
            <GlowButton
              title="STOP"
              onPress={handleStop}
              variant="outline"
              disabled={!isRunning}
              style={styles.utilityButton}
            />
            <GlowButton
              title="CLEAR"
              onPress={handleClear}
              variant="outline"
              style={styles.utilityButton}
            />
          </View>
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
  devicePanel: {
    padding: 14,
    gap: 12,
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
    height: 310,
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
