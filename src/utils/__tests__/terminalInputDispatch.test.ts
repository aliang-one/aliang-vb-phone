import { platformTransport } from '../../services/platformTransport';
import {
  flushPendingTerminalInput,
  sendTerminalInput,
  sendTerminalInputBatched,
  TERMINAL_INPUT_MERGE_MS,
} from '../terminalInputDispatch';

// 直发决策(2026-10 终端回显延迟修复 Stage D):键盘代理在 RN 侧已算出最终
// 输入,WebView 注入→postMessage 回环是纯桥接开销——直发 platformTransport。
// WebView 的 onMessage 'input' 分支保留给 WebView 来源输入(硬件键盘等)。

jest.mock('../../services/platformTransport', () => ({
  platformTransport: { send: jest.fn() },
}));

const sendMock = platformTransport.send as jest.Mock;

beforeEach(() => {
  sendMock.mockClear();
});

describe('sendTerminalInput', () => {
  it('sends terminal.input with text encoding and the attached session id', () => {
    const sent = sendTerminalInput('term_1', 'ls\r');
    expect(sent).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      type: 'terminal.input',
      session_id: 'term_1',
      encoding: 'text',
      data: 'ls\r',
    });
  });

  it('does not send without an attached session', () => {
    expect(sendTerminalInput(null, 'ls')).toBe(false);
    expect(sendTerminalInput(undefined, 'ls')).toBe(false);
    expect(sendTerminalInput('', 'ls')).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does not send empty input', () => {
    expect(sendTerminalInput('term_1', '')).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

// 输入合并(2026-10 终端卡顿修复):键盘代理逐键直发会放大 PTY 回显量。
// 契约:突发首键立即发出(零附加延迟),窗口内后续击键合并为一条 trailing
// 发送;teardown 用 flushPendingTerminalInput 兜底,不丢最后一击。
describe('sendTerminalInputBatched', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sendMock.mockClear();
  });

  afterEach(() => {
    flushPendingTerminalInput();
    jest.useRealTimers();
  });

  it('sends the first keystroke of an idle window immediately', () => {
    expect(sendTerminalInputBatched('term_1', 'l')).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      type: 'terminal.input',
      session_id: 'term_1',
      encoding: 'text',
      data: 'l',
    });
  });

  it('coalesces a keystroke burst into one trailing send', () => {
    sendTerminalInputBatched('term_1', 'l');
    sendTerminalInputBatched('term_1', 's');
    sendTerminalInputBatched('term_1', '\r');

    expect(sendMock).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(TERMINAL_INPUT_MERGE_MS + 5);

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock).toHaveBeenLastCalledWith({
      type: 'terminal.input',
      session_id: 'term_1',
      encoding: 'text',
      data: 's\r',
    });
  });

  it('opens a fresh immediate window after the merge window closes', () => {
    sendTerminalInputBatched('term_1', 'a');
    jest.advanceTimersByTime(TERMINAL_INPUT_MERGE_MS + 5);

    expect(sendTerminalInputBatched('term_1', 'b')).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: 'b' }),
    );
  });

  it('keeps per-session buffers independent', () => {
    sendTerminalInputBatched('term_1', 'a'); // immediate for term_1
    sendTerminalInputBatched('term_1', 'b'); // buffered for term_1
    sendTerminalInputBatched('term_2', 'x'); // immediate for term_2

    expect(sendMock).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(TERMINAL_INPUT_MERGE_MS + 5);

    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(sendMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ session_id: 'term_1', data: 'b' }),
    );
  });

  it('flushPendingTerminalInput sends buffered input now without double-send', () => {
    sendTerminalInputBatched('term_1', 'a');
    sendTerminalInputBatched('term_1', 'b');

    flushPendingTerminalInput();

    expect(sendMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ session_id: 'term_1', data: 'b' }),
    );

    jest.advanceTimersByTime(TERMINAL_INPUT_MERGE_MS + 5);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('rejects missing session or empty data', () => {
    expect(sendTerminalInputBatched(null, 'a')).toBe(false);
    expect(sendTerminalInputBatched(undefined, 'a')).toBe(false);
    expect(sendTerminalInputBatched('', 'a')).toBe(false);
    expect(sendTerminalInputBatched('term_1', '')).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
