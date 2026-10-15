/**
 * UpdateAvailableSheet — 软提醒升级弹层。
 * BottomSheet(依赖 reanimated/safe-area)在测试里整体 stub 成透明容器,
 * 只锁本组件自己的逻辑:open 判定(status/抑制位)、稍后再说→dismiss、
 * 立即更新→Linking+dismiss;openURL 失败留在弹层并给错误反馈(不静默
 * 吞掉后把版本写进「稍后再说」抑制);i18n 文本真键断言(防键名错位渲染
 * 裸 key——2026-10-15 审计实锤过的 mock 撒谎形态)。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';
import { UpdateAvailableSheet } from '../UpdateAvailableSheet';
import { useAppUpdateStore } from '../../../store/appUpdateStore';
import { useToastStore } from '../../../store/toastStore';

jest.mock('../../shared/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BottomSheet: (props: {
      open: boolean;
      children?: React.ReactNode;
      testID?: string;
    }) => (props.open ? React.createElement(View, { testID: 'bottom-sheet-stub' }, props.children) : null),
  };
});
jest.mock('../../shared/GlowButton', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    GlowButton: (props: { title: string; onPress: () => void; testID?: string }) =>
      React.createElement(
        Pressable,
        { testID: props.testID, onPress: props.onPress },
        React.createElement('Text', null, props.title),
      ),
  };
});

const openLink = Linking.openURL as jest.MockedFunction<typeof Linking.openURL>;

const softAvailable = () => {
  useAppUpdateStore.setState({
    status: 'available',
    info: {
      latestVersion: 'v1.0.7',
      downloadUrl: 'https://www.aliang.one/download',
      changelog: '- 修复若干问题',
    },
    dismissedVersion: null,
    promptSuppressed: false,
  });
};

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

describe('UpdateAvailableSheet', () => {
  it('available 且未抑制 → 渲染 changelog 与双按钮,标题/按钮为真实 i18n 文本', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      softAvailable();
      renderer = TestRenderer.create(<UpdateAvailableSheet />);
    });
    expect(renderer.root.findByProps({ testID: 'bottom-sheet-stub' })).toBeTruthy();
    expect(String(renderer.root.findByProps({ testID: 'update-changelog' }).props.children)).toContain('修复');
    expect(renderer.root.findByProps({ testID: 'update-later-button' })).toBeTruthy();
    // i18n 键位错位时这里会渲染裸 key("about.update.title"),必须锁死。
    expect(
      renderer.root.find(node => node.props && node.props.title === '发现新版本'),
    ).toBeTruthy();
    expect(renderer.root.findByProps({ children: '立即更新' })).toBeTruthy();
    expect(renderer.root.findByProps({ children: '稍后再说' })).toBeTruthy();
  });

  it('被抑制(稍后再说/恢复的记忆)→ 不渲染', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      softAvailable();
      useAppUpdateStore.setState({ promptSuppressed: true });
      renderer = TestRenderer.create(<UpdateAvailableSheet />);
    });
    expect(renderer.toJSON()).toBeNull();
  });

  it('稍后再说 → dismiss(抑制位翻真)', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      softAvailable();
      renderer = TestRenderer.create(<UpdateAvailableSheet />);
    });
    const later = renderer.root.findByProps({ testID: 'update-later-button' });
    act(() => {
      later.props.onPress();
    });
    expect(useAppUpdateStore.getState().promptSuppressed).toBe(true);
    expect(useAppUpdateStore.getState().dismissedVersion).toBe('v1.0.7');
  });

  it('立即更新 → 跳下载地址并 dismiss', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      softAvailable();
      renderer = TestRenderer.create(<UpdateAvailableSheet />);
    });
    const now = renderer.root.findByProps({ testID: 'update-now-button' });
    await act(async () => {
      now.props.onPress();
    });
    expect(openLink).toHaveBeenCalledWith('https://www.aliang.one/download');
    expect(useAppUpdateStore.getState().promptSuppressed).toBe(true);
  });

  it('openURL 失败 → 留在弹层 + 错误 toast,不写「稍后再说」抑制', async () => {
    openLink.mockRejectedValueOnce(new Error('no browser'));
    const show = jest.fn();
    useToastStore.setState({ show });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      softAvailable();
      renderer = TestRenderer.create(<UpdateAvailableSheet />);
    });
    const now = renderer.root.findByProps({ testID: 'update-now-button' });
    await act(async () => {
      now.props.onPress();
    });
    expect(openLink).toHaveBeenCalledTimes(1);
    // 弹层仍在(open 判定不依赖 dismiss)且抑制记忆未被写入。
    expect(useAppUpdateStore.getState().promptSuppressed).toBe(false);
    expect(show).toHaveBeenCalledWith('无法打开下载链接,请重试。', 'error');
  });
});
