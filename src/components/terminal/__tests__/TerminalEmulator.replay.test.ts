/**
 * TerminalEmulator replay rendering (attach flow, P3).
 *
 * Contract under test:
 *   1. WebView ready → terminal.resize is sent BEFORE any replay chunk is
 *      injected (the TUI redraws at the new size, then history is written).
 *   2. If the session's replay stream is complete (replayReady), the buffered
 *      scrollback is injected into xterm as `replay` chunks — in order — and
 *      ONLY THEN is the live output handler registered (registry pending is
 *      drained behind the replay), so live bytes can never interleave into the
 *      middle of the replayed scrollback.
 *   3. While a replay stream is still in flight (chunks buffered, final frame
 *      not yet arrived), the live feed must NOT be wired yet.
 *   4. A session with no replay (fresh create) behaves exactly like before:
 *      live wiring right after ready, no `replay` injections, no badge.
 *   5. replayStatus 'exited' renders the "session ended" banner; a completed
 *      non-empty replay shows the "已回放" badge.
 */
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: React.forwardRef((props: unknown, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({
        injectJavaScript: mockInjectJavaScript,
        reload: jest.fn(),
        goBack: jest.fn(),
        clearHistory: jest.fn(),
      }));
      mockLastWebViewProps = props as Record<string, unknown>;
      return React.createElement(View, { testID: 'terminal-webview-mock' });
    }),
  };
});

jest.mock('../../../services/platformTransport', () => ({
  platformTransport: {
    send: jest.fn((message: { type: string }) => {
      mockTimeline.push(`transport:${message.type}`);
    }),
    loadSnapshot: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  },
}));

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  clearPendingTerminalOutput,
  routeTerminalOutputToEmulator,
  unregisterTerminalOutputHandler,
} from '../../../services/terminalOutputRegistry';
import { TerminalEmulator } from '../TerminalEmulator';
import type { WebViewMessageEvent } from 'react-native-webview';

let mockInjectJavaScript = jest.fn();
let mockLastWebViewProps: Record<string, unknown> = {};
let mockTimeline: string[] = [];

const fireWebViewMessage = (payload: Record<string, unknown>) => {
  const onMessage = mockLastWebViewProps.onMessage as
    | ((event: WebViewMessageEvent) => void)
    | undefined;
  act(() => {
    onMessage?.({
      nativeEvent: { data: JSON.stringify(payload) },
    } as WebViewMessageEvent);
  });
};

const injectTypes = () =>
  mockInjectJavaScript.mock.calls.map(call =>
    // `if (window.injectTerminalData) { window.injectTerminalData("type", ...); } true;`
    String(call[0]).match(/injectTerminalData\("([^"]+)"/)?.[1] ?? 'unknown',
  );

const injectPayloads = (type: string) =>
  mockInjectJavaScript.mock.calls
    .map(call => String(call[0]))
    .filter(script => script.includes(`injectTerminalData("${type}"`))
    .map(script => script.match(/, ("(?:[^"\\]|\\.)*"),/)?.[1] ?? '')
    .map(json => JSON.parse(json) as string);

// The terminal suite lives in a .ts file (no JSX transform) — build elements
// explicitly instead.
const emulatorElement = (props: {
  sessionId?: string;
  replayChunks?: string[];
  replayReady?: boolean;
  replayStatus?: 'live' | 'exited';
}) =>
  React.createElement(TerminalEmulator, {
    sessionId: 'term-replay-1',
    enabled: true,
    ...props,
  });

const renderEmulator = (props: {
  sessionId?: string;
  replayChunks?: string[];
  replayReady?: boolean;
  replayStatus?: 'live' | 'exited';
}) => TestRenderer.create(emulatorElement(props));

describe('TerminalEmulator replay rendering', () => {
  beforeEach(() => {
    mockInjectJavaScript = jest.fn();
    mockLastWebViewProps = {};
    mockTimeline = [];
  });

  afterEach(() => {
    for (const id of ['term-replay-1', 'term-replay-2']) {
      unregisterTerminalOutputHandler(id);
      clearPendingTerminalOutput(id);
    }
  });

  it('injects the completed replay before wiring the live feed', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = renderEmulator({
        replayChunks: ['$ ls\r\n', 'file-a\n'],
        replayReady: true,
        replayStatus: 'live',
      });
    });

    expect(injectTypes()).toEqual([]);

    fireWebViewMessage({ type: 'ready', cols: 80, rows: 24 });

    // Replay chunks are written into xterm as `replay`, in order...
    expect(injectTypes()).toEqual(['theme', 'replay', 'replay']);
    expect(injectPayloads('replay')).toEqual(['$ ls\r\n', 'file-a\n']);

    // ...resize was requested before the replay stream started...
    expect(mockTimeline).toEqual(['transport:terminal.resize']);

    // ...and the live feed is wired: routed chunks inject behind the replay.
    expect(
      routeTerminalOutputToEmulator('term-replay-1', 'live-1\n'),
    ).toBe(true);
    expect(injectTypes()).toEqual(['theme', 'replay', 'replay', 'output']);

    // Completed non-empty replay shows the 已回放 badge.
    expect(renderer.root.findByProps({ children: '已回放' })).toBeTruthy();
  });

  it('waits for the final replay frame, then renders replay ahead of buffered live output', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = renderEmulator({
        replayChunks: ['head'],
        replayReady: false,
      });
    });

    fireWebViewMessage({ type: 'ready', cols: 80, rows: 24 });

    // Stream still in flight: no replay injection yet, live feed not wired.
    expect(injectTypes()).toEqual(['theme']);
    expect(
      routeTerminalOutputToEmulator('term-replay-1', 'early-live\n'),
    ).toBe(false);
    expect(injectTypes()).toEqual(['theme']);
    expect(renderer.root.findAllByProps({ children: '已回放' })).toHaveLength(
      0,
    );

    // Final frame lands in the store: the emulator finishes the replay and
    // wires the live feed, draining the buffered chunk BEHIND the scrollback.
    act(() => {
      renderer.update(
        emulatorElement({
          replayChunks: ['head', 'tail'],
          replayReady: true,
          replayStatus: 'live',
        }),
      );
    });

    expect(injectTypes()).toEqual([
      'theme',
      'replay',
      'replay',
      'output',
    ]);
    expect(injectPayloads('replay')).toEqual(['head', 'tail']);
    expect(injectPayloads('output')).toEqual(['early-live\n']);
    expect(renderer.root.findByProps({ children: '已回放' })).toBeTruthy();
  });

  it('keeps the no-replay create flow: live wiring right after ready and no badge', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = renderEmulator({});
    });

    fireWebViewMessage({ type: 'ready', cols: 80, rows: 24 });

    expect(
      routeTerminalOutputToEmulator('term-replay-1', 'fresh\n'),
    ).toBe(true);
    expect(injectTypes()).toEqual(['theme', 'output']);
    expect(injectPayloads('replay')).toEqual([]);
    expect(renderer.root.findAllByProps({ children: '已回放' })).toHaveLength(
      0,
    );
  });

  it('renders the ended-session banner for an exited replay', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = renderEmulator({
        replayChunks: ['$ exit\n'],
        replayReady: true,
        replayStatus: 'exited',
      });
    });

    expect(
      renderer.root.findAllByProps({
        children: '会话已结束·以下为历史输出',
      }).length,
    ).toBeGreaterThanOrEqual(1);

    fireWebViewMessage({ type: 'ready', cols: 80, rows: 24 });
    expect(injectPayloads('replay')).toEqual(['$ exit\n']);
  });

  it('does not show the badge when the replay carried no chunks', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = renderEmulator({
        replayChunks: [],
        replayReady: true,
        replayStatus: 'live',
      });
    });

    fireWebViewMessage({ type: 'ready', cols: 80, rows: 24 });
    expect(injectPayloads('replay')).toEqual([]);
    expect(renderer.root.findAllByProps({ children: '已回放' })).toHaveLength(
      0,
    );
    // Live feed still wired for an empty replay.
    expect(
      routeTerminalOutputToEmulator('term-replay-1', 'after-empty\n'),
    ).toBe(true);
  });

  // DeviceTerminalScreen swaps sessionId on a mounted emulator (no key), so
  // the sessionId-change commit runs while the previous session's wiring state
  // is still in React state. The reset effect flips the synchronous refs
  // first; the wiring effects must consult them, or the swapped-in session's
  // registry pending buffer (up to 200 chunks of a background-running session)
  // is drained into the freshly-keyed WebView whose `window.injectTerminalData`
  // does not exist yet — silent loss.
  it('does not drain the swapped-in session pending buffer before its WebView is ready', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = renderEmulator({});
    });
    fireWebViewMessage({ type: 'ready', cols: 80, rows: 24 });
    expect(routeTerminalOutputToEmulator('term-replay-1', 'a-live\n')).toBe(
      true,
    );

    // A background-running session B buffers live output while unmounted...
    expect(routeTerminalOutputToEmulator('term-replay-2', 'b-1\n')).toBe(false);
    expect(routeTerminalOutputToEmulator('term-replay-2', 'b-2\n')).toBe(false);
    const injectionCountBeforeSwap = injectTypes().length;

    // ...the screen swaps sessionId (same mounted emulator instance). At this
    // stale commit nothing may be injected: the new WebView is still loading.
    act(() => {
      renderer.update(
        emulatorElement({
          sessionId: 'term-replay-2',
          replayChunks: ['b-history\n'],
          replayReady: true,
          replayStatus: 'live',
        }),
      );
    });

    expect(injectTypes()).toHaveLength(injectionCountBeforeSwap);
    // B's feed is still unclaimed: new chunks keep buffering, nothing lost.
    expect(routeTerminalOutputToEmulator('term-replay-2', 'b-3\n')).toBe(false);

    // The swapped-in WebView loads: resize → replay → then the buffered live
    // output is drained strictly behind the replayed scrollback.
    fireWebViewMessage({ type: 'ready', cols: 80, rows: 24 });

    expect(injectPayloads('replay')).toEqual(['b-history\n']);
    // `a-live` was injected into the OLD WebView before the swap; B's
    // buffered output drains behind the replay, in arrival order.
    expect(injectPayloads('output')).toEqual([
      'a-live\n',
      'b-1\n',
      'b-2\n',
      'b-3\n',
    ]);
  });
});
