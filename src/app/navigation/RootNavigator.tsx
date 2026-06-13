import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
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
import { ApprovalCenterScreen } from '../../screens/operations/ApprovalCenterScreen';
import { EventStreamScreen } from '../../screens/operations/EventStreamScreen';
import { NotificationCenterScreen } from '../../screens/operations/NotificationCenterScreen';
import { PreviewScreen } from '../../screens/preview/PreviewScreen';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { useTheme } from '../../theme/useTheme';
import { useSessionStore } from '../../../stores/useSettingsStore';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator = () => {
  const { theme } = useTheme();
  const hasHydrated = useSessionStore(state => state.hasHydrated);
  const isAuthenticated = useSessionStore(state => state.isAuthenticated);
  const restoreUser = useSessionStore(state => state.restoreUser);
  const logout = useSessionStore(state => state.logout);
  const serverMode = useControlCenterStore(state => state.serverMode);
  const initializeFromServer = useControlCenterStore(state => state.initializeFromServer);
  const resetSessionData = useControlCenterStore(state => state.resetSessionData);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated || serverMode || syncingRef.current) return;

    syncingRef.current = true;
    restoreUser()
      .then(initializeFromServer)
      .catch(error => {
        console.warn('[navigation] Platform auto-connect failed:', error);
        resetSessionData();
        logout();
      })
      .finally(() => {
        syncingRef.current = false;
      });
  }, [hasHydrated, initializeFromServer, isAuthenticated, logout, resetSessionData, restoreUser, serverMode]);

  if (!hasHydrated) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false }}
      initialRouteName="MainTabs">
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
      <Stack.Screen name="EventStream" component={EventStreamScreen} />
      <Stack.Screen name="ApprovalCenter" component={ApprovalCenterScreen} />
      <Stack.Screen name="NotificationCenter" component={NotificationCenterScreen} />
      <Stack.Screen name="Preview" component={PreviewScreen} />
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
