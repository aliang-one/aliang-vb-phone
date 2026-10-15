/**
 * 「关于」子页 + Me 页入口行(2026-10-15 重构)。
 *
 * 覆盖:AboutScreen 渲染四行与返回;手动检查更新两种终态 toast;删除账号
 * 弹窗 401 内显不关弹窗 / 成功关闭;Me 页只剩入口行(navigate('About')),
 * 迁移走的行(check-update / delete-account / app-version)不再出现。
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { useSessionStore } from '../stores/useSettingsStore';
import { useToastStore } from '../src/store/toastStore';
import {
  useAppUpdateStore,
  resetAppUpdateStoreForTest,
} from '../src/store/appUpdateStore';
import { fetchUpdateCheck } from '../src/api/appUpdate';
import { ApiResponseError } from '../src/api/client';

let mockVersionName: string | null = 'v1.0.6';

jest.mock('../src/api/appUpdate', () => ({
  APP_UPDATE_SOFTWARE_NAME: 'aliang-vibe-phone',
  fetchUpdateCheck: jest.fn(),
}));

jest.mock('../src/native/AppVersion', () => ({
  getInstalledAppVersion: jest.fn(() =>
    mockVersionName
      ? { versionName: mockVersionName, versionCode: '3' }
      : null,
  ),
}));

const navGoBack = jest.fn();
const navNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: navGoBack, navigate: navNavigate }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    React.useEffect(() => cb(), []);
  },
  useRoute: () => ({ params: {} }),
}));

jest.mock('../src/services/localNotifications', () => ({
  displayNotification: jest.fn(),
  getNotificationPermissionStatus: jest.fn(),
  openNotificationSettings: jest.fn(),
  requestPermission: jest.fn(),
}));

// Me 页的重型可视组件与本测试无关,stub 掉让渲染聚焦在入口行。
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

import { AboutScreen } from '../src/screens/settings/AboutScreen';
import { SettingsScreen } from '../src/screens/settings/SettingsScreen';

const mockedFetch = fetchUpdateCheck as jest.MockedFunction<
  typeof fetchUpdateCheck
>;

const flush = () =>
  act(async () => {
    await new Promise<void>(r => setTimeout(() => r(), 0));
    await new Promise<void>(r => setImmediate(() => r()));
  });

const renderIn = (screen: React.ReactNode) => {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
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
          {screen}
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
  });
  return r;
};

const findButtonByText = (
  root: ReactTestRenderer.ReactTestInstance,
  title: string,
) =>
  root
    .findAllByType(TouchableOpacity)
    .find(node =>
      node.findAllByType(Text).some(t => String(t.props.children) === title),
    );

const pressRow = async (
  root: ReactTestRenderer.ReactTestInstance,
  testID: string,
) => {
  const row = root.findByProps({ testID });
  await act(async () => {
    (row.props as { onPress: () => void }).onPress();
    await flush();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockVersionName = 'v1.0.6';
  mockedFetch.mockReset();
  resetAppUpdateStoreForTest();
  useControlCenterStore.setState({
    devices: [],
    projects: [],
    vibeRuns: [],
    terminalSessions: [],
    approvals: [],
    notifications: [],
  });
  useSessionStore.setState({ user: null, accountData: null });
});

describe('AboutScreen', () => {
  it('renders version / check-update / privacy / delete rows and goes back', async () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    r = renderIn(<AboutScreen />);
    await flush();
    expect(navGoBack).not.toHaveBeenCalled();

    const version = r.root.findByProps({ testID: 'settings-app-version' });
    expect(String(version.props.children)).toContain('v1.0.6 (3)');
    expect(r.root.findByProps({ testID: 'settings-check-update-row' })).toBeTruthy();
    expect(r.root.findByProps({ testID: 'settings-delete-account-row' })).toBeTruthy();
    expect(findButtonByText(r.root, '隐私政策')).toBeDefined();

    const back = findButtonByText(r.root, '<');
    expect(back).toBeDefined();
    await act(async () => {
      (back!.props as { onPress: () => void }).onPress();
    });
    expect(navGoBack).toHaveBeenCalledTimes(1);
  });

  it('manual check when up to date shows the success toast', async () => {
    mockedFetch.mockResolvedValue({
      latestVersion: 'v1.0.6',
      downloadUrl: 'https://www.aliang.one/download',
      changelog: '',
      serverForceFlag: false,
    });
    const show = jest.fn();
    useToastStore.setState({ show });

    let r!: ReactTestRenderer.ReactTestRenderer;
    r = renderIn(<AboutScreen />);
    await flush();
    await pressRow(r.root, 'settings-check-update-row');

    expect(useAppUpdateStore.getState().status).toBe('upToDate');
    expect(show).toHaveBeenCalledWith('已是最新版本。', 'success');
  });

  it('manual check failure surfaces the error toast', async () => {
    mockedFetch.mockRejectedValue(new Error('network down'));
    const show = jest.fn();
    useToastStore.setState({ show });

    let r!: ReactTestRenderer.ReactTestRenderer;
    r = renderIn(<AboutScreen />);
    await flush();
    await pressRow(r.root, 'settings-check-update-row');

    expect(useAppUpdateStore.getState().status).toBe('error');
    expect(show).toHaveBeenCalledWith('检查更新失败,请稍后重试。', 'error');
  });

  it('官网无配置行(404→null)是「没查成」:失败反馈而非谎报已最新', async () => {
    mockedFetch.mockResolvedValue(null as never);
    const show = jest.fn();
    useToastStore.setState({ show });

    let r!: ReactTestRenderer.ReactTestRenderer;
    r = renderIn(<AboutScreen />);
    await flush();
    await pressRow(r.root, 'settings-check-update-row');

    expect(useAppUpdateStore.getState().status).toBe('upToDate');
    expect(useAppUpdateStore.getState().lastCheckDecided).toBe(false);
    expect(show).toHaveBeenCalledWith('检查更新失败,请稍后重试。', 'error');
    expect(show).not.toHaveBeenCalledWith('已是最新版本。', 'success');
  });

  it('delete account 401 keeps the modal open and shows the inline error', async () => {
    const deleteAccount = jest
      .fn()
      .mockRejectedValue(new ApiResponseError('unauthorized', 401));
    const disconnectFromServer = jest.fn();
    const resetSessionData = jest.fn();
    useSessionStore.setState({
      deleteAccount,
      logout: jest.fn().mockResolvedValue(undefined),
      clearSavedCredentials: jest.fn().mockResolvedValue(undefined),
      refreshAccountData: jest.fn().mockResolvedValue(undefined),
    });
    useControlCenterStore.setState({
      disconnectFromServer,
      resetSessionData,
    });
    const show = jest.fn();
    useToastStore.setState({ show });

    let r!: ReactTestRenderer.ReactTestRenderer;
    r = renderIn(<AboutScreen />);
    await flush();
    await pressRow(r.root, 'settings-delete-account-row');

    const input = r.root.findByProps({ testID: 'settings-delete-password' });
    await act(async () => {
      (input.props as { onChangeText: (v: string) => void }).onChangeText('pw');
    });
    const confirmProps = r.root.findByProps({
      testID: 'settings-delete-confirm',
    }).props as { disabled: boolean; onPress: () => void };
    expect(confirmProps.disabled).toBe(false);
    await act(async () => {
      confirmProps.onPress();
      await flush();
    });

    expect(disconnectFromServer).toHaveBeenCalled();
    expect(resetSessionData).toHaveBeenCalled();
    expect(deleteAccount).toHaveBeenCalledWith('pw');
    // 失败必须留在弹窗里:密码输入框仍在 + 内显 401 文案 + 不弹成功 toast。
    expect(r.root.findByProps({ testID: 'settings-delete-password' })).toBeTruthy();
    const error = r.root.findByProps({ testID: 'settings-delete-error' });
    expect(String(error.props.children)).toBe('密码不正确,请重试。');
    expect(show).not.toHaveBeenCalled();
  });

  it('delete account success closes the modal and toasts', async () => {
    const deleteAccount = jest.fn().mockResolvedValue(undefined);
    useSessionStore.setState({
      deleteAccount,
      logout: jest.fn().mockResolvedValue(undefined),
      clearSavedCredentials: jest.fn().mockResolvedValue(undefined),
      refreshAccountData: jest.fn().mockResolvedValue(undefined),
    });
    useControlCenterStore.setState({
      disconnectFromServer: jest.fn(),
      resetSessionData: jest.fn(),
    });
    const show = jest.fn();
    useToastStore.setState({ show });

    let r!: ReactTestRenderer.ReactTestRenderer;
    r = renderIn(<AboutScreen />);
    await flush();
    await pressRow(r.root, 'settings-delete-account-row');
    const input = r.root.findByProps({ testID: 'settings-delete-password' });
    await act(async () => {
      (input.props as { onChangeText: (v: string) => void }).onChangeText('pw');
    });
    await act(async () => {
      (
        r.root.findByProps({ testID: 'settings-delete-confirm' }).props as {
          onPress: () => void;
        }
      ).onPress();
      await flush();
    });

    expect(show).toHaveBeenCalledWith('账号已删除。');
    // 弹窗关闭:密码输入框已卸载。
    expect(
      r.root.findAllByProps({ testID: 'settings-delete-password' }),
    ).toHaveLength(0);
  });
});

describe('SettingsScreen about entry', () => {
  it('renders the entry row navigating to About; migrated rows are gone', async () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    r = renderIn(<SettingsScreen />);
    await flush();

    const entry = r.root.findByProps({ testID: 'settings-about-entry' });
    await act(async () => {
      (entry.props as { onPress: () => void }).onPress();
    });
    expect(navNavigate).toHaveBeenCalledWith('About');
    // 入口行右侧展示当前版本号。
    const texts = entry.findAllByType(Text).map(t => String(t.props.children));
    expect(texts).toContain('v1.0.6');

    // 迁走的行不再出现在 Me 页。
    expect(
      r.root.findAllByProps({ testID: 'settings-check-update-row' }),
    ).toHaveLength(0);
    expect(
      r.root.findAllByProps({ testID: 'settings-delete-account-row' }),
    ).toHaveLength(0);
    expect(
      r.root.findAllByProps({ testID: 'settings-app-version' }),
    ).toHaveLength(0);
    // 删除账号弹窗相关节点也不再存在。
    expect(
      r.root.findAllByProps({ testID: 'settings-delete-confirm' }),
    ).toHaveLength(0);
  });
});
