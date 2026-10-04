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
import { getTerminalThemePalette } from '../src/components/terminal/terminalHtml';
import {
  registerTerminalOutputHandler,
  routeTerminalOutputToEmulator,
  unregisterTerminalOutputHandler,
} from '../src/services/terminalOutputRegistry';

const mockWebViewInjectJavaScript = jest.fn();
const mockWebViewMount = jest.fn();
const mockWebViewUnmount = jest.fn();

jest.mock('react-native-webview', () => {
  const MockReact = require('react');
  const { View: MockView } = require('react-native');

  return {
    WebView: MockReact.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      MockReact.useEffect(() => {
        mockWebViewMount();
        return () => mockWebViewUnmount();
      }, []);
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
    mockWebViewMount.mockClear();
    mockWebViewUnmount.mockClear();
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

  it('rebuilds the WebView when switching terminal sessions', () => {
    const tree = renderTerminal({ sessionId: 'term-1' });

    expect(mockWebViewMount).toHaveBeenCalledTimes(1);
    expect(mockWebViewUnmount).not.toHaveBeenCalled();

    act(() => {
      tree.update(
        <ThemeContext.Provider
          value={{
            theme: utilityMinimalist,
            mode: 'light',
            setMode: jest.fn(),
            isDark: false,
          }}
        >
          <TerminalEmulator
            sessionId="term-2"
            enabled
            terminalRef={undefined}
          />
        </ThemeContext.Provider>,
      );
    });

    expect(mockWebViewUnmount).toHaveBeenCalledTimes(1);
    expect(mockWebViewMount).toHaveBeenCalledTimes(2);
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

  it('injects the active theme when xterm becomes ready and when it changes', () => {
    const tree = renderTerminal();
    const webview = tree.root.findByType(WebView);

    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });

    expect(mockWebViewInjectJavaScript).toHaveBeenCalledWith(
      expect.stringContaining(
        JSON.stringify(JSON.stringify(getTerminalThemePalette(false))),
      ),
    );

    act(() => {
      tree.update(
        <ThemeContext.Provider
          value={{
            theme: utilityMinimalist,
            mode: 'dark',
            setMode: jest.fn(),
            isDark: true,
          }}
        >
          <TerminalEmulator sessionId="term-1" enabled terminalRef={undefined} />
        </ThemeContext.Provider>,
      );
    });

    expect(mockWebViewInjectJavaScript).toHaveBeenLastCalledWith(
      expect.stringContaining(
        JSON.stringify(JSON.stringify(getTerminalThemePalette(true))),
      ),
    );
  });

  it('does not reinject the theme when the parent rerenders with the same mode', () => {
    const tree = renderTerminal();
    const webview = tree.root.findByType(WebView);

    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });

    const callCountAfterReady = mockWebViewInjectJavaScript.mock.calls.length;

    act(() => {
      tree.update(
        <ThemeContext.Provider
          value={{
            theme: utilityMinimalist,
            mode: 'light',
            setMode: jest.fn(),
            isDark: false,
          }}
        >
          <TerminalEmulator sessionId="term-1" enabled terminalRef={undefined} />
        </ThemeContext.Provider>,
      );
    });

    expect(mockWebViewInjectJavaScript.mock.calls.length).toBe(callCountAfterReady);
  });

  it('resets rendered state when the session changes', () => {
    const onRendered = jest.fn();
    const tree = renderTerminal({ onRendered });
    const webview = tree.root.findByType(WebView);

    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
      webview.props.onMessage(message('rendered', { cols: 80, rows: 24 }));
      webview.props.onMessage(message('input', { data: 'pwd\r', encoding: 'text' }));
    });

    expect(platformTransport.send).toHaveBeenCalledWith({
      type: 'terminal.resize',
      session_id: 'term-1',
      cols: 80,
      rows: 24,
    });
    expect(onRendered).toHaveBeenCalledTimes(1);

    act(() => {
      tree.update(
        <ThemeContext.Provider
          value={{
            theme: utilityMinimalist,
            mode: 'light',
            setMode: jest.fn(),
            isDark: false,
          }}
        >
          <TerminalEmulator
            sessionId="term-2"
            enabled
            terminalRef={undefined}
            onRendered={onRendered}
          />
        </ThemeContext.Provider>,
      );
    });

    act(() => {
      tree.root
        .findByType(WebView)
        .props.onMessage(message('rendered', { cols: 80, rows: 24 }));
    });

    expect(onRendered).toHaveBeenCalledTimes(2);
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

// RN↔WebView 桥接合并(2026-10 终端卡顿修复):挂载态的 terminal.output 不再
// 逐块 injectJavaScript —— 突发块合并进单次注入,卸载/换会话时未冲刷的块
// 回填 registry pending(不丢、不串台)。
describe('TerminalEmulator output batching', () => {
  const renderWired = () => {
    const tree = renderTerminal();
    const webview = tree.root.findByType(WebView);
    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });
    return tree;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockWebViewInjectJavaScript.mockClear();
    mockWebViewMount.mockClear();
    mockWebViewUnmount.mockClear();
    unregisterTerminalOutputHandler('term-1');
  });

  afterEach(() => {
    unregisterTerminalOutputHandler('term-1');
    jest.useRealTimers();
  });

  it('injects the leading chunk immediately and coalesces the burst behind it', () => {
    jest.useFakeTimers();
    const tree = renderWired();
    const webview = tree.root.findByType(WebView);

    const callsAfterReady = mockWebViewInjectJavaScript.mock.calls.length;
    act(() => {
      routeTerminalOutputToEmulator('term-1', 'one');
      routeTerminalOutputToEmulator('term-1', 'two');
      routeTerminalOutputToEmulator('term-1', 'three');
    });

    // Leading chunk renders with zero added latency…
    expect(mockWebViewInjectJavaScript.mock.calls.length).toBe(
      callsAfterReady + 1,
    );
    expect(mockWebViewInjectJavaScript.mock.calls[callsAfterReady][0]).toContain(
      '"one"',
    );

    // …the rest of the burst lands in ONE trailing injectJavaScript, in order.
    act(() => {
      jest.advanceTimersByTime(30);
    });
    expect(mockWebViewInjectJavaScript.mock.calls.length).toBe(
      callsAfterReady + 2,
    );
    const batchedScript = String(
      mockWebViewInjectJavaScript.mock.calls[callsAfterReady + 1][0],
    );
    expect(batchedScript).toContain('"two"');
    expect(batchedScript).toContain('"three"');
    expect(batchedScript.indexOf('"two"')).toBeLessThan(
      batchedScript.indexOf('"three"'),
    );
  });

  it('requeues output still batched when the emulator unmounts', () => {
    jest.useFakeTimers();
    const tree = renderWired();

    act(() => {
      routeTerminalOutputToEmulator('term-1', 'lead');
      routeTerminalOutputToEmulator('term-1', 'pending-1');
      routeTerminalOutputToEmulator('term-1', 'pending-2');
    });

    act(() => {
      tree.unmount();
    });
    const callsAtUnmount = mockWebViewInjectJavaScript.mock.calls.length;

    // The cancelled window must not fire into the gone WebView…
    act(() => {
      jest.advanceTimersByTime(60);
    });
    expect(mockWebViewInjectJavaScript.mock.calls.length).toBe(callsAtUnmount);

    // …and the buffered chunks are back in the registry, in arrival order.
    expect(registerTerminalOutputHandler('term-1', () => {})).toEqual([
      { data: 'pending-1', encoding: 'text' },
      { data: 'pending-2', encoding: 'text' },
    ]);
  });
});
