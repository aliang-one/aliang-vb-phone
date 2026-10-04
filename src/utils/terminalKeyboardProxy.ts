import { terminalNativeKeySequences } from './terminalKeySequences';

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
  return terminalKeyboardProxyNormalizeNewlines(
    value.split(TERMINAL_KEYBOARD_PROXY_VALUE).join(''),
  );
}

function terminalKeyboardProxyNormalizeNewlines(value: string): string {
  return value.replace(/\r\n?|\n/g, '\r');
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
  return terminalNativeKeySequences[key] ?? '';
}

export function resetTerminalKeyboardProxyInput(
  input: TerminalKeyboardProxyNativeInput | null | undefined,
) {
  input?.setNativeProps({
    text: TERMINAL_KEYBOARD_PROXY_VALUE,
    selection: TERMINAL_KEYBOARD_PROXY_SELECTION,
  });
}

/**
 * 是否需要跨桥重置隐藏 TextInput(2026-10 终端卡顿修复):原生值仍是哨兵时
 * (方向键/Enter 等不产生文本的按键),重置是纯桥接空转,应跳过。判据取状态
 * 里跟踪的原生值 —— 它由 change 事件写入、由 markTerminalKeyboardProxyInputReset
 * 归位;任何真实文本变动都会产生 change 事件,由该路径兜底归位。
 */
export function terminalKeyboardProxyNeedsNativeReset(
  state: TerminalKeyboardProxyState,
): boolean {
  return state.nativeValue !== TERMINAL_KEYBOARD_PROXY_VALUE;
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
