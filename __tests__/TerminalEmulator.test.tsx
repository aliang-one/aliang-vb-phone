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
  clearPendingTerminalOutput,
  registerTerminalOutputHandler,
  routeTerminalOutputToEmulator,
  unregisterTerminalOutputHandler,
} from '../src/services/terminalOutputRegistry';
// 自发 resize 打点走真实服务(mark 的可观测效应 = 防抖窗口开启)。
import {
  isLocalTerminalResizeRecent,
  resetTerminalGeometryFollowForTests,
} from '../src/services/terminalGeometryFollow';

const mockWebViewInjectJavaScript = jest.fn();
const mockWebViewMount = jest.fn();
const mockWebViewUnmount = jest.fn();
const mockClearTerminalGeometryFollow = jest.fn();

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

// 几何跟随(Task 13):组件只在 resize 接管时经 getState() 调
// clearTerminalGeometryFollow —— mock 掉整个 store,真实 store 不进本测试图。
jest.mock('../src/store/controlCenterStore', () => ({
  useControlCenterStore: {
    getState: () => ({
      clearTerminalGeometryFollow: mockClearTerminalGeometryFollow,
    }),
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

    // 浏览器优先(2026-10-27):ready 不再上报 WebView 默认 80×24 网格——
    // attach/ready 都不带几何,进屏对齐由桥侧启动 fit → resize 消息负责。
    expect(platformTransport.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminal.resize' }),
    );
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

    expect(platformTransport.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminal.resize' }),
    );
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

  it('injects fit on native layout changes after ready, never before', () => {
    const terminalRef: React.MutableRefObject<TerminalEmulatorHandle | null> = {
      current: null,
    };
    const tree = renderTerminal({ terminalRef });
    const container = tree.root.findAllByType(View)[0];

    // ready 前的 onLayout 不注入:桥侧 fit addon 尚未就绪,命令只会落到空
    // 实现上;ready 后的启动 fit 补上首次对齐。
    act(() => {
      container.props.onLayout();
    });
    expect(
      mockWebViewInjectJavaScript.mock.calls.some(call =>
        String(call[0]).includes('"fit"'),
      ),
    ).toBe(false);

    act(() => {
      tree.root
        .findByType(WebView)
        .props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });

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

// 几何跟随装配(Task 13):followGeometry prop 翻转驱动桥注入(follow/
// unfollow);follow 态下 WebView 的 resize 回报区分「follow 注入自身的回声」
// (同几何,丢弃)与「真实接管」(异几何,mark+清跟随+转发);ready 初始
// resize 在跟随挂起时让位给随后的 follow 注入(防抢先把 pty 拉回手机几何)。
describe('TerminalEmulator geometry follow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebViewInjectJavaScript.mockClear();
    mockWebViewMount.mockClear();
    mockWebViewUnmount.mockClear();
    resetTerminalGeometryFollowForTests();
  });

  const lightProvider = (element: React.ReactElement) => (
    <ThemeContext.Provider
      value={{
        theme: utilityMinimalist,
        mode: 'light',
        setMode: jest.fn(),
        isDark: false,
      }}
    >
      {element}
    </ThemeContext.Provider>
  );

  const injectScriptsContaining = (needle: string) =>
    mockWebViewInjectJavaScript.mock.calls
      .map(call => String(call[0]))
      .filter(script => script.includes(needle));

  it('injects follow with the pty geometry when followGeometry appears after ready', () => {
    const tree = renderTerminal();
    const webview = tree.root.findByType(WebView);
    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });
    mockWebViewInjectJavaScript.mockClear();

    act(() => {
      tree.update(
        lightProvider(
          <TerminalEmulator
            sessionId="term-1"
            enabled
            followGeometry={{ cols: 100, rows: 30, origin: 'web' }}
          />,
        ),
      );
    });

    const followScripts = injectScriptsContaining('injectTerminalData("follow"');
    expect(followScripts).toHaveLength(1);
    expect(followScripts[0]).toContain(
      JSON.stringify(JSON.stringify({ cols: 100, rows: 30 })),
    );
  });

  it('injects unfollow when followGeometry clears', () => {
    const tree = renderTerminal({
      followGeometry: { cols: 100, rows: 30, origin: 'web' },
    });
    const webview = tree.root.findByType(WebView);
    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });
    expect(injectScriptsContaining('injectTerminalData("follow"')).toHaveLength(
      1,
    );

    mockWebViewInjectJavaScript.mockClear();
    act(() => {
      tree.update(lightProvider(<TerminalEmulator sessionId="term-1" enabled />));
    });

    expect(
      injectScriptsContaining('injectTerminalData("unfollow"'),
    ).toHaveLength(1);
  });

  it('re-injects follow when the followed geometry changes while active', () => {
    const tree = renderTerminal({
      followGeometry: { cols: 120, rows: 30, origin: 'web' },
    });
    const webview = tree.root.findByType(WebView);
    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });
    expect(injectScriptsContaining('injectTerminalData("follow"')).toHaveLength(
      1,
    );

    // 跟随中 web 端再 resize → server 广播新几何 → store 覆写(非空→非空):
    // 必须重注入 follow 锁新几何,否则手机锁死旧几何。
    mockWebViewInjectJavaScript.mockClear();
    act(() => {
      tree.update(
        lightProvider(
          <TerminalEmulator
            sessionId="term-1"
            enabled
            followGeometry={{ cols: 100, rows: 26, origin: 'web' }}
          />,
        ),
      );
    });

    const followScripts = injectScriptsContaining('injectTerminalData("follow"');
    expect(followScripts).toHaveLength(1);
    expect(followScripts[0]).toContain(
      JSON.stringify(JSON.stringify({ cols: 100, rows: 26 })),
    );
  });

  it('does not re-inject follow when only the object identity changes', () => {
    const tree = renderTerminal({
      followGeometry: { cols: 120, rows: 30, origin: 'web' },
    });
    const webview = tree.root.findByType(WebView);
    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });
    mockWebViewInjectJavaScript.mockClear();

    // 等值新对象(store 重写/父重渲):引用变、几何值不变 → 不重注入。
    act(() => {
      tree.update(
        lightProvider(
          <TerminalEmulator
            sessionId="term-1"
            enabled
            followGeometry={{ cols: 120, rows: 30, origin: 'phone' }}
          />,
        ),
      );
    });

    expect(injectScriptsContaining('injectTerminalData("follow"')).toHaveLength(
      0,
    );
    expect(
      injectScriptsContaining('injectTerminalData("unfollow"'),
    ).toHaveLength(0);
  });

  it('drops the follow injection resize echo instead of taking over', () => {
    const tree = renderTerminal({
      followGeometry: { cols: 100, rows: 30, origin: 'web' },
    });
    const webview = tree.root.findByType(WebView);
    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });

    // 桥内 term.resize(100,30) → onResize 回报同几何 = follow 注入自身的回声。
    act(() => {
      webview.props.onMessage(message('resize', { cols: 100, rows: 30 }));
    });

    expect(platformTransport.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminal.resize' }),
    );
    expect(mockClearTerminalGeometryFollow).not.toHaveBeenCalled();
    expect(isLocalTerminalResizeRecent('term-1')).toBe(false);
  });

  // 启动 fit 竞态(质量审查 Issue 1 的 RN 侧闸):桥的 100ms 启动 fit 在挂起
  // 跟随注入落地之前回报手机几何 —— jsdom 不执行桥内 setTimeout,测试以消息
  // 次序构造同一竞态窗口(挂起未注入时到达的 resize 回报)。视同 ready 让位:
  // 不 mark、不清跟随、不转发,防三连 resize 风暴(误接管 → 清跟随 → 注入
  // echo 二次误判)。
  it('drops the startup-fit resize report while a pending follow is not yet injected', () => {
    const tree = renderTerminal({
      followGeometry: { cols: 100, rows: 30, origin: 'web' },
    });
    const webview = tree.root.findByType(WebView);

    // 启动 fit 回报手机几何(≠ 挂起的 follow 几何),注入尚未发出。
    act(() => {
      webview.props.onMessage(message('resize', { cols: 80, rows: 24 }));
    });

    expect(platformTransport.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminal.resize' }),
    );
    expect(mockClearTerminalGeometryFollow).not.toHaveBeenCalled();
    expect(isLocalTerminalResizeRecent('term-1')).toBe(false);

    // 注入完成后,既有 echo 判别照常工作:同几何回声仍被丢弃。
    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });
    expect(injectScriptsContaining('injectTerminalData("follow"')).toHaveLength(
      1,
    );

    act(() => {
      webview.props.onMessage(message('resize', { cols: 100, rows: 30 }));
    });
    expect(platformTransport.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminal.resize' }),
    );
    expect(mockClearTerminalGeometryFollow).not.toHaveBeenCalled();
  });

  it('treats a differing resize while following as a takeover', () => {
    const tree = renderTerminal({
      followGeometry: { cols: 100, rows: 30, origin: 'web' },
    });
    const webview = tree.root.findByType(WebView);
    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });

    // 用户/布局发起的真实 resize(几何 ≠ follow)→ 接管:打点 + 清跟随 + 转发。
    act(() => {
      webview.props.onMessage(message('resize', { cols: 80, rows: 24 }));
    });

    expect(isLocalTerminalResizeRecent('term-1')).toBe(true);
    expect(mockClearTerminalGeometryFollow).toHaveBeenCalledWith('term-1');
    expect(platformTransport.send).toHaveBeenCalledWith({
      type: 'terminal.resize',
      session_id: 'term-1',
      cols: 80,
      rows: 24,
    });
  });

  // Minor 2(质量审查):DeviceTerminalScreen 在挂载态 emulator 上换 sessionId
  // (WebView 重键);followGeometry 跨会话保持时,新 WebView 的 ready 必须重新
  // 注入 follow —— prevFollowRef/injected 闸随 sessionId 重置,否则上一会话
  // 遗留的 prev 会压掉注入。
  it('re-injects follow for the swapped-in session WebView when followGeometry persists', () => {
    const tree = renderTerminal({
      sessionId: 'term-1',
      followGeometry: { cols: 100, rows: 30, origin: 'web' },
    });
    const webview = tree.root.findByType(WebView);
    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });
    expect(injectScriptsContaining('injectTerminalData("follow"')).toHaveLength(
      1,
    );

    mockWebViewInjectJavaScript.mockClear();
    act(() => {
      tree.update(
        lightProvider(
          <TerminalEmulator
            sessionId="term-2"
            enabled
            followGeometry={{ cols: 100, rows: 30, origin: 'web' }}
          />,
        ),
      );
    });

    // 交换的 stale commit:新 WebView 仍在加载,不得注入。
    expect(injectScriptsContaining('injectTerminalData("follow"')).toHaveLength(
      0,
    );

    // 新 WebView ready:挂起的跟随重新注入(且 ready 初始 resize 仍让位)。
    act(() => {
      tree.root
        .findByType(WebView)
        .props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });
    const followScripts = injectScriptsContaining('injectTerminalData("follow"');
    expect(followScripts).toHaveLength(1);
    expect(followScripts[0]).toContain(
      JSON.stringify(JSON.stringify({ cols: 100, rows: 30 })),
    );
    expect(platformTransport.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminal.resize' }),
    );
  });

  it('skips the ready initial resize while a follow is pending, locking via follow instead', () => {
    const tree = renderTerminal({
      followGeometry: { cols: 100, rows: 30, origin: 'web' },
    });
    const webview = tree.root.findByType(WebView);

    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });

    // store 保真重进:ready 的手机初始几何(80x24)不得抢在 follow 注入前
    // 把 pty 拉回手机几何 —— 不发、不 mark、不 clear,由 follow 锁网格。
    expect(platformTransport.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminal.resize' }),
    );
    expect(isLocalTerminalResizeRecent('term-1')).toBe(false);
    expect(mockClearTerminalGeometryFollow).not.toHaveBeenCalled();
    expect(injectScriptsContaining('injectTerminalData("follow"')).toHaveLength(
      1,
    );
  });

  it('sends no ready initial resize even with no follow pending (startup fit owns the entry report)', () => {
    const tree = renderTerminal();
    const webview = tree.root.findByType(WebView);

    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });

    // 浏览器优先(2026-10-27):ready 的 80×24 是 WebView 默认网格,先发会把
    // pty 砸回默认、让在线网页 letterbox。进屏几何一律由桥侧启动 fit 的
    // resize 消息上报(尺寸恰好没变时桥侧也会补报一条)。
    expect(platformTransport.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminal.resize' }),
    );
    expect(isLocalTerminalResizeRecent('term-1')).toBe(false);
  });
});

// 交接闸门(Bug D ②,审计 §2-2):attach 已宣告(replayPending=true)但首帧
// 未到(replayChunks 仍空)时,旧闸 `!replayReady && chunks.length > 0` 拦不住
// —— 旧 pending 被提前放行、实时流先接,历史晚到再追加,顺序错乱(探针
// 捕获顺序 output → replay → replay)。新闸在 replayPending 期间保持等待。
describe('TerminalEmulator replay handoff gate (replayPending)', () => {
  const wrapLight = (element: React.ReactElement) => (
    <ThemeContext.Provider
      value={{
        theme: utilityMinimalist,
        mode: 'light',
        setMode: jest.fn(),
        isDark: false,
      }}
    >
      {element}
    </ThemeContext.Provider>
  );

  /** 逐注入提取 injectTerminalData 的 type 序列(一次注入可能带多个调用)。 */
  const injectTypes = () =>
    mockWebViewInjectJavaScript.mock.calls.flatMap(call =>
      String(call[0])
        .match(/injectTerminalData\("([^"]+)"/g)
        ?.map(m => m.match(/"([^"]+)"/)?.[1] ?? 'unknown') ?? [],
    );

  const injectPayloads = (type: string) =>
    mockWebViewInjectJavaScript.mock.calls
      .map(call => String(call[0]))
      .flatMap(script => {
        const payloads: string[] = [];
        const pattern = /injectTerminalData\("([^"]+)", ("(?:[^"\\]|\\.)*")/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(script)) !== null) {
          if (match[1] === type) {
            payloads.push(JSON.parse(match[2]) as string);
          }
        }
        return payloads;
      });

  beforeEach(() => {
    jest.clearAllMocks();
    mockWebViewInjectJavaScript.mockClear();
    mockWebViewMount.mockClear();
    mockWebViewUnmount.mockClear();
    unregisterTerminalOutputHandler('term-1');
    clearPendingTerminalOutput('term-1');
  });

  afterEach(() => {
    unregisterTerminalOutputHandler('term-1');
    clearPendingTerminalOutput('term-1');
    jest.useRealTimers();
  });

  it('holds the live handoff while the stream is announced but no frame arrived yet', () => {
    const tree = renderTerminal({ replayPending: true, replayChunks: [] });
    const webview = tree.root.findByType(WebView);

    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });

    // 首帧未到:不注入 replay,也不注册实时 handler —— 路由继续走暂存
    // (false = 未直达模拟器)。旧闸此窗口会放行并接实时流(Bug D ②)。
    expect(injectPayloads('replay')).toEqual([]);
    expect(routeTerminalOutputToEmulator('term-1', 'live-1\n')).toBe(false);
  });

  it('hands off once the final frame lands: replay injected, then live delivered', () => {
    jest.useFakeTimers();
    const tree = renderTerminal({
      replayPending: true,
      replayChunks: ['head\n'],
    });
    const webview = tree.root.findByType(WebView);

    act(() => {
      webview.props.onMessage(message('ready', { cols: 80, rows: 24 }));
    });
    // 流在途(chunks 有但末帧未到):同样不接实时流,输出进暂存。
    expect(routeTerminalOutputToEmulator('term-1', 'early\n')).toBe(false);

    // 末帧落地(store:replayPending 清除 + replayReady 置位)→ 注入回放、
    // 接实时流,暂存的 early 输出排在回放之后补放。
    act(() => {
      tree.update(
        wrapLight(
          <TerminalEmulator
            sessionId="term-1"
            enabled
            terminalRef={undefined}
            replayPending={false}
            replayReady
            replayChunks={['head\n', 'tail\n']}
          />,
        ),
      );
    });
    act(() => {
      jest.advanceTimersByTime(60);
    });

    expect(injectPayloads('replay')).toEqual(['head\n', 'tail\n']);
    expect(injectPayloads('output')).toEqual(['early\n']);
    // 顺序契约:回放先于任何 output 注入(交接闸的全部意义)。
    const types = injectTypes();
    expect(types.indexOf('replay')).toBeLessThan(types.indexOf('output'));
    // 接入后新 live 块直达模拟器。
    expect(routeTerminalOutputToEmulator('term-1', 'after\n')).toBe(true);
  });
});
