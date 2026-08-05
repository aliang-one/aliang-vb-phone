import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
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
}) => {
  const { isDark } = useTheme();
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const renderedRef = useRef(false);
  // Buffer output received while the WebView isn't ready to receive injectJS
  // yet (distinct from the registry's pre-mount buffer, which covers the case
  // where no emulator handler is registered at all). Capped to bound memory.
  const MAX_WEBVIEW_READY_PENDING_OUTPUT = 200;
  const pendingOutputRef = useRef<Array<{ data: string; encoding: string }>>([]);
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

  const flushPendingOutput = useCallback(() => {
    if (!readyRef.current || !pendingOutputRef.current.length) {
      return;
    }
    const pending = pendingOutputRef.current;
    pendingOutputRef.current = [];
    pending.forEach(item => {
      injectTerminalData('output', item.data, item.encoding);
    });
  }, [injectTerminalData]);

  // Forward output data from WS to xterm.js
  const handleOutput = useCallback(
    (data: string, encoding = 'text') => {
      if (!readyRef.current || !webViewRef.current) {
        pendingOutputRef.current = [
          ...pendingOutputRef.current.slice(-(MAX_WEBVIEW_READY_PENDING_OUTPUT - 1)),
          { data, encoding },
        ];
        return;
      }
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
    pendingOutputRef.current = [];
  }, [sessionId]);

  useEffect(() => {
    if (!readyRef.current) return;
    injectTerminalData('theme', terminalThemeJson);
  }, [injectTerminalData, terminalThemeJson]);

  // Register/unregister output handler on the global socket listener.
  // The registry owns the routing table; the component only (un)registers its
  // own handler and replays whatever was buffered before it mounted.
  useEffect(() => {
    registerTerminalOutputHandler(sessionId, handleOutput).forEach(item => {
      handleOutput(item.data, item.encoding);
    });

    return () => {
      unregisterTerminalOutputHandler(sessionId);
    };
  }, [sessionId, handleOutput]);

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
            platformTransport.send({
              type: 'terminal.resize',
              session_id: sessionId,
              cols: payload.cols,
              rows: payload.rows,
            });
          }
          flushPendingOutput();
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
      flushPendingOutput,
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
});
