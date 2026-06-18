import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { DebugDeviceTerminalTarget } from '../debugInitialProps';

export type RootStackParamList = {
  Login: undefined;
  MainTabs: undefined;
  DebugDeviceTerminalBootstrap: { target: DebugDeviceTerminalTarget };
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
  SessionSettings: { sessionId: string };
  EventStream:
    | { deviceId?: string; sessionId?: string; scope?: 'conversation' }
    | undefined;
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
