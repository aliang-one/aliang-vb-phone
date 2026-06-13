import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MainTabParamList } from './types';
import { CommandCenterScreen } from '../../screens/projects/CommandCenterScreen';
import { TerminalListScreen } from '../../screens/terminals/TerminalListScreen';
import { VibeCodingListScreen } from '../../screens/vibecoding/VibeCodingListScreen';
import { SettingsScreen } from '../../screens/settings/SettingsScreen';
import { BottomNavBar } from '../../components/layout/BottomNavBar';

const Tab = createBottomTabNavigator<MainTabParamList>();
const renderTabBar = (props: React.ComponentProps<typeof BottomNavBar>) => (
  <BottomNavBar {...props} />
);

export const MainTabNavigator = () => {
  return (
    <Tab.Navigator
      tabBar={renderTabBar}
      screenOptions={{ headerShown: false }}
      initialRouteName="Devices">
      <Tab.Screen name="Dashboard" component={CommandCenterScreen} />
      <Tab.Screen name="Devices" component={TerminalListScreen} />
      <Tab.Screen name="VibeCoding" component={VibeCodingListScreen} />
      <Tab.Screen name="Account" component={SettingsScreen} />
    </Tab.Navigator>
  );
};
