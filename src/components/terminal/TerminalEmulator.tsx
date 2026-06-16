import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useTheme } from '../../theme/useTheme';
import { getTerminalHtml } from './terminalHtml';
import { platformTransport } from '../../services/platformTransport';

interface TerminalEmulatorProps {
  /** Server-side terminal session ID */
  sessionId: string;
  /** Whether the terminal is active */
  enabled: boolean;
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
}) => {
  const { isDark } = useTheme();
  const webViewRef = useRef<WebView>(null);
  const html = useRef(getTerminalHtml(isDark)).current;

  // Forward output data from WS to xterm.js
  const handleOutput = useCallback(
    (data: string, encoding = 'text') => {
      if (!webViewRef.current || !enabled) return;
      webViewRef.current.injectJavaScript(
        `window.injectTerminalData('output', ${JSON.stringify(
          data,
        )}, ${JSON.stringify(encoding)}); true;`,
      );
    },
    [enabled],
  );

  // Register/unregister output handler on the global socket listener
  useEffect(() => {
    if (!enabled) return;

    // Register this session's output handler
    terminalOutputHandlers.set(sessionId, handleOutput);

    return () => {
      terminalOutputHandlers.delete(sessionId);
    };
  }, [sessionId, handleOutput, enabled]);

  // Handle messages from xterm.js WebView
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (!enabled) return;
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
          if (payload.data) {
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
          // Terminal initialized — notify that we're ready
          break;
      }
    },
    [sessionId, enabled],
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
