// 长按麦克风键听写：光标处实时插入的纯函数集合。
// 设计 spec: docs/superpowers/specs/2026-11-05-dictation-at-cursor-design.md
//
// 屏幕层持有 DictationSession（ref，不进 state），每次 stt.partial 驱动的
// liveCaption 变化调用 applyDictationLive 滑动替换在途片段；stt.completed
// 用 commitDictationText 以权威 final 全文替换（liveCaption 有 120ms 节流、
// finishWith 会丢弃 pending caption 且服务端标点/ITN 可能改写文本，绝不能
// 假设"片段已在位"）；失败用 revertDictation 还原。

export interface DictationSession {
  /** 仅在 start 成功后为 true；commit/revert/错误同步置回 false——liveCaption
   * 的 watch effect 以此门控（finishWith 在 onComplete 前会把 liveCaption
   * 置空，未门控会把已定稿片段抹掉）。 */
  active: boolean;
  /** 听写锚点：input 中的插入起点（选区起点或 input.length）。 */
  cursor: number;
  /** 当前在途片段长度（初始 = 选区长度）。 */
  segLen: number;
}

export const IDLE_DICTATION: DictationSession = { active: false, cursor: 0, segLen: 0 };

export interface TextSelection {
  start: number;
  end: number;
}

/** `input[cursor, cursor+segLen)` 替换为 incoming。 */
export function replaceSegment(
  input: string,
  cursor: number,
  segLen: number,
  incoming: string,
): string {
  return input.slice(0, cursor) + incoming + input.slice(cursor + segLen);
}

/** 听写锚点：null selection（从未聚焦）→ 追加末尾；空选区 → 光标处；
 * 非空选区 → 替换整个选区（同系统键盘听写习惯）。 */
export function resolveDictationAnchor(
  selection: TextSelection | null,
  inputLength: number,
): { cursor: number; segLen: number } {
  if (!selection) return { cursor: inputLength, segLen: 0 };
  const segLen = Math.max(0, selection.end - selection.start);
  return { cursor: selection.start, segLen };
}

/** liveCaption 变化：替换在途片段。inactive 时恒等返回——这是防"尾随空更新
 * 抹掉定稿文本"的唯一闸门，屏幕层 effect 不得绕过它直接调 replaceSegment。 */
export function applyDictationLive(
  session: DictationSession,
  input: string,
  incoming: string,
): { input: string; segLen: number } {
  if (!session.active) return { input, segLen: session.segLen };
  return {
    input: replaceSegment(input, session.cursor, session.segLen, incoming),
    segLen: incoming.length,
  };
}

/** 定稿：用权威 final 全文替换在途段，回报光标应落的偏移。 */
export function commitDictationText(
  session: DictationSession,
  input: string,
  text: string,
): { input: string; cursor: number } {
  return {
    input: replaceSegment(input, session.cursor, session.segLen, text),
    cursor: session.cursor + text.length,
  };
}

/** 失败/空结果：清掉在途段还原原文。 */
export function revertDictation(session: DictationSession, input: string): string {
  return replaceSegment(input, session.cursor, session.segLen, '');
}
