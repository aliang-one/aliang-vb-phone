// terminal.input 直发决策(2026-10 终端回显延迟修复 Stage D)。
//
// 键盘代理在 RN 侧就算出了最终输入;旧路径把它 injectJavaScript 进 WebView,
// WebView 的 injectTerminalData('input') 根本不碰 xterm,立刻 postMessage
// 回 RN 才发 WS——一来一回是纯桥接开销,还在桥上排队。这里直接发
// platformTransport,WebView 的 onMessage 'input' 分支保留给 WebView 来源
// 输入(硬件键盘、未来路径)。
//
// 会话缺位(尚未 attach 完成)返回 false,调用方自行回退旧路径。
//
// 输入合并(2026-10 终端卡顿修复):逐键直发放大 PTY 回显量,打字簇在
// RN 侧按 leading+trailing 合并 —— 突发首键立即发出(零附加延迟),窗口内
// 后续击键合并为一条 trailing 发送,与 web 端 XtermView 的 30ms 合并对齐。
import { platformTransport } from '../services/platformTransport';

export function sendTerminalInput(
  sessionId: string | null | undefined,
  data: string,
): boolean {
  if (!sessionId || !data) return false;
  platformTransport.send({
    type: 'terminal.input',
    session_id: sessionId,
    encoding: 'text',
    data,
  });
  return true;
}

export const TERMINAL_INPUT_MERGE_MS = 24;

interface PendingTerminalInput {
  data: string;
  timer: ReturnType<typeof setTimeout>;
}

/** sessionId → 该会话合并窗口里的待发输入(同一时刻至多一个窗口)。 */
const pendingInputs = new Map<string, PendingTerminalInput>();

const sendRawTerminalInput = (sessionId: string, data: string): void => {
  platformTransport.send({
    type: 'terminal.input',
    session_id: sessionId,
    encoding: 'text',
    data,
  });
};

export function sendTerminalInputBatched(
  sessionId: string | null | undefined,
  data: string,
): boolean {
  if (!sessionId || !data) return false;

  const pending = pendingInputs.get(sessionId);
  if (!pending) {
    // Leading:突发首键立即出发,同时开一个合并窗口收拢后续击键。
    sendRawTerminalInput(sessionId, data);
    const entry: PendingTerminalInput = {
      data: '',
      timer: setTimeout(() => {
        // 身份比对:flush/换窗口后残留的旧定时器不得动新窗口的账。
        if (pendingInputs.get(sessionId) !== entry) return;
        pendingInputs.delete(sessionId);
        if (entry.data) sendRawTerminalInput(sessionId, entry.data);
      }, TERMINAL_INPUT_MERGE_MS),
    };
    pendingInputs.set(sessionId, entry);
    return true;
  }

  pending.data += data;
  return true;
}

/** 立即发出所有会话窗口里的待发输入(屏幕卸载兜底,不丢最后一击)。 */
export function flushPendingTerminalInput(): void {
  for (const [sessionId, entry] of pendingInputs) {
    clearTimeout(entry.timer);
    pendingInputs.delete(sessionId);
    if (entry.data) sendRawTerminalInput(sessionId, entry.data);
  }
}
