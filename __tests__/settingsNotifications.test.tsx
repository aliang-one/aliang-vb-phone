import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { useSessionStore } from '../stores/useSettingsStore';
import { useToastStore } from '../src/store/toastStore';

jest.mock('../src/services/localNotifications', () => ({
  displayNotification: jest.fn(),
  getNotificationPermissionStatus: jest.fn(),
  openNotificationSettings: jest.fn(),
  requestPermission: jest.fn(),
}));

jest.mock('@react-navigation/native', () => {
  const ReactActual = require('react');
  return {
    useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactActual.useEffect(() => cb(), []);
    },
    useRoute: () => ({ params: {} }),
  };
});

jest.mock('../src/i18n/useLocale', () => ({
  useLocale: () => ({ locale: 'en', setLocale: jest.fn() }),
}));

// Heavy account/usage visual components read data props that are null in this
// harness — stub them so the render stays focused on the notification panel.
// (require() inside the factory — jest.mock factories hoist above imports, so
// the top-level `React` import is not in scope there.)
jest.mock('../src/components/vibecoding/UsageSummaryCard', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { UsageSummaryCard: () => R.createElement(View, null) };
});
jest.mock('../src/components/account/UserModelDefaultCard', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { UserModelDefaultCard: () => R.createElement(View, null) };
});
jest.mock('../src/components/visual/RingMeter', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { RingMeter: () => R.createElement(View, null) };
});

import { SettingsScreen } from '../src/screens/settings/SettingsScreen';
import {
  displayNotification,
  getNotificationPermissionStatus,
  openNotificationSettings,
  requestPermission,
} from '../src/services/localNotifications';

const flush = () =>
  act(async () => {
    await new Promise<void>(r => setTimeout(() => r(), 0));
    await new Promise<void>(r => setImmediate(() => r()));
  });

const findButtonByText = (
  root: ReactTestRenderer.ReactTestInstance,
  title: string,
) =>
  root
    .findAllByType(TouchableOpacity)
    .find(node =>
      node.findAllByType(Text).some(t => String(t.props.children) === title),
    );

type AppStateChangeHandler = (state: string) => void;
let appStateChangeHandlers: AppStateChangeHandler[] = [];
// Drive the captured AppState 'change' handlers (the screen subscribes on mount).
const emitAppState = (state: string) => {
  for (const handler of appStateChangeHandlers) handler(state);
};

const renderScreen = () =>
  ReactTestRenderer.create(
    <ThemeContext.Provider
      value={{
        theme: utilityMinimalist,
        mode: 'light',
        setMode: () => undefined,
        isDark: false,
      }}
    >
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
        }}
      >
        <SettingsScreen />
      </SafeAreaProvider>
    </ThemeContext.Provider>,
  );

describe('SettingsScreen notification panel', () => {
  let showSpy: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    appStateChangeHandlers = [];
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(
        (((event: string, handler: AppStateChangeHandler) => {
          if (event === 'change') appStateChangeHandlers.push(handler);
          return { remove: jest.fn() };
        }) as unknown) as typeof AppState.addEventListener,
      );
    (getNotificationPermissionStatus as jest.Mock).mockResolvedValue('denied');
    (openNotificationSettings as jest.Mock).mockResolvedValue(true);
    (requestPermission as jest.Mock).mockResolvedValue(true);
    (displayNotification as jest.Mock).mockResolvedValue(true);

    // Seed only render-critical state; rely on the real stores' defaults for
    // the rest (scalars/actions aren't exercised by the notification panel).
    useControlCenterStore.setState({
      devices: [],
      projects: [],
      vibeRuns: [],
      terminalSessions: [],
      approvals: [],
      notifications: [],
    });
    useSessionStore.setState({
      user: null,
      operatorName: '',
      accountData: null,
      notificationPrefs: {
        approval: true,
        session_done: true,
        session_failed: true,
        device_offline: true,
      },
    });
    showSpy = jest.fn();
    useToastStore.setState({ show: showSpy });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('the SEND TEST button is tappable (NOT disabled) when permission is denied', async () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = renderScreen();
    });
    await flush();

    // jest locks i18n to zh (see app-i18n memory), so titles render in Chinese.
    const testBtn = findButtonByText(r.root, '发送测试通知');
    expect(testBtn).toBeDefined();
    expect((testBtn!.props as { disabled?: boolean }).disabled).toBe(false);
  });

  test('pressing OPEN SYSTEM SETTINGS surfaces an error toast when it fails (no silent no-op)', async () => {
    (openNotificationSettings as jest.Mock).mockResolvedValue(false);
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = renderScreen();
    });
    await flush();

    const permBtn = findButtonByText(r.root, '打开系统通知设置');
    expect(permBtn).toBeDefined();
    await act(async () => {
      (permBtn!.props as { onPress: () => void }).onPress();
      await flush();
    });

    expect(showSpy).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  test('returning to the foreground refreshes permission, so SEND TEST sends instead of re-opening settings', async () => {
    // Mounted while still denied (user hasn't granted yet).
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = renderScreen();
    });
    await flush();

    // User grants in system settings; on return the app goes active and the
    // permission read now reflects the grant. React-Navigation focus does NOT
    // fire on app foreground, so without an AppState listener the status would
    // stay stale at 'denied' and the test button would re-open settings.
    (getNotificationPermissionStatus as jest.Mock).mockResolvedValue('authorized');
    emitAppState('active');
    await flush();

    const testBtn = findButtonByText(r.root, '发送测试通知');
    expect(testBtn).toBeDefined();
    await act(async () => {
      (testBtn!.props as { onPress: () => void }).onPress();
      await flush();
    });

    expect(displayNotification).toHaveBeenCalledTimes(1);
    expect(openNotificationSettings).not.toHaveBeenCalled();
  });
});
