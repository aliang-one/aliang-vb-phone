import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useTheme } from '../../theme/useTheme';
import { getTerminalHtml } from './terminalHtml';
import { platformTransport } from '../../services/platformTransport';

interface TerminalEmulatorProps {
  /** Server-side terminal session ID */
  sessionId: string;
  /** Whether terminal input is accepted. Output is still buffered/rendered. */
  enabled: boolean;
  /** Optional ref bridge for sending shortcut keys/commands into xterm.js. */
  terminalRef?: React.MutableRefObject<TerminalEmulatorHandle | null>;
}

export interface TerminalEmulatorHandle {
  sendText: (data: string) => void;
  focus: () => void;
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
}) => {
  const { isDark } = useTheme();
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const pendingOutputRef = useRef<Array<{ data: string; encoding: string }>>([]);
  const html = useRef(getTerminalHtml(isDark)).current;

  const injectTerminalData = useCallback(
    (type: string, payload = '', encoding = 'text') => {
      webViewRef.current?.injectJavaScript(
        `window.injectTerminalData(${JSON.stringify(
          type,
        )}, ${JSON.stringify(payload)}, ${JSON.stringify(encoding)}); true;`,
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
      sendText: (data: string) => {
        if (!enabled || !data) return;
        platformTransport.send({
          type: 'terminal.input',
          session_id: sessionId,
          encoding: 'text',
          data,
        });
      },
      focus: () => injectTerminalData('focus'),
    };

    return () => {
      terminalRef.current = null;
    };
  }, [enabled, injectTerminalData, sessionId, terminalRef]);

  useEffect(() => {
    readyRef.current = false;
    pendingOutputRef.current = [];
  }, [sessionId]);

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
        cols?: number;
        rows?: number;
      };
      try {
        payload = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }

      switch (payload.type) {
        case 'input':
        case 'binary':
          // Forward keystroke to server via WS
          if (enabled && payload.data) {
            platformTransport.send({
              type: 'terminal.input',
              session_id: sessionId,
              encoding: 'base64',
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
      }
    },
    [sessionId, enabled, flushPendingOutput],
  );

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        onMessage={onMessage}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        bounces={false}
        cacheEnabled={false}
        incognito
        keyboardDisplayRequiresUserAction={false}
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
