import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  createNativeStackNavigator,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { RootStackParamList } from './types';
import { MainTabNavigator } from './MainTabNavigator';
import { LoginScreen } from '../../screens/auth/LoginScreen';
import { DeviceBindingScreen } from '../../screens/devices/DeviceBindingScreen';
import { DeviceCameraScannerScreen } from '../../screens/devices/DeviceCameraScannerScreen';
import { DeviceDetailScreen } from '../../screens/devices/DeviceDetailScreen';
import { DeviceTerminalScreen } from '../../screens/devices/DeviceTerminalScreen';
import { ProjectScanScreen } from '../../screens/devices/ProjectScanScreen';
import { ProjectDetailScreen } from '../../screens/projects/ProjectDetailScreen';
import { FileBrowserScreen } from '../../screens/projects/FileBrowserScreen';
import { CreateVibeCodingScreen } from '../../screens/vibecoding/CreateVibeCodingScreen';
import { AgentSessionsScreen } from '../../screens/vibecoding/AgentSessionsScreen';
import { VibeCodingSessionScreen } from '../../screens/vibecoding/VibeCodingSessionScreen';
import { SessionSettingsScreen } from '../../screens/vibecoding/SessionSettingsScreen';
import { ApprovalCenterScreen } from '../../screens/operations/ApprovalCenterScreen';
import { EventStreamScreen } from '../../screens/operations/EventStreamScreen';
import { NotificationCenterScreen } from '../../screens/operations/NotificationCenterScreen';
import { PreviewScreen } from '../../screens/preview/PreviewScreen';
import { useControlCenterStore } from '../../store/controlCenterStore';
import type { TerminalCommandHistoryItem, TerminalSession } from '../../store/types';
import { useTheme } from '../../theme/useTheme';
import { useSessionStore } from '../../../stores/useSettingsStore';
import { usePresenceHeartbeat } from '../../hooks/usePresenceHeartbeat';
import { useIdleSessionDemoter } from '../../hooks/useIdleSessionDemoter';
import { isSessionInvalidError } from '../../api/sessionAuth';
import {
  FIRST_ONLINE_DEVICE_TARGET,
  type DebugDeviceTerminalTarget,
} from '../debugInitialProps';

const Stack = createNativeStackNavigator<RootStackParamList>();
type Navigation = NativeStackNavigationProp<RootStackParamList>;
type DebugDeviceTerminalRoute = RouteProp<
  RootStackParamList,
  'DebugDeviceTerminalBootstrap'
>;

type RootNavigatorProps = {
  debugDeviceTerminal?: DebugDeviceTerminalTarget;
};

const directoryFromCommand = (command?: string) => {
  const trimmed = command?.trim();
  return trimmed?.startsWith('cd ') ? trimmed.slice(3).trim() : undefined;
};

const targetDirectory = ({
  target,
  terminal,
  commandHint,
  authorizedDirectories,
}: {
  target: DebugDeviceTerminalTarget;
  terminal?: TerminalSession;
  commandHint?: TerminalCommandHistoryItem;
  authorizedDirectories: string[];
}) =>
  target.directory ??
  terminal?.directory ??
  directoryFromCommand(commandHint?.command) ??
  authorizedDirectories[0] ??
  '~';

const DebugDeviceTerminalBootstrap: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<DebugDeviceTerminalRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const terminalSessions = useControlCenterStore(
    state => state.terminalSessions,
  );
  const terminalCommandHistory = useControlCenterStore(
    state => state.terminalCommandHistory,
  );
  const createTerminalSession = useControlCenterStore(
    state => state.createTerminalSession,
  );
  const serverMode = useControlCenterStore(state => state.serverMode);
  const target = route.params.target;
  const hasNavigatedRef = useRef(false);

  useEffect(() => {
    if (hasNavigatedRef.current || !serverMode) return;

    const device =
      target.deviceId === FIRST_ONLINE_DEVICE_TARGET || !target.deviceId
        ? devices.find(item => item.status === 'online') ?? devices[0]
        : devices.find(item => item.id === target.deviceId);

    if (!device) return;

    const targetTerminal = target.terminalId
      ? terminalSessions.find(
          item => item.id === target.terminalId && item.deviceId === device.id,
        )
      : undefined;
    const runningTerminal =
      targetTerminal ??
      terminalSessions.find(
        item => item.deviceId === device.id && item.status === 'running',
      );
    const commandHint = terminalCommandHistory[`device:${device.id}`]?.[0];
    const directory = targetDirectory({
      target,
      terminal: runningTerminal,
      commandHint,
      authorizedDirectories: device.authorizedDirectories,
    });

    if (!runningTerminal) {
      hasNavigatedRef.current = true;
      createTerminalSession(device.id, directory)
        .then(terminalId => {
          navigation.replace('DeviceTerminal', {
            deviceId: device.id,
            directory,
            terminalId,
          });
        })
        .catch(error => {
          console.warn('[navigation] Debug terminal bootstrap failed:', error);
          navigation.replace('DeviceDetail', { deviceId: device.id });
        });
      return;
    }

    hasNavigatedRef.current = true;
    navigation.replace('DeviceTerminal', {
      deviceId: device.id,
      directory,
      terminalId: runningTerminal.id,
    });
  }, [
    devices,
    createTerminalSession,
    navigation,
    terminalCommandHistory,
    serverMode,
    target,
    target.deviceId,
    target.directory,
    target.terminalId,
    terminalSessions,
  ]);

  return (
    <View style={[styles.loading, { backgroundColor: theme.colors.background }]}>
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  );
};

export const RootNavigator = ({ debugDeviceTerminal }: RootNavigatorProps) => {
  const { theme } = useTheme();
  const hasHydrated = useSessionStore(state => state.hasHydrated);
  const token = useSessionStore(state => state.token);
  const restoreUser = useSessionStore(state => state.restoreUser);
  const serverMode = useControlCenterStore(state => state.serverMode);
  const initializeFromServer = useControlCenterStore(
    state => state.initializeFromServer,
  );
  const syncingRef = useRef(false);
  // Foreground re-sync safety net. WS has no replay buffer and React Native
  // keeps the socket "connected" across a background suspension (no onclose/
  // onopen), so a backend restart while the app was backgrounded leaves the
  // phone on a stale snapshot — device shows offline forever even though the
  // agent reconnected (admin shows online). On every background→foreground hop
  // this pulls a fresh snapshot (device online) and re-establishes presence.
  // Self-guards on serverMode, so it's safe to mount unconditionally at the root.
  usePresenceHeartbeat();
  // Bounds resident AI-session memory: demotes sessions the user isn't viewing
  // when the app backgrounds and on a coarse interval. Self-guards on serverMode.
  useIdleSessionDemoter();
  const initialRouteName =
    token && debugDeviceTerminal
      ? 'DebugDeviceTerminalBootstrap'
      : token
      ? 'MainTabs'
      : 'Login';

  useEffect(() => {
    if (!hasHydrated || !token || serverMode || syncingRef.current) return;

    syncingRef.current = true;
    restoreUser()
      .then(() => initializeFromServer(token))
      .catch(error => {
        // A dead/expired session is already torn down centrally (token cleared →
        // this effect re-runs and renders Login). Don't log it as a scary
        // failure. Only transient errors (network/server) are worth a warning.
        if (isSessionInvalidError(error)) {
          return;
        }
        console.warn('[navigation] Platform auto-connect failed:', error);
      })
      .finally(() => {
        syncingRef.current = false;
      });
  }, [hasHydrated, initializeFromServer, restoreUser, serverMode, token]);

  if (!hasHydrated) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false }}
      initialRouteName={initialRouteName}>
      {!token ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : (
        <>
          {debugDeviceTerminal ? (
            <Stack.Screen
              name="DebugDeviceTerminalBootstrap"
              component={DebugDeviceTerminalBootstrap}
              initialParams={{ target: debugDeviceTerminal }}
            />
          ) : null}
          <Stack.Screen name="MainTabs" component={MainTabNavigator} />
          <Stack.Screen name="DeviceBinding" component={DeviceBindingScreen} />
          <Stack.Screen name="DeviceCameraScanner" component={DeviceCameraScannerScreen} />
          <Stack.Screen name="DeviceDetail" component={DeviceDetailScreen} />
          <Stack.Screen name="DeviceTerminal" component={DeviceTerminalScreen} />
          <Stack.Screen name="ProjectScan" component={ProjectScanScreen} />
          <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} />
          <Stack.Screen name="FileBrowser" component={FileBrowserScreen} />
          <Stack.Screen name="CreateVibeCoding" component={CreateVibeCodingScreen} />
          <Stack.Screen name="AgentSessions" component={AgentSessionsScreen} />
          <Stack.Screen name="VibeCodingSession" component={VibeCodingSessionScreen} />
          <Stack.Screen name="SessionSettings" component={SessionSettingsScreen} />
          <Stack.Screen name="EventStream" component={EventStreamScreen} />
          <Stack.Screen name="ApprovalCenter" component={ApprovalCenterScreen} />
          <Stack.Screen name="NotificationCenter" component={NotificationCenterScreen} />
          <Stack.Screen name="Preview" component={PreviewScreen} />
        </>
      )}
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
