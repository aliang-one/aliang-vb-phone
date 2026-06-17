export const TERMINAL_KEYBOARD_PROXY_VALUE = '\u200b';
export const TERMINAL_KEYBOARD_PROXY_SELECTION = {
  start: TERMINAL_KEYBOARD_PROXY_VALUE.length,
  end: TERMINAL_KEYBOARD_PROXY_VALUE.length,
};
export const TERMINAL_KEYBOARD_PROXY_DUPLICATE_WINDOW_MS = 80;

export type TerminalKeyboardProxyInputSource = 'change' | 'key';

export interface TerminalKeyboardProxyLastInput {
  input: string;
  at: number;
  source: TerminalKeyboardProxyInputSource;
}

export interface TerminalKeyboardProxyState {
  nativeValue: string;
  resetNativeValue: string | null;
  suppressedInput: string | null;
  lastInput: TerminalKeyboardProxyLastInput;
}

export interface TerminalKeyboardProxyAction {
  input: string;
  state: TerminalKeyboardProxyState;
}

interface TerminalKeyboardProxyNativeInput {
  setNativeProps: (props: {
    text: string;
    selection: typeof TERMINAL_KEYBOARD_PROXY_SELECTION;
  }) => void;
}

export function terminalKeyboardProxyInputFromText(value: string): string {
  if (value === TERMINAL_KEYBOARD_PROXY_VALUE) return '';
  if (!value) return '\x7f';

  return terminalKeyboardProxyVisibleInput(value);
}

function terminalKeyboardProxyVisibleInput(value: string): string {
  return value
    .split(TERMINAL_KEYBOARD_PROXY_VALUE)
    .join('')
    .replace(/\n/g, '\r');
}

function terminalKeyboardProxyInputDelta(
  state: TerminalKeyboardProxyState,
  value: string,
): string {
  if (value === TERMINAL_KEYBOARD_PROXY_VALUE) return '';
  if (!value) return '\x7f';

  if (state.resetNativeValue !== null) {
    if (value === state.resetNativeValue) return '';
    if (value.startsWith(state.resetNativeValue)) {
      return terminalKeyboardProxyVisibleInput(
        value.slice(state.resetNativeValue.length),
      );
    }
  }

  const previousValue = state.nativeValue;
  const previousInput = terminalKeyboardProxyVisibleInput(previousValue);
  const currentInput = terminalKeyboardProxyVisibleInput(value);

  if (!currentInput) {
    return previousInput ? '\x7f' : '';
  }
  if (value.startsWith(previousValue)) {
    return terminalKeyboardProxyVisibleInput(value.slice(previousValue.length));
  }
  if (
    previousInput &&
    currentInput.startsWith(previousInput) &&
    currentInput.length > previousInput.length
  ) {
    return currentInput.slice(previousInput.length);
  }
  if (previousInput && currentInput.length < previousInput.length) {
    return '\x7f';
  }

  return currentInput;
}

export function createTerminalKeyboardProxyState(): TerminalKeyboardProxyState {
  return {
    nativeValue: TERMINAL_KEYBOARD_PROXY_VALUE,
    resetNativeValue: null,
    suppressedInput: null,
    lastInput: { input: '', at: 0, source: 'change' },
  };
}

export function terminalKeyboardProxyChangeAction(
  state: TerminalKeyboardProxyState,
  value: string,
  now = Date.now(),
): TerminalKeyboardProxyAction {
  const input = terminalKeyboardProxyInputDelta(state, value);
  if (state.suppressedInput && input === state.suppressedInput) {
    return {
      input: '',
      state: {
        ...state,
        nativeValue: value,
        resetNativeValue: null,
        suppressedInput: null,
      },
    };
  }

  return {
    input,
    state: {
      nativeValue: value,
      resetNativeValue: null,
      suppressedInput: null,
      lastInput: input
        ? { input, at: now, source: 'change' }
        : state.lastInput,
    },
  };
}

export function terminalKeyboardProxyKeyAction(
  state: TerminalKeyboardProxyState,
  key: string,
  now = Date.now(),
  duplicateWindowMs = TERMINAL_KEYBOARD_PROXY_DUPLICATE_WINDOW_MS,
): TerminalKeyboardProxyAction {
  const input = terminalKeyboardProxyInputFromKey(key);
  if (!input) {
    return { input: '', state };
  }

  const duplicateFromChange =
    state.lastInput.source === 'change' &&
    state.lastInput.input === input &&
    now - state.lastInput.at < duplicateWindowMs;
  if (duplicateFromChange) {
    return { input: '', state };
  }

  return {
    input,
    state: {
      ...state,
      suppressedInput: input,
      lastInput: { input, at: now, source: 'key' },
    },
  };
}

function terminalKeyboardProxyInputFromKey(key: string): string {
  if (key === 'Enter') return '\r';
  if (key === 'Backspace') return '\x7f';
  return '';
}

export function resetTerminalKeyboardProxyInput(
  input: TerminalKeyboardProxyNativeInput | null | undefined,
) {
  input?.setNativeProps({
    text: TERMINAL_KEYBOARD_PROXY_VALUE,
    selection: TERMINAL_KEYBOARD_PROXY_SELECTION,
  });
}

export function markTerminalKeyboardProxyInputReset(
  state: TerminalKeyboardProxyState,
): TerminalKeyboardProxyState {
  return {
    ...state,
    nativeValue: TERMINAL_KEYBOARD_PROXY_VALUE,
    resetNativeValue:
      state.nativeValue === TERMINAL_KEYBOARD_PROXY_VALUE
        ? state.resetNativeValue
        : state.nativeValue,
  };
}
