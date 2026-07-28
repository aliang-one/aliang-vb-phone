/**
 * Guard against the empty-`previewLinks` crash.
 *
 * `preview = previewLinks.find(id) ?? previewLinks[0]` is `undefined` when the
 * store has been reset (auth refresh / socket reconnect) or a deep link carries
 * a stale previewId. The render body used to dereference `preview.targetUrl` /
 * `.shortUrl` / `.port` / `.access.toUpperCase()` / `.expiresIn` unguarded →
 * `Cannot read properties of undefined` → JS red screen. The screen must
 * render a safe empty state instead.
 *
 * SafeAreaWrapper is stubbed to a passthrough because the jest mock of
 * react-native-safe-area-context's SafeAreaProvider does not render children,
 * which would otherwise prevent the screen from mounting at all.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { PreviewScreen } from '../src/screens/preview/PreviewScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: jest.fn(),
    navigate: jest.fn(),
    canGoBack: () => true,
  }),
  useRoute: () => ({ params: { previewId: 'missing' } }),
}));

jest.mock('../src/components/layout/SafeAreaWrapper', () => ({
  SafeAreaWrapper: ({ children }: { children: React.ReactNode }) => children,
}));

describe('PreviewScreen empty-state guard', () => {
  beforeEach(() => {
    useControlCenterStore.setState({ previewLinks: [] });
  });

  it('renders a safe empty state (no crash) when no preview link is available', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    expect(() => {
      act(() => {
        renderer = ReactTestRenderer.create(
          <ThemeContext.Provider
            value={{
              theme: utilityMinimalist,
              mode: 'light',
              setMode: () => {},
              isDark: false,
            }}
          >
            <PreviewScreen />
          </ThemeContext.Provider>,
        );
      });
    }).not.toThrow();

    expect(
      renderer!.root.findAllByProps({ testID: 'preview-empty' }).length,
    ).toBeGreaterThan(0);
  });
});
