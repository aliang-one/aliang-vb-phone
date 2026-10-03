// terminal.input 直发决策(2026-10 终端回显延迟修复 Stage D)。
//
// 键盘代理在 RN 侧就算出了最终输入;旧路径把它 injectJavaScript 进 WebView,
// WebView 的 injectTerminalData('input') 根本不碰 xterm,立刻 postMessage
// 回 RN 才发 WS——一来一回是纯桥接开销,还在桥上排队。这里直接发
// platformTransport,WebView 的 onMessage 'input' 分支保留给 WebView 来源
// 输入(硬件键盘、未来路径)。
//
// 会话缺位(尚未 attach 完成)返回 false,调用方自行回退旧路径。
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
