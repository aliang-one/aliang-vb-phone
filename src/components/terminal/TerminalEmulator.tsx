import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useTheme } from '../../theme/useTheme';
import { getTerminalHtml, getTerminalThemePalette } from './terminalHtml';
import { platformTransport } from '../../services/platformTransport';

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

const MAX_PENDING_OUTPUT = 200;

interface TerminalOutputChunk {
  data: string;
  encoding: string;
}

const pendingTerminalOutput = new Map<string, TerminalOutputChunk[]>();

export const routeTerminalOutputToEmulator = (
  sessionId: string,
  data: string,
  encoding = 'text',
) => {
  const handler = terminalOutputHandlers.get(sessionId);
  if (handler) {
    handler(data, encoding);
    return true;
  }

  const pending = pendingTerminalOutput.get(sessionId) ?? [];
  pendingTerminalOutput.set(sessionId, [
    ...pending.slice(-(MAX_PENDING_OUTPUT - 1)),
    { data, encoding },
  ]);
  return false;
};

export const drainPendingTerminalOutput = (sessionId: string) => {
  const pending = pendingTerminalOutput.get(sessionId) ?? [];
  pendingTerminalOutput.delete(sessionId);
  return pending;
};

export const clearPendingTerminalOutput = (sessionId: string) => {
  pendingTerminalOutput.delete(sessionId);
};

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
          ...pendingOutputRef.current.slice(-(MAX_PENDING_OUTPUT - 1)),
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

  // Register/unregister output handler on the global socket listener
  useEffect(() => {
    // Register this session's output handler
    terminalOutputHandlers.set(sessionId, handleOutput);
    drainPendingTerminalOutput(sessionId).forEach(item => {
      handleOutput(item.data, item.encoding);
    });

    return () => {
      terminalOutputHandlers.delete(sessionId);
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

/**
 * Global registry for terminal output handlers.
 * The store's WS message handler checks this map before appending to line-based output.
 */
export const terminalOutputHandlers = new Map<
  string,
  (data: string, encoding?: string) => void
>();

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
