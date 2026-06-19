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
});
