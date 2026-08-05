import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { ActivityBlock } from '../src/components/vibecoding/ActivityBlock';
import type { StructuredActivityEvent } from '../src/data/platformModels';
import { fetchStructuredEventDetail } from '../src/api/sessions';

// fetchStructuredEventDetail is only invoked on row expand; the smoke test
// never opens a row, so the module mock is just a safety net.
jest.mock('../src/api/sessions', () => ({
  fetchStructuredEventDetail: jest.fn().mockResolvedValue({
    text: undefined,
    truncated: false,
  }),
}));

const wrap = (ui: React.ReactElement) => {
  const root = ReactTestRenderer.create(
    <ThemeContext.Provider
      value={{
        theme: utilityMinimalist,
        mode: 'light',
        setMode: jest.fn(),
        isDark: false,
      }}
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
  return root;
};

const collectStrings = (root: ReactTestRenderer.ReactTestInstance): string =>
  root
    .findAllByType(Text)
    .map(t => String(t.props.children ?? ''))
    .join('|');

describe('ActivityBlock smoke', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when events is empty', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = wrap(
        <ActivityBlock
          sessionId="s1"
          events={[]}
          detailCache={{}}
          onCacheDetail={jest.fn()}
        />,
      );
    });
    // summarizeActivity([]) === null → ActivityBlock returns null. The wrapper
    // providers still render, but no Text node should be present (ActivityBlock
    // emitted nothing and the providers render no text themselves).
    const texts = renderer!.root.findAllByType(Text);
    expect(texts).toHaveLength(0);
  });

  it('renders the headline for a non-empty event group', () => {
    const events: StructuredActivityEvent[] = [
      {
        kind: 'command',
        eventId: 'e1',
        messageId: 'm1',
        itemId: 'i1',
        status: 'started',
        command: 'npm test',
      },
    ];
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = wrap(
        <ActivityBlock
          sessionId="s1"
          events={events}
          detailCache={{}}
          onCacheDetail={jest.fn()}
        />,
      );
    });
    // headline for a started command is "⚙ <command>".
    const text = collectStrings(renderer!.root);
    expect(text).toContain('npm test');
  });

  it('keeps tools after thinking stops while removing the transient thinking block', async () => {
    const longThinking = `${'x'.repeat(4_000)}THE_END`;
    jest.mocked(fetchStructuredEventDetail).mockResolvedValueOnce({
      text: longThinking,
      truncated: false,
    });
    const events: StructuredActivityEvent[] = [
      {
        kind: 'thinking',
        eventId: 'think-1',
        messageId: 'm1',
        active: true,
        chars: longThinking.length,
      },
      {
        kind: 'command',
        eventId: 'command-1',
        messageId: 'm1',
        itemId: 'item-1',
        status: 'completed',
        command: 'npm test',
        exitCode: 0,
      },
    ];

    const Harness = () => {
      const [cache, setCache] = React.useState<
        Record<string, { text?: string; truncated?: boolean }>
      >({});
      return (
        <ActivityBlock
          sessionId="s1"
          events={events}
          detailCache={cache}
          onCacheDetail={(eventId, detail) =>
            setCache(current => ({ ...current, [eventId]: detail }))
          }
        />
      );
    };

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = wrap(<Harness />);
    });

    act(() => {
      renderer!.root
        .findByProps({ testID: 'thinking-activity-header' })
        .props.onPress();
      renderer!.root.findByProps({ testID: 'activity-header' }).props.onPress();
    });
    expect(fetchStructuredEventDetail).not.toHaveBeenCalled();
    expect(collectStrings(renderer!.root)).toContain('npm test');

    await act(async () => {
      renderer!.root
        .findByProps({ testID: 'thinking-row-think-1' })
        .props.onPress();
      await Promise.resolve();
    });

    expect(fetchStructuredEventDetail).toHaveBeenCalledTimes(1);
    expect(fetchStructuredEventDetail).toHaveBeenCalledWith('s1', 'think-1');
    expect(collectStrings(renderer!.root)).not.toContain('THE_END');

    act(() => {
      renderer!.root
        .findByProps({ testID: 'thinking-show-more-think-1' })
        .props.onPress();
    });
    expect(collectStrings(renderer!.root)).toContain('THE_END');
    expect(
      renderer!.root.findAllByType(TouchableOpacity).length,
    ).toBeGreaterThan(1);

    const settledEvents = events.map(event =>
      event.kind === 'thinking' ? { ...event, active: false } : event,
    );
    act(() => {
      renderer!.update(
        <ThemeContext.Provider
          value={{
            theme: utilityMinimalist,
            mode: 'light',
            setMode: jest.fn(),
            isDark: false,
          }}
        >
          <SafeAreaProvider
            initialMetrics={{
              frame: { x: 0, y: 0, width: 390, height: 844 },
              insets: { top: 0, right: 0, bottom: 0, left: 0 },
            }}
          >
            <ActivityBlock
              sessionId="s1"
              events={settledEvents}
              detailCache={{}}
              onCacheDetail={jest.fn()}
            />
          </SafeAreaProvider>
        </ThemeContext.Provider>,
      );
    });
    expect(
      renderer!.root.findAllByProps({ testID: 'thinking-activity-header' }),
    ).toHaveLength(0);
    act(() => {
      renderer!.root.findByProps({ testID: 'activity-header' }).props.onPress();
    });
    expect(collectStrings(renderer!.root)).toContain('npm test');
  });
});
