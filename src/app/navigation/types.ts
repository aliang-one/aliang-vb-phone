import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { DebugDeviceTerminalTarget } from '../debugInitialProps';
import type { EffortProvider } from '../../utils/modelIntensity';

export type RootStackParamList = {
  Login: undefined;
  MainTabs: undefined;
  DebugDeviceTerminalBootstrap: { target: DebugDeviceTerminalTarget };
  DeviceCameraScanner: undefined;
  DeviceDetail: { deviceId: string };
  DeviceTerminal: {
    deviceId: string;
    directory?: string;
    terminalId?: string;
    initialCommand?: string;
  };
  ProjectScan: { deviceId: string };
  ProjectDetail: { projectId: string; deviceId?: string };
  ProjectSettings: { projectId: string; deviceId?: string };
  FileBrowser: { projectId: string; deviceId?: string; sessionId?: string };
  ChangeReview: { projectId: string; deviceId?: string };
  CreateVibeCoding: { deviceId?: string; projectId?: string };
  // VibeCodingSession doubles as the "new conversation" screen: when opened
  // with draftConfig and no sessionId, it renders in draft mode (idle, empty
  // transcript, enabled composer) — no server interaction until the first
  // message. The first send creates the session with that message.
  VibeCodingSession: {
    sessionId?: string;
    approvalId?: string;
    draftConfig?: {
      deviceId: string;
      projectId?: string;
      directory: string;
      provider: EffortProvider;
      model?: string;
      effort?: string;
      pendingRequestId?: string;
      pendingRequestFingerprint?: string;
    };
  };
  GoalDetail: { goalId: string; sourceSessionId?: string };
  AgentSessions: { deviceId?: string; projectId?: string } | undefined;
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
