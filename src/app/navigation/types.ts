import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

export type RootStackParamList = {
  Splash: undefined;
  Login: undefined;
  MainTabs: undefined;
  DeviceBinding: undefined;
  DeviceCameraScanner: undefined;
  DeviceDetail: { deviceId: string };
  DeviceTerminal: { deviceId: string; directory?: string; terminalId?: string };
  ProjectScan: { deviceId: string };
  ProjectDetail: { projectId: string; deviceId?: string };
  FileBrowser: { projectId: string; deviceId?: string; sessionId?: string };
  CreateVibeCoding: { deviceId?: string; projectId?: string };
  AgentSessions: { deviceId?: string; projectId?: string } | undefined;
  VibeCodingSession: { sessionId: string };
  EventStream: { deviceId?: string; sessionId?: string } | undefined;
  ApprovalCenter: undefined;
  NotificationCenter: undefined;
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
