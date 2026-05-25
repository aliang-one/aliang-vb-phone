import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MainTabParamList } from './types';
import { CommandCenterScreen } from '../../screens/projects/CommandCenterScreen';
import { TerminalListScreen } from '../../screens/terminals/TerminalListScreen';
import { SettingsScreen } from '../../screens/settings/SettingsScreen';
import { BottomNavBar } from '../../components/layout/BottomNavBar';

const Tab = createBottomTabNavigator<MainTabParamList>();

export const MainTabNavigator = () => {
  return (
    <Tab.Navigator
      tabBar={props => <BottomNavBar {...props} />}
      screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Projects" component={CommandCenterScreen} />
      <Tab.Screen name="Terminals" component={TerminalListScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
};
