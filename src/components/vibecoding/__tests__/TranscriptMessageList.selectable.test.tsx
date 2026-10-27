/**
 * 气泡文字选择回归钉（v2:走系统原生选中）。
 *
 * 第一版把长按接到了自制 BottomSheet 上,用户反馈「设计太用力」——
 * 手机自带文本选择菜单就是干这个的。v2 契约:
 *   1. 气泡容器是普通 View,不是 Pressable——iOS 上 Pressable 会抢 responder,
 *      selectable Text 的原生长按选择永远收不到事件(第一版「长按没反应」的真因);
 *   2. 气泡内正文/表格/代码等 Text 都带 selectable,长按出系统选择菜单(拷贝/全选)。
 * 哪天有人想再加自定义长按手势,这两条会先红。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { TranscriptMessageList } from '../TranscriptMessageList';
import type { DisplayTranscriptMessage } from '../../../utils/agentTranscript';

const message: DisplayTranscriptMessage = {
  id: 'm1',
  role: 'assistant',
  timestamp: '2026-10-28T10:00:00Z',
  mergedCount: 1,
  segments: [
    {
      kind: 'text',
      id: 't1',
      content: '第一段正文\n\n```\nls -la\n```',
      blocks: [
        {
          kind: 'paragraph',
          children: [{ kind: 'text', content: '第一段正文' }],
        },
        {
          kind: 'paragraph',
          children: [{ kind: 'text', content: '第二段正文' }],
        },
        { kind: 'code', content: 'ls -la' },
      ],
    },
    {
      kind: 'folded',
      id: 'f1',
      label: 'BASH',
      content: 'git status',
      tone: 'neutral',
    },
  ],
  contentKey: 'k',
  sourceMessageIds: ['m1'],
};

const render = () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<TranscriptMessageList message={message} />);
  });
  return renderer;
};

describe('气泡原生文本选择(v2)', () => {
  it('气泡容器是 View,没有可抢 responder 的 Pressable', () => {
    const renderer = render();
    const bubbles = renderer.root.findAll(
      node =>
        node.props?.testID === 'message-bubble-m1' && typeof node.type === 'string',
    );
    expect(bubbles.length).toBeGreaterThan(0);
    // RTR 宿主 type 是字符串;若有人把容器改回 Pressable,这里先红。
    expect(bubbles.every(b => String(b.type) === 'View')).toBe(true);
    expect(
      renderer.root.findAll(
        node =>
          node.props?.testID === 'message-bubble-m1' &&
          typeof node.props?.onLongPress === 'function',
      ).length,
    ).toBe(0);

    act(() => renderer.unmount());
  });

  it('正文与折叠块内容都 selectable(系统长按菜单可用)', () => {
    const renderer = render();
    const selectableTexts = renderer.root.findAllByType(Text).filter(
      t => t.props.selectable === true,
    );
    // 至少覆盖:正文段 + 代码块 + 折叠内容,别只钉一处。
    expect(selectableTexts.length).toBeGreaterThanOrEqual(3);

    act(() => renderer.unmount());
  });
});
