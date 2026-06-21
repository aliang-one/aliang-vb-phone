import type { StructuredActivityEvent } from '../data/platformModels';

/**
 * Live headline + counts for the collapsed "工具活动" block rendered on each
 * assistant turn. Purely derived from one assistant message's
 * `StructuredActivityEvent[]` group — zero React, zero I/O, fully unit-testable.
 *
 * Headline priority: active thinking > open (started) command > file edits > done.
 */
export interface ActivitySummary {
  /** 实时主行（思考中 / 运行命令 / 编辑文件 / 已完成）。 */
  headline: string;
  /** 正在运行（驱动动效）。 */
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
        : '已完成';

  const lastUsage = usage[usage.length - 1];
  const usageTokens = lastUsage
    ? (lastUsage.inputTokens ?? 0) + (lastUsage.outputTokens ?? 0)
    : undefined;
  const usageToShow = usageTokens && usageTokens > 0 ? usageTokens : undefined;
  const taskCurrent = task?.tasks.find((t) => t.status === 'in_progress')?.subject;

  return {
    headline,
    hasActive: activeThink || Boolean(openCmd),
    fileCount: files.length,
    commandCount: cmds.length,
    taskDone: task ? task.tasks.filter((t) => t.status === 'completed').length : 0,
    taskTotal: task ? task.tasks.length : 0,
    usageTokens: usageToShow,
    taskCurrent,
  };
}
