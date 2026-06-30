import type { StructuredActivityEvent, VibeCodingRun } from '../../data/platformModels';

/**
 * 一个待审核的文件改动（由一条 `file_change` 结构化事件投影而来）。
 * 携带渲染徽章/计数与按需拉取 diff 所需的最小信息。
 */
export interface SessionFileChange {
  path: string;
  changeKind?: string; // create | edit | delete
  added?: number;
  removed?: number;
  renamedFrom?: string;
  eventId: string;
  messageId: string;
  itemId: string;
}

/**
 * 从一个会话的结构化事件里提取 file_change 列表。
 *
 * - 只保留 `file_change`，丢弃 command/thinking/usage/task。
 * - 同一路径出现多次（AI 多次改同一文件）→ 取**最后一次**的数据
 *   （最新 diff 才是审核关心的），位置保持**首次出现**顺序（Map 语义）。
 * - 缺 `path` 的事件丢弃（无法在树/翻页里定位）。
 */
export function collectFileChanges(events: StructuredActivityEvent[]): SessionFileChange[] {
  const byPath = new Map<string, SessionFileChange>();
  for (const e of events) {
    if (e.kind !== 'file_change') continue;
    const path = e.path ?? '';
    if (!path) continue;
    byPath.set(path, {
      path,
      changeKind: e.changeKind,
      added: e.added,
      removed: e.removed,
      renamedFrom: e.renamedFrom,
      eventId: e.eventId,
      messageId: e.messageId,
      itemId: e.itemId,
    });
  }
  return [...byPath.values()];
}

/**
 * 本项目（projectId）的所有会话，按 `lastActivityMs` 倒序（最新在前）。
 * 驱动审核屏顶部的会话切换器。
 */
export function sessionsForProject(
  runs: VibeCodingRun[],
  projectId: string,
): VibeCodingRun[] {
  return runs
    .filter(r => r.projectId === projectId)
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs);
}

/**
 * 本项目最新的会话（审核默认作用域）。无匹配返回 undefined。
 */
export function latestSessionForProject(
  runs: VibeCodingRun[],
  projectId: string,
): VibeCodingRun | undefined {
  return sessionsForProject(runs, projectId)[0];
}
