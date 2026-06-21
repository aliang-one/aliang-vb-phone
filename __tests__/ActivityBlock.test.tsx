import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { ActivityBlock } from '../src/components/vibecoding/ActivityBlock';
import type { StructuredActivityEvent } from '../src/data/platformModels';

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
    .map((t) => String(t.props.children ?? ''))
    .join('|');

describe('ActivityBlock smoke', () => {
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
});
