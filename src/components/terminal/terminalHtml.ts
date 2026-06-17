/**
 * Inline HTML for the xterm.js terminal emulator loaded inside a WebView.
 *
 * Communication bridge:
 *   WebView → RN:  window.ReactNativeWebView.postMessage(JSON)
 *   RN → WebView:  window.injectTerminalData(type, payload, encoding, focus)
 */

import { XTERM_CSS, XTERM_FIT_JS, XTERM_JS } from './terminalAssets';

export interface TerminalThemePalette {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export function getTerminalThemePalette(isDark: boolean): TerminalThemePalette {
  return {
    background: isDark ? '#0d1117' : '#ffffff',
    foreground: isDark ? '#e6edf3' : '#1f2328',
    cursor: isDark ? '#58a6ff' : '#0969da',
    selectionBackground: isDark
      ? 'rgba(88,166,255,0.25)'
      : 'rgba(9,105,218,0.25)',
    selectionForeground: isDark ? '#e6edf3' : '#1f2328',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc',
  };
}

export function getTerminalHtml(isDark: boolean): string {
  const palette = getTerminalThemePalette(isDark);
  const serializedPalette = JSON.stringify(palette);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <style>
    ${XTERM_CSS}
  </style>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: ${palette.background}; }
    #terminal-container { width: 100%; height: 100%; overflow: hidden; }
    #terminal-root { width: 100%; height: 100%; min-height: 80px; }
  </style>
</head>
<body>
  <div id="terminal-container"><div id="terminal-root"></div></div>
  <script>
    ${XTERM_JS}
  </script>
  <script>
    ${XTERM_FIT_JS}
  </script>
  <script>
    (function() {
      function postBridgeMessage(payload) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }

      window.onerror = function(message) {
        postBridgeMessage({
          type: 'error',
          message: String(message || 'Terminal runtime error')
        });
      };

      var didAnnounceRendered = false;
      var currentTheme = ${serializedPalette};
      try {
      var term = new Terminal({
        theme: currentTheme,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.15,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 5000,
        allowProposedApi: true,
        allowTransparency: false,
        drawBoldTextInBrightColors: true,
        convertEol: false,
        disableStdin: false
      });

      var fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);

      var container = document.getElementById('terminal-container');
      var terminalRoot = document.getElementById('terminal-root');
      var pendingTouchStart = null;
      var TOUCH_END_MAX_OFFSET = 8;

      function configureHelperTextarea() {
        var textarea = terminalRoot.querySelector('.xterm-helper-textarea');
        if (!textarea) return;
        textarea.setAttribute('autocapitalize', 'off');
        textarea.setAttribute('autocomplete', 'off');
        textarea.setAttribute('autocorrect', 'off');
        textarea.setAttribute('spellcheck', 'false');
        if (textarea.dataset.mobileKeyboardConfigured) return;
        textarea.dataset.mobileKeyboardConfigured = 'true';
      }

      configureHelperTextarea();
      setTimeout(configureHelperTextarea, 0);

      function postFocusRequest() {
        configureHelperTextarea();
        postBridgeMessage({
          type: 'focusrequest'
        });
      }

      function clearPendingTouchKeyboard() {
        pendingTouchStart = null;
      }

      function requestNativeKeyboard(event) {
        clearPendingTouchKeyboard();
        var touch = event.touches && event.touches[0];
        pendingTouchStart = touch
          ? { x: touch.clientX, y: touch.clientY, at: Date.now() }
          : null;
      }

      function cancelNativeKeyboardForGesture(event) {
        if (!pendingTouchStart) return;
        var touch = event.touches && event.touches[0];
        if (!touch) {
          clearPendingTouchKeyboard();
          return;
        }
        var dx = Math.abs(touch.clientX - pendingTouchStart.x);
        var dy = Math.abs(touch.clientY - pendingTouchStart.y);
        if (dx > 8 || dy > 8) {
          clearPendingTouchKeyboard();
        }
      }

      function focusTerminal() {
        configureHelperTextarea();
        term.focus();
      }

      function announceRendered() {
        if (didAnnounceRendered) return;
        didAnnounceRendered = true;
        postBridgeMessage({
          type: 'rendered',
          cols: term.cols,
          rows: term.rows
        });
      }

      term.onRender(function() {
        announceRendered();
      });

      term.open(terminalRoot);

      terminalRoot.addEventListener('touchstart', requestNativeKeyboard, {
        passive: true
      });
      terminalRoot.addEventListener('touchmove', cancelNativeKeyboardForGesture, {
        passive: true
      });
      terminalRoot.addEventListener('touchcancel', clearPendingTouchKeyboard, {
        passive: true
      });
      terminalRoot.addEventListener('touchend', function(event) {
        if (!pendingTouchStart) return;
        var touch = event.changedTouches && event.changedTouches[0];
        if (touch) {
          var dx = Math.abs(touch.clientX - pendingTouchStart.x);
          var dy = Math.abs(touch.clientY - pendingTouchStart.y);
          if (dx > TOUCH_END_MAX_OFFSET || dy > TOUCH_END_MAX_OFFSET) {
            clearPendingTouchKeyboard();
            return;
          }
        }
        var elapsed = Date.now() - pendingTouchStart.at;
        clearPendingTouchKeyboard();
        if (elapsed > 450) return;
        if (event.cancelable) {
          event.preventDefault();
        }
        event.stopPropagation();
        postFocusRequest();
      });
      terminalRoot.addEventListener('mousedown', focusTerminal);

      // Initial fit + resize observer
      setTimeout(function() {
        fitAddon.fit();
        term.refresh(0, term.rows - 1);
        announceRendered();
      }, 100);
      window.addEventListener('resize', function() { fitAddon.fit(); });

      // Resize → RN
      term.onResize(function(size) {
        postBridgeMessage({
          type: 'resize',
          cols: size.cols,
          rows: size.rows
        });
      });

      function decodeBase64Utf8(payload) {
        try {
          return decodeURIComponent(escape(atob(payload)));
        } catch(e) {
          return atob(payload);
        }
      }

      function postTextInput(data) {
        postBridgeMessage({
          type: 'input',
          encoding: 'text',
          data: data
        });
      }

      function applyTheme(theme) {
        if (!theme) return;
        currentTheme = theme;
        document.documentElement.style.background = theme.background;
        document.body.style.background = theme.background;
        term.options.theme = theme;
      }

      term.onData(postTextInput);

      // RN → WebView: receive terminal output or commands
      window.injectTerminalData = function(type, payload, encoding, focus) {
        try {
          if (type === 'output') {
            var decoded = encoding === 'base64'
              ? decodeBase64Utf8(payload)
              : String(payload || '');
            term.write(decoded);
          } else if (type === 'setsize') {
            var size = JSON.parse(payload);
            if (size.cols && size.rows) {
              term.resize(size.cols, size.rows);
              fitAddon.fit();
            }
          } else if (type === 'input') {
            var input = encoding === 'base64'
              ? decodeBase64Utf8(payload)
              : String(payload || '');
            if (focus !== false) term.focus();
            postTextInput(input);
          } else if (type === 'focus') {
            term.focus();
          } else if (type === 'fit') {
            fitAddon.fit();
            configureHelperTextarea();
          } else if (type === 'theme') {
            applyTheme(JSON.parse(payload));
          } else if (type === 'clear') {
            term.clear();
            term.reset();
          } else if (type === 'bell') {
            // visual bell handled by xterm
          }
        } catch(e) {
          // silently ignore parse errors
        }
      };

      // Notify RN that terminal is ready
      postBridgeMessage({
        type: 'ready',
        cols: term.cols,
        rows: term.rows
      });
      } catch(e) {
        postBridgeMessage({
          type: 'error',
          message: e && e.message ? e.message : String(e)
        });
      }
    })();
  </script>
</body>
</html>`;
}
