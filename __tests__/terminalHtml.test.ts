import { getTerminalHtml } from '../src/components/terminal/terminalHtml';

describe('terminalHtml', () => {
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
