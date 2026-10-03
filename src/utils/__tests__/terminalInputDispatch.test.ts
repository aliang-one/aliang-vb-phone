import { platformTransport } from '../../services/platformTransport';
import { sendTerminalInput } from '../terminalInputDispatch';

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
