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

  it('injectTerminalData 支持 follow/unfollow 分支(字号钳制与恢复)', () => {
    const html = getTerminalHtml(true);

    expect(html).toContain("} else if (type === 'follow') {");
    expect(html).toContain("} else if (type === 'unfollow') {");
    // 字号钳制:8px 保底、13px 上限(钉住本分支字面量——xterm bundle 自带 Math.max)
    expect(html).toContain('Math.max(8, Math.min(13, scaled))');
    // 横滚兜底:8px 仍塞不下时给 xterm 元素设 minWidth
    expect(html).toContain('term.element().style.minWidth');
    // 跟随态下 window resize 跳过 fit(防半跟随),unfollow 再恢复
    expect(html).toContain('if (followState.active) return');
    expect(html).toContain('followState.active = false');
    // unfollow 字号还原语句(13 兜底,防 prevFontSize 未写过)
    expect(html).toContain('followState.prevFontSize || 13');
  });

  // rider(Task 13 质量审查):fit 分支 follow 感知——跟随态先还原(unfollow
  // 主体)再 fit,否则缩小字号下 fit 用 8px 反算出假几何(390px ≈ 80 列而非
  // 13px 的 ~50 列)。钉「if (followState.active) 落在 fit 分支内、且先于 fit()」。
  it('fit 分支在跟随态先还原再 fit(钉 follow 感知)', () => {
    const html = getTerminalHtml(true);
    const fitBranchStart = html.indexOf("} else if (type === 'fit') {");
    expect(fitBranchStart).toBeGreaterThanOrEqual(0);
    const fitBranch = html.slice(fitBranchStart);

    expect(fitBranch).toContain('if (followState.active)');
    // 还原必须发生在 fit() 之前(顺序即语义:先恢复 13px 字号再量几何)。
    expect(fitBranch.indexOf('if (followState.active)')).toBeLessThan(
      fitBranch.indexOf('fitAddon.fit()'),
    );
  });

  // Issue 1(质量审查,桥侧闸):100ms 启动 fit 无 follow 防护会让先落地的
  // follow 被缩字号反算的假几何 resize 回报自毁 —— active 时不得 fit。另钉
  // 还原体提取(Minor 1):unfollow 主体与 fit 分支共用 restoreFromFollow。
  it('启动 fit 带 follow 防护;还原体提取为 restoreFromFollow 两分支共用', () => {
    const html = getTerminalHtml(true);

    const startupGuard = html.indexOf('if (!followState.active) {');
    expect(startupGuard).toBeGreaterThanOrEqual(0);
    const startupBlock = html.slice(
      startupGuard,
      html.indexOf('term.refresh(0, term.rows - 1)'),
    );

    // 浏览器优先的入口握手(2026-10-27):启动 fit 后若网格未变(onResize
    // 不会触发,典型是 WebView 默认 80×24),手动补报一条 resize,服务端才
    // 知道本机几何;follow 防护仍在,active 时整块跳过。
    expect(startupBlock).toContain('fitAddon.fit()');
    expect(startupBlock).toContain('var beforeCols = term.cols;');
    expect(startupBlock).toContain('var beforeRows = term.rows;');
    expect(startupBlock).toContain(
      'term.cols === beforeCols && term.rows === beforeRows',
    );
    expect(startupBlock).toContain("type: 'resize'");
    expect(html).toContain('function restoreFromFollow()');

    const unfollowBranch = html.slice(
      html.indexOf("} else if (type === 'unfollow') {"),
      html.indexOf("} else if (type === 'input') {"),
    );
    expect(unfollowBranch).toContain('restoreFromFollow();');
    // 还原语句只存在于 restoreFromFollow 体内,分支不再各自复制。
    expect(unfollowBranch).not.toContain('term.options.fontSize =');

    const fitBranch = html.slice(html.indexOf("} else if (type === 'fit') {"));
    expect(fitBranch.indexOf('if (followState.active)')).toBeLessThan(
      fitBranch.indexOf('restoreFromFollow();'),
    );
  });
});
