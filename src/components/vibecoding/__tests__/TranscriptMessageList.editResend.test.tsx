/**
 * 长按用户气泡 → Alert 菜单（复制 / 编辑并重发）回归钉。
 *
 * 产品决策（2026-10-30）：已送达的用户消息支持长按重新编辑后重发。
 * 约定：
 *   1. 只有 user 气泡被 Pressable 包裹（长按宿主）；assistant/system 气泡
 *      保持普通 View —— 那是 agent 的输出，不该被「编辑重发」。
 *   2. failed 气泡不进长按菜单 —— 它有自己的 重试/删除 行，菜单是叠加噪音。
 *   3. 气泡本体仍是普通 View（testID message-bubble-*）—— selectable 正文
 *      的原生长按选择（v2 契约，见 selectable.test）不被自定义手势抢走。
 *   4. Pressable 只提供 onLongPress，无 onPress —— 点按仍应穿过 selectable
 *      正文，不产生「轻点弹菜单」的误触路径。
 *   5. 「编辑并重发」携带原文 rawContent（用户敲进来的字节），屏幕侧回填输入框。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { TranscriptMessageList } from '../TranscriptMessageList';
import type { DisplayTranscriptMessage } from '../../../utils/agentTranscript';

const userMessage: DisplayTranscriptMessage = {
  id: 'u1',
  role: 'user',
  timestamp: '2026-10-30T10:00:00Z',
  mergedCount: 1,
  segments: [
    {
      kind: 'text',
      id: 't1',
      content: '帮我看下登录页报错',
      blocks: [
        {
          kind: 'paragraph',
          children: [{ kind: 'text', content: '帮我看下登录页报错' }],
        },
      ],
    },
  ],
  contentKey: 'k1',
  sourceMessageIds: ['src-u1'],
  rawContent: '帮我看下登录页报错',
};

const failedMessage: DisplayTranscriptMessage = {
  ...userMessage,
  id: 'u2',
  contentKey: 'k2',
  sourceMessageIds: ['src-u2'],
  failed: true,
};

const assistantMessage: DisplayTranscriptMessage = {
  id: 'a1',
  role: 'assistant',
  timestamp: '2026-10-30T10:00:05Z',
  mergedCount: 1,
  segments: [
    {
      kind: 'text',
      id: 't2',
      content: '好的，我来看。',
      blocks: [
        {
          kind: 'paragraph',
          children: [{ kind: 'text', content: '好的，我来看。' }],
        },
      ],
    },
  ],
  contentKey: 'k3',
  sourceMessageIds: ['src-a1'],
};

const render = (message: DisplayTranscriptMessage, handlers = {}) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <TranscriptMessageList message={message} {...handlers} />,
    );
  });
  return renderer;
};

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('长按用户气泡菜单（复制 / 编辑并重发）', () => {
  it('已送达的用户气泡有长按入口，携带原文 rawContent', () => {
    const onEditAndResend = jest.fn();
    const renderer = render(userMessage, { onEditAndResend });

    const longPressHosts = renderer.root.findAll(
      node =>
        typeof node.props?.onLongPress === 'function' &&
        String(node.props?.accessibilityRole) === 'button',
    );
    expect(longPressHosts.length).toBe(1);

    act(() => longPressHosts[0].props.onLongPress());
    expect(alertSpy).toHaveBeenCalledTimes(1);
    // 菜单至少含「编辑并重发」一项
    const options = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const editOption = options.find(o => o.text === '编辑并重发');
    expect(editOption).toBeDefined();

    act(() => editOption!.onPress?.());
    expect(onEditAndResend).toHaveBeenCalledWith('u1', '帮我看下登录页报错');

    act(() => renderer.unmount());
  });

  it('「复制」写入剪贴板并给 toast', () => {
    const renderer = render(userMessage, { onEditAndResend: jest.fn() });
    const host = renderer.root.findAll(
      node =>
        typeof node.props?.onLongPress === 'function' &&
        String(node.props?.accessibilityRole) === 'button',
    )[0];
    act(() => host.props.onLongPress());
    const options = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const copy = options.find(o => o.text === '复制');
    act(() => copy!.onPress?.());
    expect(Clipboard.setString).toHaveBeenCalledWith('帮我看下登录页报错');

    act(() => renderer.unmount());
  });

  it('failed 气泡不挂长按菜单（有自己的重试/删除行）', () => {
    const renderer = render(failedMessage, { onEditAndResend: jest.fn() });
    expect(
      renderer.root.findAll(
        node =>
          typeof node.props?.onLongPress === 'function' &&
          String(node.props?.accessibilityRole) === 'button',
      ).length,
    ).toBe(0);

    act(() => renderer.unmount());
  });

  it('assistant 气泡绝不被长按宿主包裹', () => {
    const renderer = render(assistantMessage, { onEditAndResend: jest.fn() });
    expect(
      renderer.root.findAll(
        node =>
          typeof node.props?.onLongPress === 'function' &&
          String(node.props?.accessibilityRole) === 'button',
      ).length,
    ).toBe(0);

    act(() => renderer.unmount());
  });

  it('未提供 onEditAndResend 时用户气泡退化为普通行（无长按宿主）', () => {
    const renderer = render(userMessage);
    expect(
      renderer.root.findAll(
        node =>
          typeof node.props?.onLongPress === 'function' &&
          String(node.props?.accessibilityRole) === 'button',
      ).length,
    ).toBe(0);

    act(() => renderer.unmount());
  });

  it('气泡本体仍是普通 View（selectable 正文手势不被抢）', () => {
    const renderer = render(userMessage, { onEditAndResend: jest.fn() });
    const bubbles = renderer.root.findAll(
      node =>
        node.props?.testID === 'message-bubble-u1' &&
        typeof node.type === 'string',
    );
    expect(bubbles.length).toBe(1);
    expect(String(bubbles[0].type)).toBe('View');

    act(() => renderer.unmount());
  });

  it('长按宿主没有 onPress —— 轻点不弹菜单', () => {
    const renderer = render(userMessage, { onEditAndResend: jest.fn() });
    const host = renderer.root.findAll(
      node =>
        typeof node.props?.onLongPress === 'function' &&
        String(node.props?.accessibilityRole) === 'button',
    )[0];
    expect(host.props.onPress).toBeUndefined();

    act(() => renderer.unmount());
  });
});
