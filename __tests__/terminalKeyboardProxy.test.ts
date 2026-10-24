import {
  createTerminalKeyboardProxyState,
  markTerminalKeyboardProxyInputReset,
  resetTerminalKeyboardProxyInput,
  TERMINAL_KEYBOARD_PROXY_ACCUMULATE_LIMIT,
  TERMINAL_KEYBOARD_PROXY_SELECTION,
  TERMINAL_KEYBOARD_PROXY_VALUE,
  terminalKeyboardProxyChangeAction,
  terminalKeyboardProxyKeyAction,
  terminalKeyboardProxyInputFromText,
  terminalKeyboardProxyNeedsNativeReset,
} from '../src/utils/terminalKeyboardProxy';

// 屏幕侧完整节拍(change → 若有 delta 则发送 → settle 按 needsNativeReset
// 决定是否 setNativeProps 归位)的忠实模拟 —— 键盘代理的缺陷只有在这个
// 节拍下才会暴露,纯函数单测看不到。
const typeChange = (
  state: ReturnType<typeof createTerminalKeyboardProxyState>,
  nativeText: string,
  now = 1000,
) => {
  const action = terminalKeyboardProxyChangeAction(state, nativeText, now);
  let settled = action.state;
  if (terminalKeyboardProxyNeedsNativeReset(settled)) {
    settled = markTerminalKeyboardProxyInputReset(settled);
  }
  return { sent: action.input, state: settled };
};

describe('terminalKeyboardProxy', () => {
  it('keeps the sentinel value out of terminal input', () => {
    expect(terminalKeyboardProxyInputFromText(TERMINAL_KEYBOARD_PROXY_VALUE)).toBe(
      '',
    );
    expect(
      terminalKeyboardProxyInputFromText(`${TERMINAL_KEYBOARD_PROXY_VALUE}pwd`),
    ).toBe('pwd');
  });

  it('maps soft keyboard deletion and return to terminal bytes', () => {
    expect(terminalKeyboardProxyInputFromText('')).toBe('\x7f');
    expect(
      terminalKeyboardProxyInputFromText(`${TERMINAL_KEYBOARD_PROXY_VALUE}\n`),
    ).toBe('\r');
  });

  it('depends on resetting native input so continuous typing sends only deltas', () => {
    expect(
      ['a', 'b', 'c']
        .map(value =>
          terminalKeyboardProxyInputFromText(
            `${TERMINAL_KEYBOARD_PROXY_VALUE}${value}`,
          ),
        )
        .join(''),
    ).toBe('abc');
  });

  it('passes through multi-character keyboard deltas without encoding them', () => {
    expect(
      terminalKeyboardProxyInputFromText(`${TERMINAL_KEYBOARD_PROXY_VALUE}pwd`),
    ).toBe('pwd');
    expect(
      terminalKeyboardProxyInputFromText(
        `${TERMINAL_KEYBOARD_PROXY_VALUE}echo ok`,
      ),
    ).toBe('echo ok');
  });

  it('normalizes pasted newline variants to single terminal returns', () => {
    expect(
      terminalKeyboardProxyInputFromText(
        `${TERMINAL_KEYBOARD_PROXY_VALUE}echo one\r\necho two`,
      ),
    ).toBe('echo one\recho two');
    expect(
      terminalKeyboardProxyInputFromText(
        `${TERMINAL_KEYBOARD_PROXY_VALUE}echo one\recho two`,
      ),
    ).toBe('echo one\recho two');
  });

  it('ignores sentinel-only native text changes during keyboard resets', () => {
    const state = createTerminalKeyboardProxyState();

    const action = terminalKeyboardProxyChangeAction(
      state,
      TERMINAL_KEYBOARD_PROXY_VALUE,
      1000,
    );

    expect(action.input).toBe('');
    expect(action.state).toEqual(state);
  });

  it('emits text deltas from the hidden keyboard proxy state machine', () => {
    let state = createTerminalKeyboardProxyState();

    const first = terminalKeyboardProxyChangeAction(
      state,
      `${TERMINAL_KEYBOARD_PROXY_VALUE}a`,
      1000,
    );
    state = first.state;
    const second = terminalKeyboardProxyChangeAction(
      state,
      `${TERMINAL_KEYBOARD_PROXY_VALUE}b`,
      1001,
    );

    expect(first.input).toBe('a');
    expect(second.input).toBe('b');
    expect(second.state.lastInput).toMatchObject({
      input: 'b',
      source: 'change',
    });
  });

  it('uses native value deltas when iOS batches text before the reset lands', () => {
    let state = createTerminalKeyboardProxyState();

    const first = terminalKeyboardProxyChangeAction(
      state,
      `${TERMINAL_KEYBOARD_PROXY_VALUE}a`,
      1000,
    );
    state = first.state;
    const second = terminalKeyboardProxyChangeAction(
      state,
      `${TERMINAL_KEYBOARD_PROXY_VALUE}ab`,
      1001,
    );

    expect(first.input).toBe('a');
    expect(second.input).toBe('b');
  });

  it('uses the pre-reset native value when iOS applies the reset late', () => {
    let state = createTerminalKeyboardProxyState();

    const first = terminalKeyboardProxyChangeAction(
      state,
      `${TERMINAL_KEYBOARD_PROXY_VALUE}a`,
      1000,
    );
    state = markTerminalKeyboardProxyInputReset(first.state);
    const second = terminalKeyboardProxyChangeAction(
      state,
      `${TERMINAL_KEYBOARD_PROXY_VALUE}ab`,
      1001,
    );

    expect(first.input).toBe('a');
    expect(second.input).toBe('b');
  });

  it('treats sentinel-prefixed input as fresh text after native reset completes', () => {
    let state = createTerminalKeyboardProxyState();

    const typed = terminalKeyboardProxyChangeAction(
      state,
      `${TERMINAL_KEYBOARD_PROXY_VALUE}ab`,
      1000,
    );
    state = markTerminalKeyboardProxyInputReset(typed.state);
    const resetNotification = terminalKeyboardProxyChangeAction(
      state,
      TERMINAL_KEYBOARD_PROXY_VALUE,
      1001,
    );
    const next = terminalKeyboardProxyChangeAction(
      resetNotification.state,
      `${TERMINAL_KEYBOARD_PROXY_VALUE}c`,
      1002,
    );

    expect(typed.input).toBe('ab');
    expect(resetNotification.input).toBe('');
    expect(next.input).toBe('c');
  });

  it('turns native value shrinkage into one terminal backspace', () => {
    let state = createTerminalKeyboardProxyState();

    const typed = terminalKeyboardProxyChangeAction(
      state,
      `${TERMINAL_KEYBOARD_PROXY_VALUE}ab`,
      1000,
    );
    state = typed.state;
    const deleted = terminalKeyboardProxyChangeAction(
      state,
      `${TERMINAL_KEYBOARD_PROXY_VALUE}a`,
      1001,
    );

    expect(typed.input).toBe('ab');
    expect(deleted.input).toBe('\x7f');
  });

  it('deduplicates enter and backspace when keypress follows text change', () => {
    let state = createTerminalKeyboardProxyState();

    const enterChange = terminalKeyboardProxyChangeAction(
      state,
      `${TERMINAL_KEYBOARD_PROXY_VALUE}\n`,
      1000,
    );
    state = enterChange.state;
    const duplicateEnter = terminalKeyboardProxyKeyAction(state, 'Enter', 1005);

    expect(enterChange.input).toBe('\r');
    expect(duplicateEnter.input).toBe('');

    const deleteChange = terminalKeyboardProxyChangeAction(
      duplicateEnter.state,
      '',
      1100,
    );
    state = deleteChange.state;
    const duplicateDelete = terminalKeyboardProxyKeyAction(
      state,
      'Backspace',
      1105,
    );

    expect(deleteChange.input).toBe('\x7f');
    expect(duplicateDelete.input).toBe('');
  });

  it('does not swallow repeated backspace keypresses', () => {
    let state = createTerminalKeyboardProxyState();

    const first = terminalKeyboardProxyKeyAction(state, 'Backspace', 1000);
    state = first.state;
    const second = terminalKeyboardProxyKeyAction(state, 'Backspace', 1005);
    state = second.state;
    const suppressedChange = terminalKeyboardProxyChangeAction(state, '', 1006);

    expect(first.input).toBe('\x7f');
    expect(second.input).toBe('\x7f');
    expect(suppressedChange.input).toBe('');
    expect(suppressedChange.state.suppressedInput).toBeNull();
  });

  it('maps terminal control keypresses to escape sequences', () => {
    const state = createTerminalKeyboardProxyState();

    expect(terminalKeyboardProxyKeyAction(state, 'Tab', 1000).input).toBe('\t');
    expect(terminalKeyboardProxyKeyAction(state, 'Escape', 1000).input).toBe(
      '\x1b',
    );
    expect(terminalKeyboardProxyKeyAction(state, 'ArrowUp', 1000).input).toBe(
      '\x1b[A',
    );
    expect(terminalKeyboardProxyKeyAction(state, 'ArrowDown', 1000).input).toBe(
      '\x1b[B',
    );
    expect(terminalKeyboardProxyKeyAction(state, 'ArrowRight', 1000).input).toBe(
      '\x1b[C',
    );
    expect(terminalKeyboardProxyKeyAction(state, 'ArrowLeft', 1000).input).toBe(
      '\x1b[D',
    );
    expect(terminalKeyboardProxyKeyAction(state, 'Delete', 1000).input).toBe(
      '\x1b[3~',
    );
    expect(terminalKeyboardProxyKeyAction(state, 'Home', 1000).input).toBe(
      '\x1b[H',
    );
    expect(terminalKeyboardProxyKeyAction(state, 'End', 1000).input).toBe(
      '\x1b[F',
    );
    expect(terminalKeyboardProxyKeyAction(state, 'PageUp', 1000).input).toBe(
      '\x1b[5~',
    );
    expect(terminalKeyboardProxyKeyAction(state, 'PageDown', 1000).input).toBe(
      '\x1b[6~',
    );
    expect(terminalKeyboardProxyKeyAction(state, 'l', 1000).input).toBe('');
  });

  it('ignores non-terminal keypress values', () => {
    const state = createTerminalKeyboardProxyState();

    expect(terminalKeyboardProxyKeyAction(state, 'Shift', 1000)).toEqual({
      input: '',
      state,
    });
  });

  it('resets the hidden native input with sentinel + pinned caret at reset points', () => {
    const input = { setNativeProps: jest.fn() };

    resetTerminalKeyboardProxyInput(input);

    expect(input.setNativeProps).toHaveBeenCalledWith({
      text: TERMINAL_KEYBOARD_PROXY_VALUE,
      selection: TERMINAL_KEYBOARD_PROXY_SELECTION,
    });
  });

  // 2026-10-24 RCA:逐键 setNativeProps 归位哨兵后,「重置后新敲的同文本」
  // 与 stale-echo 旧文本逐字节相等,被 resetNativeValue 守卫误杀 —— 连续
  // 相同字符(ll/ss/oo/双空格)从第二个起全被吞。修复 = settle 不再逐键
  // 重置,文本累积、增量走既有后缀比对,只在超限/focus/切会话时重置。
  describe('accumulate flow (settle 不再逐键重置)', () => {
    it('sends both l for fast "ll" typing', () => {
      let state = createTerminalKeyboardProxyState();

      const k1 = typeChange(state, `${TERMINAL_KEYBOARD_PROXY_VALUE}l`);
      expect(k1.sent).toBe('l');
      state = k1.state;

      const k2 = typeChange(state, `${TERMINAL_KEYBOARD_PROXY_VALUE}ll`);
      expect(k2.sent).toBe('l');
    });

    it('keeps non-identical and mixed sequences intact', () => {
      let state = createTerminalKeyboardProxyState();
      const keys = ['l', 's', ' ', '-', 'l', 'a'];
      let sent = '';
      keys.forEach((_key, index) => {
        const typed = `${TERMINAL_KEYBOARD_PROXY_VALUE}${keys.slice(0, index + 1).join('')}`;
        const result = typeChange(state, typed, 1000 + index);
        sent += result.sent;
        state = result.state;
      });
      expect(sent).toBe('ls -la');
    });

    it('still maps shrinkage to backspace and enter through the change path', () => {
      let state = createTerminalKeyboardProxyState();

      const typed = typeChange(state, `${TERMINAL_KEYBOARD_PROXY_VALUE}ab`);
      expect(typed.sent).toBe('ab');
      state = typed.state;

      const deleted = typeChange(state, `${TERMINAL_KEYBOARD_PROXY_VALUE}a`);
      expect(deleted.sent).toBe('\x7f');
    });
  });
});

// settle 重置闸(2026-10-24 累积化改造):逐键重置会让「重置后新敲的同文本」
// 撞上 stale-echo 守卫被误杀(连续相同字符被吞 RCA),且每次都是纯桥接开销。
// 归位只在累计可见文本超限时做一次卫生重置;focus/切会话仍走无条件重置。
describe('terminalKeyboardProxyNeedsNativeReset', () => {
  it('is false while the proxy holds the sentinel value', () => {
    expect(
      terminalKeyboardProxyNeedsNativeReset(createTerminalKeyboardProxyState()),
    ).toBe(false);
  });

  it('is false for ordinary typing within the accumulate limit', () => {
    let state = createTerminalKeyboardProxyState();
    for (let i = 0; i < TERMINAL_KEYBOARD_PROXY_ACCUMULATE_LIMIT; i += 1) {
      const action = terminalKeyboardProxyChangeAction(
        state,
        `${TERMINAL_KEYBOARD_PROXY_VALUE}${'x'.repeat(i + 1)}`,
        1000 + i,
      );
      state = action.state;
      expect(terminalKeyboardProxyNeedsNativeReset(state)).toBe(false);
    }
  });

  it('is true once visible text exceeds the accumulate limit, and reset clears it', () => {
    const long = 'x'.repeat(TERMINAL_KEYBOARD_PROXY_ACCUMULATE_LIMIT + 1);
    const action = terminalKeyboardProxyChangeAction(
      createTerminalKeyboardProxyState(),
      `${TERMINAL_KEYBOARD_PROXY_VALUE}${long}`,
    );

    expect(terminalKeyboardProxyNeedsNativeReset(action.state)).toBe(true);
    expect(
      terminalKeyboardProxyNeedsNativeReset(
        markTerminalKeyboardProxyInputReset(action.state),
      ),
    ).toBe(false);
  });

  it('swallows the stale echo after a limit reset but not fresh typing', () => {
    const long = 'y'.repeat(TERMINAL_KEYBOARD_PROXY_ACCUMULATE_LIMIT + 2);
    let state = createTerminalKeyboardProxyState();

    const typed = typeChange(state, `${TERMINAL_KEYBOARD_PROXY_VALUE}${long}`);
    expect(typed.sent).toBe(long);
    state = typed.state; // 超限,settle 已归位(resetNativeValue=旧长文本)

    const staleEcho = typeChange(
      state,
      `${TERMINAL_KEYBOARD_PROXY_VALUE}${long}`,
      2000,
    );
    expect(staleEcho.sent).toBe('');

    const fresh = typeChange(state, `${TERMINAL_KEYBOARD_PROXY_VALUE}l`, 2001);
    expect(fresh.sent).toBe('l');
  });

  it('is false for special-key presses that never dirty the native input', () => {
    const action = terminalKeyboardProxyKeyAction(
      createTerminalKeyboardProxyState(),
      'Enter',
    );

    expect(action.input).toBe('\r');
    expect(terminalKeyboardProxyNeedsNativeReset(action.state)).toBe(false);
  });

  it('is false when a change already carries the sentinel back', () => {
    const action = terminalKeyboardProxyChangeAction(
      createTerminalKeyboardProxyState(),
      TERMINAL_KEYBOARD_PROXY_VALUE,
    );

    expect(terminalKeyboardProxyNeedsNativeReset(action.state)).toBe(false);
  });
});
