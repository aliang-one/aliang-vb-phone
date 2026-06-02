import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

export type RootStackParamList = {
  Splash: undefined;
  Login: undefined;
  MainTabs: undefined;
  DeviceDetail: { deviceId: string };
  DeviceTerminal: { deviceId: string; directory?: string };
  ProjectDetail: { projectId: string; deviceId?: string };
  CreateVibeCoding: { deviceId?: string; projectId?: string };
  VibeCodingSession: { sessionId: string };
  Preview: { previewId: string };
};

export type MainTabParamList = {
  Dashboard: undefined;
  Devices: undefined;
  VibeCoding: undefined;
  Account: undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type MainTabScreenProps<T extends keyof MainTabParamList> =
  BottomTabScreenProps<MainTabParamList, T>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
