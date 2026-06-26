import type { StructuredActivityEvent } from '../data/platformModels';

/**
 * Live headline + counts for the collapsed "工具活动" block rendered on each
 * assistant turn (L2). Purely derived from one assistant message's
 * `StructuredActivityEvent[]` group — zero React, zero I/O, fully unit-testable.
 *
 * Headline priority: active thinking > open (started) command > file edits > 兜底。
 *
 * 兜底分支由 `turnSettled` 决定:
 *  - `turnSettled=true`(历史回合,或最新回合已 settle)→ 「已完成」
 *  - `turnSettled=false`(最新回合仍在流式,只是恰好处于两次 API 请求的空档)→ 「处理中…」
 *
 * 这是「一次 vibecoding 还没结束就很快显示已完成」的修复点:空档不再误判成完成。
 */
export interface ActivitySummary {
  /** 实时主行（思考中 / 运行命令 / 编辑文件 / 处理中… / 已完成）。 */
  headline: string;
  /** 正在运行（驱动动效）。live 回合处于请求空档时也算 active(显示 spinner)。 */
  hasActive: boolean;
  fileCount: number;
  commandCount: number;
  taskDone: number;
  taskTotal: number;
  /** Sum of input+output tokens from the latest usage event, if > 0. */
  usageTokens?: number;
  /** Subject of the currently in_progress task, if any. */
  taskCurrent?: string;
}

const fmtChars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function summarizeActivity(
  events: StructuredActivityEvent[],
  turnSettled = true,
): ActivitySummary | null {
  if (!events.length) return null;

  const cmds = events.filter(
    (e): e is Extract<StructuredActivityEvent, { kind: 'command' }> =>
      e.kind === 'command',
  );
  const files = events.filter(
    (e): e is Extract<StructuredActivityEvent, { kind: 'file_change' }> =>
      e.kind === 'file_change',
  );
  const thinking = events.filter(
    (e): e is Extract<StructuredActivityEvent, { kind: 'thinking' }> =>
      e.kind === 'thinking',
  );
  const usage = events.filter(
    (e): e is Extract<StructuredActivityEvent, { kind: 'usage' }> =>
      e.kind === 'usage',
  );
  const task = events.find(
    (e): e is Extract<StructuredActivityEvent, { kind: 'task' }> =>
      e.kind === 'task',
  );

  const openCmd = cmds.find((c) => c.status === 'started');
  const activeThink = thinking.some((t) => t.active);
  const lastThink = thinking[thinking.length - 1];

  const headline = activeThink
    ? `🧠 思考中…${lastThink && lastThink.chars > 0 ? `(${fmtChars(lastThink.chars)})` : ''}`
    : openCmd
      ? `⚙ ${openCmd.command ?? '运行命令'}`
      : files.length > 0
        ? `📝 编辑 ${files.length} 个文件`
        : turnSettled
          ? '已完成'
          : '处理中…';

  const lastUsage = usage[usage.length - 1];
  const usageTokens = lastUsage
    ? (lastUsage.inputTokens ?? 0) + (lastUsage.outputTokens ?? 0)
    : undefined;
  const usageToShow = usageTokens && usageTokens > 0 ? usageTokens : undefined;
  const taskCurrent = task?.tasks.find((t) => t.status === 'in_progress')?.subject;

  return {
    headline,
    hasActive: activeThink || Boolean(openCmd) || !turnSettled,
    fileCount: files.length,
    commandCount: cmds.length,
    taskDone: task ? task.tasks.filter((t) => t.status === 'completed').length : 0,
    taskTotal: task ? task.tasks.length : 0,
    usageTokens: usageToShow,
    taskCurrent,
  };
}

/**
 * L3 — 底部常驻气泡的实时步骤脉冲。与 `summarizeActivity` 同源(都看
 * `thinking.active` / `command.status==='started'`),但语义更纯:
 *  - 永不显示「已完成」(那是 L2 历史回合的职责)。
 *  - 没有活跃脉冲时,按 `isLiveTurn` 二选一:「处理中…」(还活着,在请求空档)或
 *    「等待你的输入」(回合 settle,球回到用户)。
 *
 * `isLiveTurn` 由调用方按「最近 delta 是否在窗口内」判定;这里再 OR 上 hasActive,
 * 这样即便没有文本 delta(纯命令执行期),有 started 命令也能保持 live。
 */
export interface LivePulse {
  headline: string;
  /** 是否处于活跃态(驱动 spinner):有思考/命令在跑,或回合仍 live。 */
  hasActive: boolean;
}

export function deriveLivePulse(
  events: ReadonlyArray<StructuredActivityEvent>,
  isLiveTurn: boolean,
): LivePulse | null {
  if (!events.length) return null;
  const cmds = events.filter(
    (e): e is Extract<StructuredActivityEvent, { kind: 'command' }> =>
      e.kind === 'command',
  );
  const thinking = events.filter(
    (e): e is Extract<StructuredActivityEvent, { kind: 'thinking' }> =>
      e.kind === 'thinking',
  );
  const openCmd = cmds.find((c) => c.status === 'started');
  const activeThink = thinking.some((t) => t.active);
  const hasActive = activeThink || Boolean(openCmd);
  const live = isLiveTurn || hasActive;
  const headline = activeThink
    ? '🧠 思考中…'
    : openCmd
      ? `⚙ ${openCmd.command ?? '运行命令'}`
      : live
        ? '处理中…'
        : '等待你的输入';
  return { headline, hasActive: live };
}
