import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { SplashScreen } from '../../screens/splash/SplashScreen';
import { LoginScreen } from '../../screens/auth/LoginScreen';
import { MainTabNavigator } from './MainTabNavigator';
import { DeviceBindingScreen } from '../../screens/devices/DeviceBindingScreen';
import { DeviceDetailScreen } from '../../screens/devices/DeviceDetailScreen';
import { DeviceTerminalScreen } from '../../screens/devices/DeviceTerminalScreen';
import { ProjectScanScreen } from '../../screens/devices/ProjectScanScreen';
import { ProjectDetailScreen } from '../../screens/projects/ProjectDetailScreen';
import { CreateVibeCodingScreen } from '../../screens/vibecoding/CreateVibeCodingScreen';
import { AgentSessionsScreen } from '../../screens/vibecoding/AgentSessionsScreen';
import { VibeCodingSessionScreen } from '../../screens/vibecoding/VibeCodingSessionScreen';
import { ApprovalCenterScreen } from '../../screens/operations/ApprovalCenterScreen';
import { EventStreamScreen } from '../../screens/operations/EventStreamScreen';
import { NotificationCenterScreen } from '../../screens/operations/NotificationCenterScreen';
import { PreviewScreen } from '../../screens/preview/PreviewScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator = () => {
  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false }}
      initialRouteName="Splash">
      <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="MainTabs" component={MainTabNavigator} />
      <Stack.Screen name="DeviceBinding" component={DeviceBindingScreen} />
      <Stack.Screen name="DeviceDetail" component={DeviceDetailScreen} />
      <Stack.Screen name="DeviceTerminal" component={DeviceTerminalScreen} />
      <Stack.Screen name="ProjectScan" component={ProjectScanScreen} />
      <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} />
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
