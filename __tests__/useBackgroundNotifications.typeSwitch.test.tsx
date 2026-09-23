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
  title: 't', body: 'b', read: false, createdAt: '2026-09-23T00:00:00Z',
  deviceId: type === 'device_offline' || type === 'device_online' ? 'd1' : undefined,
  sessionId: type === 'session_done' || type === 'session_failed' ? 's1' : undefined,
  approvalId: type === 'approval' ? 'a1' : undefined,
});

async function scenario(type: NotifiableEventType, enabled: boolean): Promise<number> {
  jest.clearAllMocks();
  handlers = [];
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
  for (const h of handlers) h('background');   // 进入后台 → snapshot + 权限检查
  await flush();
  await act(async () => {                       // 新通知到达 → store subscribe 触发 check
    useControlCenterStore.setState({
      notifications: [serverItem('n1', type) as never],
    });
  });
  await flush();
  act(() => { r.unmount(); });
  return (displayManagedNotification as jest.Mock).mock.calls.length;
}

describe('background delivery honours per-type switches', () => {
  test.each(ALL_TYPES)('%s: on → delivered, off → suppressed', async type => {
    expect(await scenario(type, true)).toBe(1);
    expect(await scenario(type, false)).toBe(0);
  });

  test('re-enabling mid-window: suppressed type never books dedupe, so a later event still delivers', async () => {
    jest.clearAllMocks(); handlers = [];
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
    for (const h of handlers) h('background');
    await flush();
    useSessionStore.setState({ notificationPrefs: { ...prefs, session_done: true } });
    await act(async () => {
      useControlCenterStore.setState({ notifications: [serverItem('n2', 'session_done') as never] });
    });
    await flush();
    expect((displayManagedNotification as jest.Mock).mock.calls.length).toBe(1);
    act(() => { r.unmount(); });
  });
});
