import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  TerminalEmulator,
  type TerminalEmulatorHandle,
} from '../src/components/terminal/TerminalEmulator';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { platformTransport } from '../src/services/platformTransport';

const mockWebViewInjectJavaScript = jest.fn();

jest.mock('react-native-webview', () => {
  const MockReact = require('react');
  const { View: MockView } = require('react-native');

  return {
    WebView: MockReact.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      MockReact.useImperativeHandle(ref, () => ({
        injectJavaScript: mockWebViewInjectJavaScript,
      }));
      return MockReact.createElement(MockView, props);
    }),
  };
});

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    send: jest.fn(),
  },
}));

const renderTerminal = (
  props: Partial<React.ComponentProps<typeof TerminalEmulator>> = {},
) => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{
          theme: utilityMinimalist,
          mode: 'light',
          setMode: jest.fn(),
          isDark: false,
        }}
      >
        <TerminalEmulator
          sessionId="term-1"
          enabled
          terminalRef={undefined}
          {...props}
        />
      </ThemeContext.Provider>,
    );
  });
  return tree!;
};

const message = (type: string, extra: Record<string, unknown> = {}) => ({
  nativeEvent: {
    data: JSON.stringify({ type, ...extra }),
  },
});

describe('TerminalEmulator WebView bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebViewInjectJavaScript.mockClear();
  });

  it('uses an inline xterm document without external CDN resources', () => {
    const tree = renderTerminal();
    const webview = tree.root.findByType(WebView);

    expect(webview.props.source.html).toContain('new Terminal(');
    expect(webview.props.source.html).toContain('FitAddon');
    expect(webview.props.source.html).not.toContain('cdn.jsdelivr');
    expect(webview.props.source.html).not.toContain('<script src=');
    expect(webview.props.source.html).not.toContain('<link rel="stylesheet"');
  });

  it('does not block programmatic keyboard focus inside the WebView', () => {
    const tree = renderTerminal();
    const webview = tree.root.findByType(WebView);

    expect(webview.props.keyboardDisplayRequiresUserAction).toBeUndefined();
  });

  it('only reports rendered after xterm emits its first render event', () => {
    const onRendered = jest.fn();
    const tree = renderTerminal({ onRendered });
    const webview = tree.root.findByType(WebView);

    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });

    expect(platformTransport.send).toHaveBeenCalledWith({
      type: 'terminal.resize',
      session_id: 'term-1',
      cols: 80,
      rows: 24,
    });
    expect(onRendered).not.toHaveBeenCalled();

    act(() => {
      webview.props.onMessage(message('rendered', { cols: 80, rows: 24 }));
      webview.props.onMessage(message('rendered', { cols: 80, rows: 24 }));
    });

    expect(onRendered).toHaveBeenCalledTimes(1);
  });

  it('forwards xterm text input as text encoding', () => {
    const tree = renderTerminal();
    const webview = tree.root.findByType(WebView);

    act(() => {
      webview.props.onMessage(
        message('input', {
          data: 'pwd\r',
          encoding: 'text',
        }),
      );
    });

    expect(platformTransport.send).toHaveBeenCalledWith({
      type: 'terminal.input',
      session_id: 'term-1',
      data: 'pwd\r',
      encoding: 'text',
    });
  });

  it('requests the native keyboard proxy when xterm is touched', () => {
    const onFocusRequest = jest.fn();
    const tree = renderTerminal({ onFocusRequest });
    const webview = tree.root.findByType(WebView);

    act(() => {
      webview.props.onMessage(message('focusrequest'));
    });

    expect(onFocusRequest).toHaveBeenCalledTimes(1);
  });

  it('ignores xterm focus requests while terminal input is disabled', () => {
    const onFocusRequest = jest.fn();
    const tree = renderTerminal({ enabled: false, onFocusRequest });
    const webview = tree.root.findByType(WebView);

    act(() => {
      webview.props.onMessage(message('focusrequest'));
    });

    expect(onFocusRequest).not.toHaveBeenCalled();
  });

  it('surfaces terminal render errors from the WebView', () => {
    const onRenderError = jest.fn();
    const tree = renderTerminal({ onRenderError });
    const webview = tree.root.findByType(WebView);

    act(() => {
      webview.props.onMessage(
        message('error', {
          message: 'Terminal constructor is missing',
        }),
      );
    });

    expect(onRenderError).toHaveBeenCalledWith('Terminal constructor is missing');
  });

  it('injects fit on native layout changes', () => {
    const terminalRef: React.MutableRefObject<TerminalEmulatorHandle | null> = {
      current: null,
    };
    const tree = renderTerminal({ terminalRef });
    const container = tree.root.findAllByType(View)[0];

    act(() => {
      container.props.onLayout();
    });

    expect(mockWebViewInjectJavaScript.mock.calls.at(-1)?.[0]).toContain(
      "window.injectTerminalData",
    );
    expect(mockWebViewInjectJavaScript.mock.calls.at(-1)?.[0]).toContain('"fit"');
  });
});
