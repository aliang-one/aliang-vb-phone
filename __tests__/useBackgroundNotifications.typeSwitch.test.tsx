import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { useSessionStore } from '../stores/useSettingsStore';
import {
  displayManagedNotification,
  getNotificationPermissionStatus,
  requestPermission,
} from '../src/services/localNotifications';
import { useBackgroundNotifications } from '../src/hooks/useBackgroundNotifications';
import type { NotifiableEventType, NotificationPrefs } from '../src/utils/notificationDeliveryPolicy';

jest.mock('../src/services/localNotifications', () => ({
  requestPermission: jest.fn(),
  getNotificationPermissionStatus: jest.fn(),
  displayManagedNotification: jest.fn(),
}));

function Probe(): null {
  useBackgroundNotifications({ enabled: true, userId: 'u1' });
  return null;
}

type Handler = (state: string) => void;
let handlers: Handler[] = [];
// check() 每次决策都会从真实 AppState 重同步 isBackground——harness 里
// currentState 与 change 事件必须同步演化，事件才等价于真实状态迁移。
let mockAppState: 'inactive' | 'active' | 'background' = 'active';
let originalStateDescriptor: PropertyDescriptor | undefined;
// jest 环境里 currentState 是普通值属性（无 get 存取器），spyOn('get') 不可用，
// 用 defineProperty 覆写并在场景结束还原。
const spyAppState = () => {
  originalStateDescriptor = Object.getOwnPropertyDescriptor(
    AppState,
    'currentState',
  );
  Object.defineProperty(AppState, 'currentState', {
    get: () => mockAppState,
    configurable: true,
  });
};
const restoreAppState = () => {
  if (originalStateDescriptor) {
    Object.defineProperty(AppState, 'currentState', originalStateDescriptor);
    originalStateDescriptor = undefined;
  }
};
const flush = () =>
  act(async () => {
    await new Promise<void>(r => setTimeout(() => r(), 0));
    await new Promise<void>(r => setImmediate(() => r()));
  });

const ALL_TYPES: NotifiableEventType[] = [
  'approval', 'session_done', 'session_failed', 'device_offline', 'device_online',
];

const serverItem = (id: string, type: NotifiableEventType) => ({
  id,
  type: type === 'session_done' ? 'completed' : type === 'session_failed' ? 'error' : type,
  title: 't', body: 'b', read: false, createdAt: new Date().toISOString(),
  deviceId: type === 'device_offline' || type === 'device_online' ? 'd1' : undefined,
  sessionId: type === 'session_done' || type === 'session_failed' ? 's1' : undefined,
  approvalId: type === 'approval' ? 'a1' : undefined,
});

async function scenario(type: NotifiableEventType, enabled: boolean): Promise<number> {
  jest.clearAllMocks();
  handlers = [];
  mockAppState = 'active';
  spyAppState();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((((event: string, handler: Handler) => {
      if (event === 'change') handlers.push(handler);
      return { remove: jest.fn() };
    }) as unknown) as typeof AppState.addEventListener);
  (requestPermission as jest.Mock).mockResolvedValue(true);
  (getNotificationPermissionStatus as jest.Mock).mockResolvedValue('authorized');
  (displayManagedNotification as jest.Mock).mockResolvedValue(true);
  const prefs = Object.fromEntries(ALL_TYPES.map(t => [t, true])) as NotificationPrefs;
  useSessionStore.setState({ notificationPrefs: { ...prefs, [type]: enabled } });
  useControlCenterStore.setState({ notifications: [] });

  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { r = ReactTestRenderer.create(<Probe />); });
  await flush();
  mockAppState = 'background';
  for (const h of handlers) h('background');   // 进入后台 → snapshot + 权限检查
  await flush();
  await act(async () => {                       // 新通知到达 → store subscribe 触发 check
    useControlCenterStore.setState({
      notifications: [serverItem('n1', type) as never],
    });
  });
  await flush();
  const calls = (displayManagedNotification as jest.Mock).mock.calls.length;
  act(() => { r.unmount(); });
  restoreAppState();
  return calls;
}

describe('background delivery honours per-type switches', () => {
  test.each(ALL_TYPES)('%s: on → delivered, off → suppressed', async type => {
    expect(await scenario(type, true)).toBe(1);
    expect(await scenario(type, false)).toBe(0);
  });

  test('re-enabling mid-window: suppressed type never books dedupe, so a later event still delivers', async () => {
    jest.clearAllMocks(); handlers = [];
    mockAppState = 'active';
    spyAppState();
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((((event: string, handler: Handler) => {
        if (event === 'change') handlers.push(handler);
        return { remove: jest.fn() };
      }) as unknown) as typeof AppState.addEventListener);
    (requestPermission as jest.Mock).mockResolvedValue(true);
    (getNotificationPermissionStatus as jest.Mock).mockResolvedValue('authorized');
    (displayManagedNotification as jest.Mock).mockResolvedValue(true);
    const prefs = Object.fromEntries(ALL_TYPES.map(t => [t, true])) as NotificationPrefs;
    useSessionStore.setState({ notificationPrefs: { ...prefs, session_done: false } });
    useControlCenterStore.setState({ notifications: [] });

    let r!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { r = ReactTestRenderer.create(<Probe />); });
    await flush();
    mockAppState = 'background';
    for (const h of handlers) h('background');
    await flush();
    useSessionStore.setState({ notificationPrefs: { ...prefs, session_done: true } });
    await act(async () => {
      useControlCenterStore.setState({ notifications: [serverItem('n2', 'session_done') as never] });
    });
    await flush();
    expect((displayManagedNotification as jest.Mock).mock.calls.length).toBe(1);
    act(() => { r.unmount(); });
    restoreAppState();
  });

  test('cold-start mis-read of AppState is corrected at permission-resolve (foreground login never delivers)', async () => {
    // iOS 冷启动瞬间 AppState.currentState 可能报 'initial'/'inactive'，挂载时
    // 被误读为「后台」；纠正用的 change 事件可能已错过 → isBackground 驻留 true。
    // 权限解析时必须按真实状态重同步：前台登录的快照回填绝不能按后台投递。
    jest.clearAllMocks();
    handlers = [];
    mockAppState = 'inactive';
    spyAppState();
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((((event: string, handler: Handler) => {
        if (event === 'change') handlers.push(handler);
        return { remove: jest.fn() };
      }) as unknown) as typeof AppState.addEventListener);
    (requestPermission as jest.Mock).mockResolvedValue(true);
    (getNotificationPermissionStatus as jest.Mock).mockResolvedValue('authorized');
    (displayManagedNotification as jest.Mock).mockResolvedValue(true);
    const prefs = Object.fromEntries(ALL_TYPES.map(t => [t, true])) as NotificationPrefs;
    useSessionStore.setState({ notificationPrefs: prefs });
    useControlCenterStore.setState({ notifications: [] });

    let r!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { r = ReactTestRenderer.create(<Probe />); });
    await flush();
    // 冷启动完成、真实状态回到 active——注意没有触发任何 change 事件（正是误判驻留场景）
    mockAppState = 'active';
    // 登录快照落地：历史通知进 store
    await act(async () => {
      useControlCenterStore.setState({
        notifications: [serverItem('n1', 'session_done') as never],
      });
    });
    await flush();

    expect((displayManagedNotification as jest.Mock).mock.calls.length).toBe(0);
    act(() => { r.unmount(); });
    restoreAppState();
  });
});
