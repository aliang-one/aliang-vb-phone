import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { getTerminalHtml, getTerminalThemePalette } from './terminalHtml';
import { platformTransport } from '../../services/platformTransport';
import {
  registerTerminalOutputHandler,
  unregisterTerminalOutputHandler,
} from '../../services/terminalOutputRegistry';

interface TerminalEmulatorProps {
  /** Server-side terminal session ID */
  sessionId: string;
  /** Whether terminal input is accepted. Output is still buffered/rendered. */
  enabled: boolean;
  /** Optional ref bridge for sending shortcut keys/commands into xterm.js. */
  terminalRef?: React.MutableRefObject<TerminalEmulatorHandle | null>;
  /** Request the native hidden keyboard proxy to focus when xterm is touched. */
  onFocusRequest?: () => void;
  /** Fires after xterm reports its first render from inside the WebView. */
  onRendered?: () => void;
  /** Fires when the WebView reports a terminal resource/runtime load failure. */
  onRenderError?: (message: string) => void;
  /**
   * Scrollback replay chunks for the session (the store's `replayChunks`,
   * fed by `terminal.replay` frames), in arrival order. Written into xterm
   * verbatim after the WebView is ready and BEFORE the live feed is wired, so
   * history renders exactly once and never interleaves with live output.
   */
  replayChunks?: string[];
  /**
   * True once the final `terminal.replay` frame arrived — `replayChunks` are
   * complete to render. While false with buffered chunks, live wiring waits
   * (the agent starts the live stream only after the final frame, so nothing
   * can be lost by waiting).
   */
  replayReady?: boolean;
  /**
   * Status carried by the final replay frame. `'exited'` renders the
   * "session ended · history below" banner above the emulator.
   */
  replayStatus?: 'live' | 'exited';
}

export interface TerminalEmulatorHandle {
  sendText: (data: string, options?: { focus?: boolean }) => void;
  focus: () => void;
  fit: () => void;
}

/**
 * WebView-based xterm.js terminal emulator.
 *
 * Data flow:
 *   xterm.js input → postMessage → RN → WS terminal.input → Server → Agent
 *   Agent → Server → WS terminal.output → RN → injectJS → xterm.js write
 */
export const TerminalEmulator: React.FC<TerminalEmulatorProps> = ({
  sessionId,
  enabled,
  terminalRef,
  onFocusRequest,
  onRendered,
  onRenderError,
  replayChunks,
  replayReady,
  replayStatus,
}) => {
  const { isDark, theme } = useTheme();
  const { t } = useTranslation('terminal');
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const renderedRef = useRef(false);
  // Replay → live seam: true once this mount claimed the live output feed.
  // Until then the registry's pending buffer holds any arriving output, which
  // keeps live bytes strictly BEHIND the replayed scrollback.
  const liveWiredRef = useRef(false);
  // True once this mount wrote the replay chunks into xterm (consumed once).
  const replayConsumedRef = useRef(false);
  // WebView announced readiness — gates the replay injection + live wiring.
  const [webViewReady, setWebViewReady] = useState(false);
  const [liveWired, setLiveWired] = useState(false);
  // "已回放" badge bit: this mount rendered a non-empty replay.
  const [replayed, setReplayed] = useState(false);
  const html = useRef(getTerminalHtml(isDark)).current;
  const terminalTheme = useMemo(() => getTerminalThemePalette(isDark), [isDark]);
  const terminalThemeJson = useMemo(() => JSON.stringify(terminalTheme), [terminalTheme]);

  const injectTerminalData = useCallback(
    (type: string, payload = '', encoding = 'text', focus = true) => {
      webViewRef.current?.injectJavaScript(
        `if (window.injectTerminalData) { window.injectTerminalData(${JSON.stringify(
          type,
        )}, ${JSON.stringify(payload)}, ${JSON.stringify(
          encoding,
        )}, ${JSON.stringify(focus)}); } true;`,
      );
    },
    [],
  );

  // Forward output data from WS to xterm.js. Only ever registered after the
  // WebView is ready (see liveWired), so chunks arrive as direct injections;
  // everything from before that moment is held by the registry's pending
  // buffer and drained on wiring.
  const handleOutput = useCallback(
    (data: string, encoding = 'text') => {
      injectTerminalData('output', data, encoding);
    },
    [injectTerminalData],
  );

  useEffect(() => {
    if (!terminalRef) return undefined;

    terminalRef.current = {
      sendText: (data: string, options?: { focus?: boolean }) => {
        if (!enabled || !data) return;
        injectTerminalData('input', data, 'text', options?.focus !== false);
      },
      focus: () => injectTerminalData('focus'),
      fit: () => injectTerminalData('fit'),
    };

    return () => {
      terminalRef.current = null;
    };
  }, [enabled, injectTerminalData, terminalRef]);

  useEffect(() => {
    readyRef.current = false;
    renderedRef.current = false;
    liveWiredRef.current = false;
    replayConsumedRef.current = false;
    setWebViewReady(false);
    setLiveWired(false);
    setReplayed(false);
  }, [sessionId]);

  useEffect(() => {
    if (!readyRef.current) return;
    injectTerminalData('theme', terminalThemeJson);
  }, [injectTerminalData, terminalThemeJson]);

  // Replay → live handoff. Order of operations once the WebView is ready:
  //   1. While a replay stream is still in flight (chunks buffered, final
  //      frame not arrived) the live feed is NOT wired yet — the agent's
  //      output gate guarantees no live bytes flow before the final frame,
  //      so waiting only ever buffers into the registry, never drops.
  //   2. A completed, non-empty replay is injected as `replay` chunks (the
  //      WebView writes them verbatim into xterm) and marks the badge bit.
  //   3. Only then is the live feed claimed, and the registry's pending
  //      buffer drained behind the replay (see liveWired effect below).
  //
  // The `readyRef.current` check guards the sessionId-change commit: state
  // (`webViewReady`) is stale-true there while the WebView is already re-keyed
  // and loading, but the reset effect above has synchronously flipped the ref
  // to false — without it, the swapped-in session's replay would be injected
  // into a WebView that cannot receive it yet (and consumed for good).
  useEffect(() => {
    if (!webViewReady || !readyRef.current) return;

    const chunks = replayChunks ?? [];
    const streamComplete = replayReady === true;

    if (!liveWiredRef.current && !streamComplete && chunks.length > 0) {
      return;
    }

    if (streamComplete && chunks.length > 0 && !replayConsumedRef.current) {
      replayConsumedRef.current = true;
      chunks.forEach(chunk => {
        injectTerminalData('replay', chunk, 'text', false);
      });
      setReplayed(true);
    }

    if (!liveWiredRef.current) {
      liveWiredRef.current = true;
      setLiveWired(true);
    }
  }, [webViewReady, replayReady, replayChunks, injectTerminalData]);

  // Register/unregister the live output handler on the global socket
  // listener — only after replay consumption claimed the feed. The registry
  // owns the routing table; wiring returns whatever was buffered while no
  // handler was mounted (pre-mount AND pre-wiring windows) and it is drained
  // strictly behind the replayed scrollback.
  //
  // The `liveWiredRef.current` check guards the sessionId-change commit, where
  // `liveWired` state is stale-true for the PREVIOUS session while the reset
  // effect above has already flipped the ref to false. Without it this effect
  // re-runs for the NEW sessionId at that commit and drains its registry
  // pending buffer straight into the freshly-keyed, still-loading WebView —
  // where `window.injectTerminalData` does not exist yet, so the chunks are
  // silently lost. Registration must wait for the new WebView's `ready`.
  useEffect(() => {
    if (!liveWired || !liveWiredRef.current) return undefined;

    registerTerminalOutputHandler(sessionId, handleOutput).forEach(item => {
      handleOutput(item.data, item.encoding);
    });

    return () => {
      unregisterTerminalOutputHandler(sessionId);
    };
  }, [liveWired, sessionId, handleOutput]);

  // Handle messages from xterm.js WebView
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let payload: {
        type: string;
        data?: string;
        encoding?: string;
        cols?: number;
        rows?: number;
        message?: string;
      };
      try {
        payload = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }

      switch (payload.type) {
        case 'input':
          // Forward keystroke to server via WS
          if (enabled && payload.data) {
            const encoding = payload.encoding === 'base64' ? 'base64' : 'text';
            platformTransport.send({
              type: 'terminal.input',
              session_id: sessionId,
              encoding,
              data: payload.data,
            });
          }
          break;

        case 'resize':
          // Forward resize to server
          if (payload.cols && payload.rows) {
            platformTransport.send({
              type: 'terminal.resize',
              session_id: sessionId,
              cols: payload.cols,
              rows: payload.rows,
            });
          }
          break;

        case 'ready':
          readyRef.current = true;
          injectTerminalData('theme', terminalThemeJson);
          if (payload.cols && payload.rows) {
            // Resize first: the agent re-renders the TUI at the new size, so
            // the replayed scrollback and live stream land in the right shape.
            platformTransport.send({
              type: 'terminal.resize',
              session_id: sessionId,
              cols: payload.cols,
              rows: payload.rows,
            });
          }
          setWebViewReady(true);
          break;

        case 'rendered':
          if (!renderedRef.current) {
            renderedRef.current = true;
            onRendered?.();
          }
          break;

        case 'error':
          onRenderError?.(payload.message ?? 'Terminal WebView failed to load.');
          break;

        case 'focusrequest':
          if (enabled) {
            onFocusRequest?.();
          }
          break;
      }
    },
    [
      sessionId,
      enabled,
      injectTerminalData,
      onFocusRequest,
      onRenderError,
      onRendered,
      terminalThemeJson,
    ],
  );

  return (
    <View
      style={styles.container}
      onLayout={() => {
        injectTerminalData('fit');
      }}
    >
      {replayStatus === 'exited' ? (
        <View
          style={[
            styles.replayBanner,
            { backgroundColor: theme.colors.surfaceContainerHigh },
          ]}
        >
          <Text
            style={[
              styles.replayBannerText,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            {t('terminal:replay.endedBanner')}
          </Text>
        </View>
      ) : null}
      <WebView
        key={sessionId}
        ref={webViewRef}
        source={{ html }}
        onMessage={onMessage}
        style={styles.webview}
        hideKeyboardAccessoryView
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        bounces={false}
        cacheEnabled={false}
        incognito
        automaticallyAdjustContentInsets={false}
        contentMode="mobile"
      />
      {replayed ? (
        <View
          pointerEvents="none"
          style={[
            styles.replayBadge,
            {
              backgroundColor: theme.colors.surfaceContainerHigh,
              borderColor: theme.colors.outlineVariant,
            },
          ]}
        >
          <Text
            style={[
              styles.replayBadgeText,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            {t('terminal:replay.replayedBadge')}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  replayBanner: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  replayBannerText: {
    fontSize: 12,
  },
  replayBadge: {
    position: 'absolute',
    top: 6,
    right: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  replayBadgeText: {
    fontSize: 10,
  },
});
