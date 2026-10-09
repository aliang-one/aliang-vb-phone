/**
 * UpdateAvailableSheet — 软提醒升级弹层。
 * BottomSheet(依赖 reanimated/safe-area)在测试里整体 stub 成透明容器,
 * 只锁本组件自己的逻辑:open 判定(status/抑制位)、稍后再说→dismiss、
 * 立即更新→Linking+dismiss。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';
import { UpdateAvailableSheet } from '../UpdateAvailableSheet';
import { useAppUpdateStore } from '../../../store/appUpdateStore';

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
  it('available 且未抑制 → 渲染 changelog 与双按钮', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      softAvailable();
      renderer = TestRenderer.create(<UpdateAvailableSheet />);
    });
    expect(renderer.root.findByProps({ testID: 'bottom-sheet-stub' })).toBeTruthy();
    expect(String(renderer.root.findByProps({ testID: 'update-changelog' }).props.children)).toContain('修复');
    expect(renderer.root.findByProps({ testID: 'update-later-button' })).toBeTruthy();
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

  it('立即更新 → 跳下载地址并 dismiss', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      softAvailable();
      renderer = TestRenderer.create(<UpdateAvailableSheet />);
    });
    const now = renderer.root.findByProps({ testID: 'update-now-button' });
    act(() => {
      now.props.onPress();
    });
    expect(openLink).toHaveBeenCalledWith('https://www.aliang.one/download');
    expect(useAppUpdateStore.getState().promptSuppressed).toBe(true);
  });
});
