import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  buildConversationTimeline,
  goalFoldTimelineItemId,
} from '../../src/utils/conversationTimeline';
import { buildConversationTurns } from '../../src/utils/conversationTurns';
import {
  buildGoalFolds,
  partitionHiddenGoalMessages,
} from '../../src/utils/goalFolds';
import { GoalDeletedFold } from '../../src/components/vibecoding/GoalDeletedFold';
import { ThemeContext } from '../../src/theme/ThemeContext';
import { utilityMinimalist } from '../../src/theme/themes/utilityMinimalist';
import type { AgentMessage } from '../../src/data/platformModels';
import type { DisplayTranscriptMessage } from '../../src/utils/agentTranscript';

// Build a DisplayTranscriptMessage matching what buildDisplayTranscript would
// produce for a visible AgentMessage — minimal shape for timeline assembly.
const visibleDisplayMessage = (
  id: string,
  timestamp: string,
): DisplayTranscriptMessage => ({
  id,
  role: 'user',
  timestamp,
  mergedCount: 1,
  segments: [
    {
      id: `${id}:text`,
      kind: 'text',
      content: id,
      blocks: [
        {
          kind: 'paragraph',
          children: [{ kind: 'text', content: id }],
        },
      ],
    },
  ],
  sourceMessageIds: [id],
});

const agentMessage = (
  id: string,
  content: string,
  timestamp: string,
  extra: Partial<AgentMessage> = {},
): AgentMessage => ({
  id,
  role: extra.role ?? 'assistant',
  content,
  timestamp,
  ...extra,
});

const themeWrapper = (ui: React.ReactElement) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{
          theme: utilityMinimalist,
          mode: 'light',
          setMode: jest.fn(),
          isDark: false,
        }}>
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 0, right: 0, bottom: 0, left: 0 },
          }}>
          {ui}
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
  });
  return renderer!;
};

const collectText = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');

/**
 * Fake "screen" that mirrors the wiring done in VibeCodingSessionScreen: filter
 * hidden messages out of the visible transcript, group them by goalId into
 * folds, build the conversation timeline, and render each item kind. Lets us
 * assert fold placement + non-hidden rendering without booting the full screen
 * (which drags in stores/providers orthogonal to this feature).
 */
const ConversationTimelineHarness: React.FC<{
  transcript: AgentMessage[];
}> = ({ transcript }) => {
  const { visible, folds } = partitionHiddenGoalMessages(transcript);
  const displayMessages = visible.map(message =>
    visibleDisplayMessage(message.id, message.timestamp),
  );
  const turns = buildConversationTurns(displayMessages);
  const items = buildConversationTimeline(turns, [], folds);
  return (
    <>
      {items.map(item => {
        if (item.kind === 'goal-fold') {
          return (
            <GoalDeletedFold
              key={item.id}
              goalId={item.fold.goalId}
              objective={item.fold.objective}
              messages={item.fold.messages}
            />
          );
        }
        if (item.kind === 'turn') {
          return (
            <Text key={item.id} testID={`visible-turn-${item.id}`}>
              {item.id}
            </Text>
          );
        }
        return null;
      })}
    </>
  );
};

describe('buildGoalFolds', () => {
  it('groups hidden messages globally by goalId (order-independent) and sorts by earliest timestamp', () => {
    const v1 = agentMessage('v1', 'c', '2026-07-26T10:00:00.000Z');
    const h1 = agentMessage('h1', 'c', '2026-07-26T10:05:00.000Z', {
      role: 'assistant',
      goalId: 'G1',
      hiddenAt: '2026-07-26T10:30:00.000Z',
    });
    const v2 = agentMessage('v2', 'c', '2026-07-26T10:10:00.000Z', {
      role: 'user',
    });
    // Same goalId as h1, non-contiguous — must merge into the SAME fold.
    const h2 = agentMessage('h2', 'c', '2026-07-26T10:20:00.000Z', {
      role: 'assistant',
      goalId: 'G1',
      hiddenAt: '2026-07-26T10:30:00.000Z',
    });
    const h3 = agentMessage('h3', 'c', '2026-07-26T10:50:00.000Z', {
      role: 'assistant',
      goalId: 'G2',
      hiddenAt: '2026-07-26T11:00:00.000Z',
    });

    const folds = buildGoalFolds([v1, h1, v2, h2, h3]);

    expect(folds).toHaveLength(2);
    // G1 earliest hidden ts (10:05) < G2 (10:50) → G1 first
    expect(folds[0].goalId).toBe('G1');
    expect(folds[0].messages.map(m => m.id)).toEqual(['h1', 'h2']);
    expect(folds[0].anchorTimestamp).toBe('2026-07-26T10:05:00.000Z');
    expect(folds[1].goalId).toBe('G2');
    expect(folds[1].messages.map(m => m.id)).toEqual(['h3']);
  });

  it('ignores visible messages and hidden messages without a goalId', () => {
    const visible = agentMessage('v1', 'c', '2026-07-26T10:00:00.000Z');
    const hiddenNoGoal = agentMessage('hn', 'c', '2026-07-26T10:05:00.000Z', {
      hiddenAt: '2026-07-26T10:06:00.000Z',
    });
    const folds = buildGoalFolds([visible, hiddenNoGoal]);
    expect(folds).toHaveLength(0);
  });

  it('partition separates visible vs hidden and feeds folds', () => {
    const v1 = agentMessage('v1', 'c', '2026-07-26T10:00:00.000Z');
    const h1 = agentMessage('h1', 'c', '2026-07-26T10:05:00.000Z', {
      goalId: 'G1',
      hiddenAt: '2026-07-26T10:30:00.000Z',
    });
    const { visible, folds } = partitionHiddenGoalMessages([v1, h1]);
    expect(visible.map(m => m.id)).toEqual(['v1']);
    expect(folds.map(f => f.goalId)).toEqual(['G1']);
  });
});

describe('conversation timeline with goal folds', () => {
  it('places one fold per goalId at the group earliest-message position; hidden messages do not render as ordinary turns', () => {
    // transcript order: v1 (visible) -> h1 (G1 hidden) -> h2 (G1 hidden) -> v2 (visible)
    // G1 fold anchor = h1 timestamp (between v1 and v2).
    const transcript: AgentMessage[] = [
      agentMessage('v1', '可见1', '2026-07-26T10:00:00.000Z', { role: 'user' }),
      agentMessage('h1', '规划', '2026-07-26T10:05:00.000Z', {
        role: 'assistant',
        goalId: 'G1',
        hiddenAt: '2026-07-26T10:30:00.000Z',
      }),
      agentMessage('h2', '执行', '2026-07-26T10:10:00.000Z', {
        role: 'assistant',
        goalId: 'G1',
        hiddenAt: '2026-07-26T10:30:00.000Z',
      }),
      agentMessage('v2', '可见2', '2026-07-26T10:15:00.000Z', { role: 'user' }),
    ];

    const root = themeWrapper(<ConversationTimelineHarness transcript={transcript} />);

    // Visible turns v1 and v2 rendered; no visible turn for h1/h2. Use a count
    // of Text components whose children equal the turn id (RN propagates testID
    // to nested text nodes, so findAllByProps over-counts).
    const turnChildTexts = root.root
      .findAllByType(Text)
      .map(node => (typeof node.props.children === 'string' ? node.props.children : ''))
      .filter(Boolean);
    expect(turnChildTexts).toContain('turn:v1');
    expect(turnChildTexts).toContain('turn:v2');
    expect(turnChildTexts).not.toContain('turn:h1');
    expect(turnChildTexts).not.toContain('turn:h2');

    // Exactly one GoalDeletedFold for G1 carrying 2 messages. RN propagates
    // testID into nested text nodes which makes findAll double-count; gate the
    // unique toggle by counting distinct instances via findByProps.
    const foldToggle = root.root.findByProps({
      testID: 'goal-deleted-fold-toggle',
    });
    expect(foldToggle).toBeTruthy();

    // Expand and verify both hidden messages live inside the fold.
    act(() => {
      foldToggle.props.onPress();
    });
    // Two message rows render (use findByProps for the unique rows).
    expect(
      root.root.findByProps({ testID: 'goal-deleted-fold-message-0' }),
    ).toBeTruthy();
    expect(
      root.root.findByProps({ testID: 'goal-deleted-fold-message-1' }),
    ).toBeTruthy();
    // Hidden message contents only appear inside the fold.
    expect(collectText(root)).toContain('规划');
    expect(collectText(root)).toContain('执行');

    // Timeline id stability for fold item.
    expect(goalFoldTimelineItemId('G1')).toBe('goal-fold:G1');
  });

  it('coalesces scattered same-goalId hidden messages into a single fold (global grouping)', () => {
    // h1 and h2 share G1 but are separated by a visible message.
    const transcript: AgentMessage[] = [
      agentMessage('v1', '可见1', '2026-07-26T10:00:00.000Z', { role: 'user' }),
      agentMessage('h1', '规划', '2026-07-26T10:02:00.000Z', {
        role: 'assistant',
        goalId: 'G1',
        hiddenAt: '2026-07-26T10:30:00.000Z',
      }),
      agentMessage('v2', '可见2', '2026-07-26T10:04:00.000Z', { role: 'user' }),
      agentMessage('h2', '执行', '2026-07-26T10:06:00.000Z', {
        role: 'assistant',
        goalId: 'G1',
        hiddenAt: '2026-07-26T10:30:00.000Z',
      }),
    ];

    const root = themeWrapper(<ConversationTimelineHarness transcript={transcript} />);
    // ONE fold for the whole G1 group, not two. findByProps throws if multiple
    // match, so a passing assertion here proves the toggle is unique.
    const foldToggle = root.root.findByProps({
      testID: 'goal-deleted-fold-toggle',
    });
    expect(foldToggle).toBeTruthy();

    act(() => {
      foldToggle.props.onPress();
    });
    expect(
      root.root.findByProps({ testID: 'goal-deleted-fold-message-0' }),
    ).toBeTruthy();
    expect(
      root.root.findByProps({ testID: 'goal-deleted-fold-message-1' }),
    ).toBeTruthy();
    // Both visible turns still rendered.
    const turnChildTexts = root.root
      .findAllByType(Text)
      .map(node => (typeof node.props.children === 'string' ? node.props.children : ''))
      .filter(Boolean);
    expect(turnChildTexts).toContain('turn:v1');
    expect(turnChildTexts).toContain('turn:v2');
  });
});
