import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { WebPairConfirmSheet } from '../src/components/terminal/WebPairConfirmSheet';

// Render sheet children directly — the unit under test is the confirm sheet's
// 信息行与按钮行为,不是 BottomSheet 的 Modal + reanimated 动画壳(与
// ApprovalQuickPolicySheet.test 同款 mock;title 按真实组件语义渲染出来)。
jest.mock('../src/components/shared/BottomSheet', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    BottomSheet: (props: { open: boolean; title?: string; children: React.ReactNode }) =>
      props.open
        ? React.createElement(
            React.Fragment,
            null,
            props.title ? React.createElement(Text, null, props.title) : null,
            props.children,
          )
        : null,
  };
});

async function wrap(
  ui: React.ReactElement,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}
      >
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 0, right: 0, bottom: 0, left: 0 },
          }}
        >
          {ui}
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
    await Promise.resolve();
  });
  return renderer!;
}

const hasText = (root: ReactTestRenderer.ReactTestInstance, text: string) =>
  root.findAll(
    node => typeof node.props?.children === 'string' && node.props.children === text,
  ).length > 0;

/** Find the allow/deny button (GlowButton → TouchableOpacity) by its title text. */
const buttonByTitle = (
  root: ReactTestRenderer.ReactTestRenderer,
  title: string,
) =>
  root.root.findAllByType(TouchableOpacity).find(c =>
    c.findAllByType(Text).some(t => String(t.props.children) === title));

const BASE_PROPS = {
  visible: true,
  deviceName: 'MacBook Pro',
  directory: '~/work',
  host: 'terminal.aliang.one',
  working: false,
};

describe('WebPairConfirmSheet', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;
  });

  it('渲染标题与设备/目录/域名三行信息', async () => {
    renderer = await wrap(
      <WebPairConfirmSheet {...BASE_PROPS} onAllow={jest.fn()} onDeny={jest.fn()} />,
    );
    expect(hasText(renderer.root, '允许网页访问此终端?')).toBe(true);
    // 三行 label。
    expect(hasText(renderer.root, '设备')).toBe(true);
    expect(hasText(renderer.root, '目录')).toBe(true);
    expect(hasText(renderer.root, '网页')).toBe(true);
    // 三行 value。
    expect(hasText(renderer.root, 'MacBook Pro')).toBe(true);
    expect(hasText(renderer.root, '~/work')).toBe(true);
    expect(hasText(renderer.root, 'terminal.aliang.one')).toBe(true);
    // 两个动作按钮。
    expect(hasText(renderer.root, '允许')).toBe(true);
    expect(hasText(renderer.root, '拒绝')).toBe(true);
  });

  it('域名缺省回落到 terminal.aliang.one', async () => {
    renderer = await wrap(
      <WebPairConfirmSheet
        visible
        deviceName="MacBook Pro"
        working={false}
        onAllow={jest.fn()}
        onDeny={jest.fn()}
      />,
    );
    expect(hasText(renderer.root, 'terminal.aliang.one')).toBe(true);
  });

  it('点允许触发 onAllow 一次;点拒绝触发 onDeny', async () => {
    const onAllow = jest.fn();
    const onDeny = jest.fn();
    renderer = await wrap(
      <WebPairConfirmSheet {...BASE_PROPS} onAllow={onAllow} onDeny={onDeny} />,
    );
    await act(async () => {
      buttonByTitle(renderer!, '允许')?.props.onPress();
    });
    expect(onAllow).toHaveBeenCalledTimes(1);
    await act(async () => {
      buttonByTitle(renderer!, '拒绝')?.props.onPress();
    });
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('working 时允许/拒绝按钮均禁用并显示 loading', async () => {
    renderer = await wrap(
      <WebPairConfirmSheet
        {...BASE_PROPS}
        working
        onAllow={jest.fn()}
        onDeny={jest.fn()}
      />,
    );
    // loading 时 GlowButton 用 spinner 替换标题文字,改按 testID 找按钮。
    const allow = renderer.root.findByProps({ testID: 'web-pair-allow' });
    // GlowButton 把 disabled||loading 透传给 TouchableOpacity。
    expect(allow.props.disabled).toBe(true);
    expect(renderer.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    // 拒绝同样禁用:进行中的 approve 可能服务端已完成,此时"拒绝"会误导
    // 用户以为撤销了授权(与 scrim 关闭门同一语义)。
    const deny = renderer.root.findByProps({ testID: 'web-pair-deny' });
    expect(deny.props.disabled).toBe(true);
  });

  it('visible=false 时不渲染内容', async () => {
    renderer = await wrap(
      <WebPairConfirmSheet
        {...BASE_PROPS}
        visible={false}
        onAllow={jest.fn()}
        onDeny={jest.fn()}
      />,
    );
    expect(hasText(renderer.root, '允许网页访问此终端?')).toBe(false);
    expect(hasText(renderer.root, '设备')).toBe(false);
  });
});
