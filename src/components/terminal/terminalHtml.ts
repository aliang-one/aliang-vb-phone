/**
 * Inline HTML for the xterm.js terminal emulator loaded inside a WebView.
 *
 * Communication bridge:
 *   WebView → RN:  window.ReactNativeWebView.postMessage(JSON)
 *   RN → WebView:  window.injectTerminalData(type, payload)
 */

export function getTerminalHtml(isDark: boolean): string {
  const bgColor = isDark ? '#0d1117' : '#ffffff';
  const fgColor = isDark ? '#e6edf3' : '#1f2328';
  const cursorColor = isDark ? '#58a6ff' : '#0969da';
  const selectionBg = isDark ? 'rgba(88,166,255,0.25)' : 'rgba(9,105,218,0.25)';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: ${bgColor}; }
    #terminal-container { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="terminal-container"></div>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5/lib/xterm.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0/lib/addon-fit.js"></script>
  <script>
    (function() {
      var term = new Terminal({
        theme: {
          background: '${bgColor}',
          foreground: '${fgColor}',
          cursor: '${cursorColor}',
          selectionBackground: '${selectionBg}',
          selectionForeground: '${fgColor}',
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
          brightWhite: '#f0f6fc'
        },
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.15,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 5000,
        allowProposedApi: true,
        allowTransparency: false,
        drawBoldTextInBrightColors: true,
        convertEol: false
      });

      var fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);

      var container = document.getElementById('terminal-container');
      term.open(container);

      // Initial fit + resize observer
      setTimeout(function() { fitAddon.fit(); }, 100);
      window.addEventListener('resize', function() { fitAddon.fit(); });

      // Keyboard input → RN
      term.onData(function(data) {
        var encoded;
        try {
          encoded = btoa(unescape(encodeURIComponent(data)));
        } catch(e) {
          encoded = btoa(data);
        }
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'input',
          data: encoded
        }));
      });

      // Binary input (paste, etc) → RN
      term.onBinary(function(data) {
        var encoded = btoa(data);
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'binary',
          data: encoded
        }));
      });

      // Resize → RN
      term.onResize(function(size) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'resize',
          cols: size.cols,
          rows: size.rows
        }));
      });

      // RN → WebView: receive terminal output or commands
      window.injectTerminalData = function(type, payload) {
        try {
          if (type === 'output') {
            var decoded;
            try {
              decoded = decodeURIComponent(escape(atob(payload)));
            } catch(e) {
              decoded = atob(payload);
            }
            term.write(decoded);
          } else if (type === 'setsize') {
            var size = JSON.parse(payload);
            if (size.cols && size.rows) {
              term.resize(size.cols, size.rows);
              fitAddon.fit();
            }
          } else if (type === 'clear') {
            term.clear();
            term.reset();
          } else if (type === 'focus') {
            term.focus();
          } else if (type === 'bell') {
            // visual bell handled by xterm
          }
        } catch(e) {
          // silently ignore parse errors
        }
      };

      // Notify RN that terminal is ready
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'ready',
        cols: term.cols,
        rows: term.rows
      }));
    })();
  </script>
</body>
</html>`;
}
