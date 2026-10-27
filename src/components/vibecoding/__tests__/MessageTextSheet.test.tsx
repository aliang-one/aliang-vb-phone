/**
 * MessageTextSheet — 长按气泡后「全文 + 一键复制」的面板。
 *
 * BottomSheet / GlowButton 在测试里 stub 成朴素容器(与 UpdateAvailableSheet
 * 同一套做法),只锁本组件自己的逻辑:正文进只读输入框、复制走 Clipboard、
 * 反馈走行内文案(Modal 盖住 ToastViewport,弹 toast 看不见)、空消息不出复制。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import { MessageTextSheet } from '../MessageTextSheet';

jest.mock('../../shared/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BottomSheet: (props: { open: boolean; children?: React.ReactNode }) =>
      props.open ? React.createElement(View, null, props.children) : null,
  };
});
jest.mock('../../shared/GlowButton', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    GlowButton: (props: {
      title: string;
      onPress: () => void;
      disabled?: boolean;
      testID?: string;
    }) =>
      React.createElement(
        Pressable,
        {
          testID: props.testID,
          onPress: props.disabled ? undefined : props.onPress,
          disabled: props.disabled,
        },
        React.createElement(Text, null, props.title),
      ),
  };
});

const setString = Clipboard.setString as jest.Mock;

const render = (text: string, visible = true) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <MessageTextSheet
        visible={visible}
        text={text}
        onClose={jest.fn()}
      />,
    );
  });
  return renderer;
};

// Pressable 的 onPress 在复合组件上,宿主 View 没有 —— 抓带 testID 的那个。
const findPressable = (
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): TestRenderer.ReactTestInstance =>
  renderer.root.findAll(
    node =>
      node.props?.testID === testID && typeof node.props?.onPress === 'function',
  )[0];

const textOf = (
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): string => {
  const node = renderer.root.findAll(
    item => item.props?.testID === testID && typeof item.type === 'string',
  )[0];
  const children = node.props.children;
  return Array.isArray(children) ? children.join('') : String(children);
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('长按气泡的全文面板', () => {
  it('正文进只读输入框（整段可选中）', () => {
    const renderer = render('第一段\n\n第二段');
    const input = renderer.root.findAll(
      node =>
        node.props?.testID === 'message-text-sheet-input' &&
        typeof node.type === 'string',
    )[0];

    expect(input.props.value).toBe('第一段\n\n第二段');
    expect(input.props.editable).toBe(false);
    expect(input.props.multiline).toBe(true);

    act(() => renderer.unmount());
  });

  it('点复制 → 写入剪贴板，且行内立刻显示「已复制」', () => {
    const renderer = render('要复制的话');

    act(() => {
      findPressable(renderer, 'message-text-sheet-copy').props.onPress();
    });

    expect(setString).toHaveBeenCalledWith('要复制的话');
    expect(textOf(renderer, 'message-text-sheet-status')).toBe('已复制');

    act(() => renderer.unmount());
  });

  it('「已复制」会在 1.6 秒后自己退回（不粘在按钮上）', () => {
    jest.useFakeTimers();
    const renderer = render('话');

    act(() => {
      findPressable(renderer, 'message-text-sheet-copy').props.onPress();
    });
    expect(textOf(renderer, 'message-text-sheet-status')).toBe('已复制');

    act(() => {
      jest.advanceTimersByTime(1700);
    });
    expect(textOf(renderer, 'message-text-sheet-status').trim()).toBe('');

    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  it('空消息 → 只有提示，复制按钮不可用', () => {
    const renderer = render('   ');

    expect(
      renderer.root.findAll(
        node =>
          node.props?.testID === 'message-text-sheet-empty' &&
          typeof node.type === 'string',
      ).length,
    ).toBe(1);
    const copy = renderer.root.findAll(
      node => node.props?.testID === 'message-text-sheet-copy',
    )[0];
    expect(copy.props.disabled).toBe(true);
    // 就算被强按下去也不该往剪贴板写空串。
    act(() => {
      copy.props.onPress?.();
    });
    expect(setString).not.toHaveBeenCalled();

    act(() => renderer.unmount());
  });
});
