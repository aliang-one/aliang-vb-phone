import {
  getTerminalHtml,
  getTerminalThemePalette,
} from '../src/components/terminal/terminalHtml';

describe('terminalHtml', () => {
  it('builds terminal theme palettes for light and dark mode', () => {
    expect(getTerminalThemePalette(true)).toMatchObject({
      background: '#0d1117',
      foreground: '#e6edf3',
      cursor: '#58a6ff',
    });
    expect(getTerminalThemePalette(false)).toMatchObject({
      background: '#ffffff',
      foreground: '#1f2328',
      cursor: '#0969da',
    });
  });

  it('keeps xterm as the writable terminal input source', () => {
    const html = getTerminalHtml(true);

    expect(html).not.toContain('cdn.jsdelivr');
    expect(html).not.toContain('<script src=');
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).toContain('classList.add("xterm-helpers")');
    expect(html).toContain('FitAddon');
    expect(html).toContain('disableStdin: false');
    expect(html).toContain('term.onData(postTextInput)');
    expect(html).toContain("encoding: 'text'");
    expect(html).toContain('if (focus !== false) term.focus()');
    expect(html).toContain('var currentTheme =');
    expect(html).toContain('function applyTheme(theme)');
    expect(html).toContain('term.options.theme = theme');
    expect(html).toContain("} else if (type === 'theme') {");
    expect(html).toContain('#terminal-root { width: 100%; height: 100%');
    expect(html).toContain("} else if (type === 'fit') {");
    expect(html).toContain('fitAddon.fit()');
    expect(html).toContain("type: 'focusrequest'");
    expect(html).toContain(
      "terminalRoot.addEventListener('touchstart', requestNativeKeyboard",
    );
    expect(html).toContain(
      "terminalRoot.addEventListener('touchmove', cancelNativeKeyboardForGesture",
    );
    expect(html).toContain(
      "terminalRoot.addEventListener('touchcancel', clearPendingTouchKeyboard",
    );
    expect(html).toContain("terminalRoot.addEventListener('touchend', function(event)");
    expect(html).toContain('at: Date.now()');
    expect(html).toContain('var TOUCH_END_MAX_OFFSET = 8');
    expect(html).toContain('event.changedTouches && event.changedTouches[0]');
    expect(html).toContain('dx > TOUCH_END_MAX_OFFSET');
    expect(html).toContain('dy > TOUCH_END_MAX_OFFSET');
    expect(html).toContain('if (elapsed > 450) return');
    expect(html).toContain('event.preventDefault()');
    expect(html).toContain('event.stopPropagation()');
    expect(html).toContain('postFocusRequest()');
    expect(html).toContain("terminalRoot.addEventListener('mousedown', focusTerminal)");
    expect(html).toContain("type: 'rendered'");
    expect(html).toContain('term.onRender(function()');
    expect(html.indexOf('term.onRender(function()')).toBeLessThan(
      html.indexOf('term.open(terminalRoot)'),
    );
    expect(html).toContain('term.refresh(0, term.rows - 1)');
    expect(html).toContain('announceRendered()');
  });

  it('does not send mobile keyboard input through the binary/base64 path', () => {
    const html = getTerminalHtml(false);

    expect(html).not.toContain('term.onBinary');
    expect(html).not.toContain("type: 'binary'");
    expect(html).not.toContain('encodeBase64Utf8');
  });
});
