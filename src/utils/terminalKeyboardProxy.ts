import { terminalNativeKeySequences } from './terminalKeySequences';

export const TERMINAL_KEYBOARD_PROXY_VALUE = '\u200b';
export const TERMINAL_KEYBOARD_PROXY_SELECTION = {
  start: TERMINAL_KEYBOARD_PROXY_VALUE.length,
  end: TERMINAL_KEYBOARD_PROXY_VALUE.length,
};
export const TERMINAL_KEYBOARD_PROXY_DUPLICATE_WINDOW_MS = 80;

// settle \u5f52\u4f4d\u4e0a\u9650(2026-10-24 \u8fde\u7eed\u76f8\u540c\u5b57\u7b26\u88ab\u541e RCA):\u9010\u952e setNativeProps
// \u5f52\u4f4d\u54e8\u5175\u540e,\u300c\u91cd\u7f6e\u540e\u65b0\u6572\u7684\u540c\u6587\u672c\u300d\u4e0e stale-echo \u65e7\u6587\u672c\u9010\u5b57\u8282\u76f8\u7b49,\u4f1a\u88ab
// resetNativeValue \u5b88\u536b\u8bef\u6740 \u2014\u2014 ll/ss/oo \u7b49\u8fde\u7eed\u76f8\u540c\u5b57\u7b26\u4ece\u7b2c\u4e8c\u4e2a\u8d77\u5168\u88ab\u541e\u3002
// \u4fee\u590d = \u539f\u751f\u6587\u672c\u7d2f\u79ef\u3001\u589e\u91cf\u8d70\u65e2\u6709 startsWith \u540e\u7f00\u6bd4\u5bf9;\u5f52\u4f4d\u53ea\u5728\u7d2f\u8ba1\u53ef\u89c1
// \u6587\u672c\u8d85\u8fc7\u4e0a\u9650\u65f6\u505a\u4e00\u6b21\u536b\u751f\u91cd\u7f6e(\u9632\u9690\u85cf\u6846\u65e0\u9650\u589e\u957f),focus/\u5207\u4f1a\u8bdd\u4ecd\u65e0\u6761\u4ef6
// \u91cd\u7f6e\u3002\u4e0a\u9650\u5185 setNativeProps \u662f\u7eaf\u6865\u63a5\u7a7a\u8f6c + \u8bef\u6740\u6e90,\u4e00\u5f8b\u8df3\u8fc7\u3002
export const TERMINAL_KEYBOARD_PROXY_ACCUMULATE_LIMIT = 128;

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
 * settle 是否需要跨桥重置隐藏 TextInput(2026-10-24 累积化改造):原生文本
 * 在上限内累积、不做逐键归位(逐键归位是纯桥接开销,且会让「重置后新敲的
 * 同文本」撞上 resetNativeValue stale-echo 守卫被误杀 —— 连续相同字符被吞
 * RCA);只有累计可见文本超过 TERMINAL_KEYBOARD_PROXY_ACCUMULATE_LIMIT 时
 * 才做一次卫生重置。focus/切会话等边界走 resetTerminalKeyboardProxyInput
 * 无条件归位,不经此闸。
 */
export function terminalKeyboardProxyNeedsNativeReset(
  state: TerminalKeyboardProxyState,
): boolean {
  return (
    terminalKeyboardProxyVisibleInput(state.nativeValue).length >
    TERMINAL_KEYBOARD_PROXY_ACCUMULATE_LIMIT
  );
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
