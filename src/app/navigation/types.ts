import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import type { DebugDeviceTerminalTarget } from '../debugInitialProps';
import type { EffortProvider } from '../../utils/modelIntensity';

export type RootStackParamList = {
  Login: undefined;
  // 带 screen 参数跳转(Me 页引导)需要嵌套参数类型;undefined 会让
  // push('MainTabs', { screen: 'Account' }) 无法类型通过。
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  DebugDeviceTerminalBootstrap: { target: DebugDeviceTerminalTarget };
  // 扫码屏的两种用途:缺省(既有 4 处调用点不传参)= 官网「扫码登录」;
  // mode: 'terminalWebPair' = 终端网页扫码配对(Task 11),由终端屏快捷键
  // 入口(Task 12)进入,确认后授权 terminal.aliang.one 访问该终端会话。
  DeviceCameraScanner: {
    mode?: 'scanLogin' | 'terminalWebPair';
    /** terminalWebPair:配对批准要绑定的目标设备(确认弹窗展示设备名)。 */
    deviceId?: string;
    /** terminalWebPair:配对批准要绑定的终端会话 id(approve 必传)。 */
    terminalId?: string;
    /** terminalWebPair:终端当前工作目录(确认弹窗展示)。 */
    directory?: string;
  } | undefined;
  DeviceDetail: { deviceId: string };
  PortMappings: { deviceId: string };
  DeviceTerminal: {
    deviceId: string;
    directory?: string;
    terminalId?: string;
    initialCommand?: string;
    /**
     * Explicit "brand-new session" entry (e.g. the list screen's NEW TERM
     * capsule): skips the screen's attach-first resolution and always creates
     * a fresh pty, even when the device already has an active session.
     */
    newSession?: boolean;
  };
  ProjectScan: { deviceId: string };
  ProjectDetail: { projectId: string; deviceId?: string };
  ProjectPorts: { projectId: string; deviceId?: string };
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
      approvalScheme?: 'allow_all' | 'ask_all' | 'read_only';
      canRead?: boolean;
      canModify?: boolean;
      canRun?: boolean;
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
