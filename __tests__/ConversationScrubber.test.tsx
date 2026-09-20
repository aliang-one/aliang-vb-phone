import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity, View } from 'react-native';
import { ConversationScrubber } from '../src/components/vibecoding/ConversationScrubber';
import type { ScrubberStop } from '../src/utils/conversationScrubber';

const stops: ScrubberStop[] = [
  { id: 'u1', role: 'user', timestamp: '10:01', preview: 'First prompt' },
  { id: 'u2', role: 'user', timestamp: '10:03', preview: 'Second prompt' },
];

const marks = [
  { id: 'u1', role: 'user' as const, active: true, visible: true },
  { id: 'a1', role: 'assistant' as const, active: false, visible: true },
  { id: 'u2', role: 'user' as const, active: false, visible: true },
];

describe('ConversationScrubber (loupe)', () => {
  it('renders the compact rail with no expand trigger', () => {
    let screen!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      screen = ReactTestRenderer.create(
        <ConversationScrubber
          collapsedMarks={marks}
          stops={stops}
          activeStopId="u1"
          onCommit={jest.fn()}
        />,
      );
    });

    // The rail is a plain View (press-drag drives the loupe) — never a
    // tappable button that expands into a modal.
    const buttons = screen.root.findAllByType(TouchableOpacity);
    expect(buttons).toHaveLength(0);

    // Marks render as ticks.
    expect(screen.root.findAllByType(View).length).toBeGreaterThan(marks.length);
  });

  it('renders nothing when there are no marks', () => {
    let screen!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      screen = ReactTestRenderer.create(
        <ConversationScrubber
          collapsedMarks={[]}
          stops={stops}
          onCommit={jest.fn()}
        />,
      );
    });
    expect(screen.root.children.length).toBe(0);
  });

  it('keeps the loupe hidden while idle (no preview text rendered)', () => {
    let screen!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      screen = ReactTestRenderer.create(
        <ConversationScrubber
          collapsedMarks={marks}
          stops={stops}
          activeStopId="u2"
          onCommit={jest.fn()}
        />,
      );
    });

    // Idle state = just the rail ticks (all Views). The loupe — which would
    // carry the preview Text — only mounts while the finger is down, so no
    // Text should be present until a gesture begins.
    expect(screen.root.findAllByType(Text)).toHaveLength(0);
  });

  it('gives the slim rail a generous touch target so taps actually land', () => {
    // 胶囊本体只有 16×~200px, 悬在右缘——裸点命中率极低。hitSlop 把可点区
    // 撑到 ~48px 宽、上下各外扩, 视觉不变。
    let screen!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      screen = ReactTestRenderer.create(
        <ConversationScrubber
          collapsedMarks={marks}
          stops={stops}
          activeStopId="u1"
          onCommit={jest.fn()}
        />,
      );
    });

    const rail = screen.root.find(node => node.props.testID === 'scrubber-rail');
    expect(rail.props.hitSlop).toEqual({
      top: 24,
      bottom: 36,
      left: 20,
      right: 12,
    });
  });

  it('keeps an explicit, count-derived band height (compact pitch, no collapse)', () => {
    // 刻度带(band)高度显式且随刻度数走(3 marks → 56px):间距太大鱼眼波包就散。
    // 刻度全部挂在 band 里(absolute), band 尺寸不依赖内容 → 永不塌缩。
    let screen!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      screen = ReactTestRenderer.create(
        <ConversationScrubber
          collapsedMarks={marks}
          stops={stops}
          activeStopId="u1"
          onCommit={jest.fn()}
        />,
      );
    });

    const band = screen.root.find(
      node => node.props.testID === 'scrubber-rail-band',
    );
    const style: Record<string, unknown> = Object.assign(
      {},
      ...(Array.isArray(band.props.style) ? band.props.style : [band.props.style]),
    );
    expect(style.height).toBe(56);
  });

  it('clips the capsule so marks and border render as one surface', () => {
    // 鱼眼凸起必须被胶囊吞下(headroom 由按下时的框架伸展提供),
    // 边框 overflow 回到 hidden——刻度与边框一体渲染, 不再有溢出。
    let screen!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      screen = ReactTestRenderer.create(
        <ConversationScrubber
          collapsedMarks={marks}
          stops={stops}
          activeStopId="u1"
          onCommit={jest.fn()}
        />,
      );
    });

    const rail = screen.root.find(node => node.props.testID === 'scrubber-rail');
    const style: Record<string, unknown> = Object.assign(
      {},
      ...(Array.isArray(rail.props.style) ? rail.props.style : [rail.props.style]),
    );
    expect(style.overflow).toBe('hidden');
  });
});
