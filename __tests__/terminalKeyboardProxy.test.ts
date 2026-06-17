import {
  createTerminalKeyboardProxyState,
  markTerminalKeyboardProxyInputReset,
  resetTerminalKeyboardProxyInput,
  TERMINAL_KEYBOARD_PROXY_SELECTION,
  TERMINAL_KEYBOARD_PROXY_VALUE,
  terminalKeyboardProxyChangeAction,
  terminalKeyboardProxyKeyAction,
  terminalKeyboardProxyInputFromText,
} from '../src/utils/terminalKeyboardProxy';

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

  it('ignores non-terminal keypress values', () => {
    const state = createTerminalKeyboardProxyState();

    expect(terminalKeyboardProxyKeyAction(state, 'Shift', 1000)).toEqual({
      input: '',
      state,
    });
  });

  it('resets the hidden native input after each keystroke', () => {
    const input = { setNativeProps: jest.fn() };

    resetTerminalKeyboardProxyInput(input);

    expect(input.setNativeProps).toHaveBeenCalledWith({
      text: TERMINAL_KEYBOARD_PROXY_VALUE,
      selection: TERMINAL_KEYBOARD_PROXY_SELECTION,
    });
  });
});
