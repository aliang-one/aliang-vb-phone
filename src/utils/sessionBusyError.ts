import { ApiResponseError } from '../api/client';

/**
 * 「会话忙」类错误的统一识别 + 友好文案入口（跨仓契约 C6：服务端 409
 * ai_session_busy 与 agent tui_busy 在发送/停止路径上的用户可见提示）。
 *
 * 两个来源：
 * - 服务端 claim 失败：HTTP 409，body `{error:'ai_session_busy'}`（服务端把 code
 *   直接当 error 文本下发，见 AliangPhoneServer server/src/index.ts 的 ApiError
 *   序列化），客户端 apiFetch 包成 ApiResponseError(code=message='ai_session_busy')。
 * - agent TUI 预检/外部中断（C3）：错误经 ai.error 事件通道上报（非 HTTP），
 *   message 为 agent 的英文原文，code 未必能带上，所以 code 之外还要按 message
 *   关键字兜底。
 *
 * 命中返回 busy 类型；null 表示不属于「会话忙」家族，调用方应回退到既有文案
 * （interruptFailedPrefix 横幅 / failed 气泡），行为保持不变。
 */
export type SessionBusyKind = 'session_busy' | 'tui_busy';

const SESSION_BUSY_CODE = 'ai_session_busy';
const TUI_BUSY_CODE = 'tui_busy';

// message 关键字兜底（统一小写比较）：服务端把 code 当文本下发；agent 的英文
// 原文（"TUI session is running an active turn in its terminal; retry after it
// finishes"）；手机本地 store guard（"… is still running. Stop it before …"）。
const SESSION_BUSY_MESSAGE_HINTS = [SESSION_BUSY_CODE, 'still running'];
const TUI_BUSY_MESSAGE_HINTS = [
  TUI_BUSY_CODE,
  'running an active turn',
  'active turn in its terminal',
];

const errorParts = (error: unknown): { code?: string; message: string } => {
  const code =
    error instanceof ApiResponseError
      ? error.code
      : (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return { code, message };
};

const matchesAny = (haystack: string, hints: string[]) =>
  hints.some(hint => haystack.includes(hint));

export const classifySessionBusyError = (
  error: unknown,
): SessionBusyKind | null => {
  const { code, message } = errorParts(error);
  if (code === TUI_BUSY_CODE) return 'tui_busy';
  if (code === SESSION_BUSY_CODE) return 'session_busy';
  const haystack = message.toLowerCase();
  if (matchesAny(haystack, TUI_BUSY_MESSAGE_HINTS)) return 'tui_busy';
  if (matchesAny(haystack, SESSION_BUSY_MESSAGE_HINTS)) return 'session_busy';
  return null;
};

/**
 * 忙类错误 → 本地化友好文案（i18n key 在 vibecoding:session.error.*）。
 * 非忙类错误返回 null，交给调用方的通用错误展示。
 */
export const sessionBusyErrorText = (
  error: unknown,
  t: (key: string) => string,
): string | null => {
  const kind = classifySessionBusyError(error);
  if (kind === 'tui_busy') return t('session.error.sessionBusyTui');
  if (kind === 'session_busy') return t('session.error.sessionBusy');
  return null;
};
