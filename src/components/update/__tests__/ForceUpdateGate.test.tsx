/**
 * ForceUpdateGate — 强制更新全屏门。
 * 锁:①非 forced 状态渲染 null(不弹任何壳)②forced 渲染版本/changelog/按钮
 * ③更新按钮跳 download_url(空则兜底落地页)。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';
import { ForceUpdateGate } from '../ForceUpdateGate';
import { useAppUpdateStore } from '../../../store/appUpdateStore';

jest.mock('../../../native/AppVersion', () => ({
  getInstalledAppVersion: () => ({ versionName: 'v1.0.6', versionCode: '3' }),
}));

const mockedFetch = jest.fn();
jest.mock('../../../api/appUpdate', () => ({
  APP_UPDATE_SOFTWARE_NAME: 'aliang-vibe-phone',
  fetchUpdateCheck: (...args: unknown[]) => mockedFetch(...args),
}));

const latest = (over: { version?: string; force?: boolean } = {}) => ({
  latestVersion: over.version ?? 'v1.0.7',
  downloadUrl: 'https://www.aliang.one/download',
  changelog: '- 修复若干问题',
  serverForceFlag: over.force ?? false,
});

const openLink = Linking.openURL as jest.MockedFunction<typeof Linking.openURL>;

beforeEach(() => {
  mockedFetch.mockReset();
});

beforeEach(() => {
  jest.mocked(Linking.openURL).mockReset();
  jest.mocked(Linking.openURL).mockResolvedValue(undefined as never);
  useAppUpdateStore.setState({
    status: 'idle',
    info: null,
    lastError: null,
    dismissedVersion: null,
    promptSuppressed: false,
  });
});

const findText = (root: TestRenderer.ReactTestInstance, testID: string) =>
  root.find(node => node.props.testID === testID).props.children;

describe('ForceUpdateGate', () => {
  it('非 forced 状态渲染 null', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ForceUpdateGate />);
    });
    expect(renderer.toJSON()).toBeNull();
  });

  it('forced 渲染标题/当前与最新版本/changelog', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      useAppUpdateStore.setState({
        status: 'forced',
        info: {
          latestVersion: 'v1.0.7',
          downloadUrl: 'https://www.aliang.one/download',
          changelog: '- 修复若干问题\n- 性能优化',
        },
      });
      renderer = TestRenderer.create(<ForceUpdateGate />);
    });
    expect(findText(renderer.root, 'force-update-current')).toBe('v1.0.6');
    expect(findText(renderer.root, 'force-update-latest')).toBe('v1.0.7');
    expect(String(findText(renderer.root, 'force-update-changelog'))).toContain('性能优化');
  });

  it('更新按钮跳服务端 download_url', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      useAppUpdateStore.setState({
        status: 'forced',
        info: {
          latestVersion: 'v1.0.7',
          downloadUrl: 'https://apps.apple.com/app/id12345',
          changelog: '',
        },
      });
      renderer = TestRenderer.create(<ForceUpdateGate />);
    });
    const button = renderer.root.find(node => node.props.testID === 'force-update-button');
    act(() => {
      button.props.onPress();
    });
    expect(openLink).toHaveBeenCalledWith('https://apps.apple.com/app/id12345');
  });

  it('download_url 为空时跳兜底落地页', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      useAppUpdateStore.setState({
        status: 'forced',
        info: { latestVersion: 'v1.0.7', downloadUrl: '', changelog: '' },
      });
      renderer = TestRenderer.create(<ForceUpdateGate />);
    });
    const button = renderer.root.find(node => node.props.testID === 'force-update-button');
    act(() => {
      button.props.onPress();
    });
    expect(openLink).toHaveBeenCalledWith('https://www.aliang.one/download');
  });

  it('changelog 为空时显示兜底文案而不是空白', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      useAppUpdateStore.setState({
        status: 'forced',
        info: { latestVersion: 'v1.0.7', downloadUrl: '', changelog: '   ' },
      });
      renderer = TestRenderer.create(<ForceUpdateGate />);
    });
    const changelog = String(findText(renderer.root, 'force-update-changelog'));
    expect(changelog.length).toBeGreaterThan(0);
    expect(changelog).not.toBe('   ');
  });

  it('重试检查触发 manual checkNow;服务端撤掉 force 后 Gate 解除', async () => {
    mockedFetch.mockReset();
    mockedFetch
      .mockResolvedValueOnce(latest({ force: true }))
      // 运维修正:撤行后 latest 回到本机版本(force 标志仍在也无法强推相同版本)。
      .mockResolvedValueOnce(latest({ version: 'v1.0.6', force: true }));

    await act(async () => {
      await useAppUpdateStore.getState().checkNow();
    });
    expect(useAppUpdateStore.getState().status).toBe('forced');

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ForceUpdateGate />);
    });
    const retry = renderer.root.findByProps({ testID: 'force-update-retry' });
    await act(async () => {
      await retry.props.onPress();
    });
    // 成功检查判定无需更新 → Gate 消失(粘滞强制仅挡失败,不挡成功判定)。
    expect(useAppUpdateStore.getState().status).toBe('upToDate');
    expect(renderer.toJSON()).toBeNull();
  });
});
