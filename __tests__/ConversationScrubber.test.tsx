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

  it('keeps an explicit rail height so absolute marks can never collapse it', () => {
    // 刻度全程 absolute 定位(脱离文档流)——轨道高度必须显式声明,
    // 否则按下瞬间胶囊塌缩成一个点("只剩一个点"回归)。
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
    expect(style.height).toBe(276);
  });
});
