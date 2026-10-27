/**
 * 气泡长按 → 全文面板（TranscriptMessageList 的接线）。
 *
 * 锁两件事：
 *   1. 用户/助手气泡都带 onLongPress，且长按后把「这条消息的可读正文」交给面板；
 *   2. 交给面板的是渲染用的纯文本（segmentsPlainText），不是带标记的原始
 *      `.content`——否则复制出来会夹着 `<callout>` / aliang-options 围栏。
 *
 * MessageTextSheet 在本测试里 stub 成探针（它自己的行为另有测试），
 * 这样只验证「长按是否触发、给了什么内容」。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TranscriptMessageList } from '../TranscriptMessageList';
import type { DisplayTranscriptMessage } from '../../../utils/agentTranscript';
import type { TranscriptSegment } from '../../../utils/messageRendering';

const sheetProps: { visible: boolean; text: string }[] = [];

jest.mock('../MessageTextSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MessageTextSheet: (props: { visible: boolean; text: string }) => {
      sheetProps.push({ visible: props.visible, text: props.text });
      return props.visible
        ? React.createElement(View, { testID: 'message-text-sheet-stub' })
        : null;
    },
  };
});

const message = (
  role: 'user' | 'assistant',
  segments: TranscriptSegment[],
): DisplayTranscriptMessage => ({
  id: `m-${role}`,
  role,
  timestamp: '2026-10-27T10:00:00Z',
  mergedCount: 1,
  segments,
  contentKey: 'k',
  sourceMessageIds: [`m-${role}`],
});

const render = (msg: DisplayTranscriptMessage) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<TranscriptMessageList message={msg} />);
  });
  return renderer;
};

const bubble = (renderer: TestRenderer.ReactTestRenderer, id: string) =>
  renderer.root.findAll(
    node =>
      node.props?.testID === `message-bubble-${id}` &&
      typeof node.props?.onLongPress === 'function',
  )[0];

const hasStub = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(
    node =>
      node.props?.testID === 'message-text-sheet-stub' &&
      typeof node.type === 'string',
  ).length > 0;

beforeEach(() => {
  sheetProps.length = 0;
});

describe('气泡长按 → 全文面板', () => {
  it('用户气泡长按：弹出面板，内容 = 气泡正文', () => {
    const renderer = render(
      message('user', [
        { kind: 'text', id: 't1', content: '帮我看看这段', blocks: [] },
      ]),
    );

    expect(hasStub(renderer)).toBe(false);
    act(() => {
      bubble(renderer, 'm-user').props.onLongPress();
    });

    expect(hasStub(renderer)).toBe(true);
    const last = sheetProps[sheetProps.length - 1];
    expect(last.visible).toBe(true);
    expect(last.text).toBe('帮我看看这段');

    act(() => renderer.unmount());
  });

  it('助手气泡同样可长按（含折叠块 → 带 label 的纯文本）', () => {
    const renderer = render(
      message('assistant', [
        { kind: 'text', id: 't1', content: '跑一下', blocks: [] },
        { kind: 'folded', id: 'f1', label: 'BASH', content: 'ls -la', tone: 'neutral' },
      ]),
    );

    act(() => {
      bubble(renderer, 'm-assistant').props.onLongPress();
    });

    expect(sheetProps[sheetProps.length - 1].text).toBe('跑一下\n\nBASH\nls -la');

    act(() => renderer.unmount());
  });

  it('没有可读正文的消息长按不弹面板（不给人一张空表）', () => {
    const renderer = render(message('assistant', []));

    act(() => {
      bubble(renderer, 'm-assistant')?.props.onLongPress?.();
    });

    expect(hasStub(renderer)).toBe(false);

    act(() => renderer.unmount());
  });
});
