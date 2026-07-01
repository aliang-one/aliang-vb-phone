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

/**
 * 「审核 AI 改动」入口的显隐/计数依据。
 *
 * ⚠️ 必须用列表快照里就有的 resident 字段：会话列表的 `publicAiSession`
 * 序列化**不带** `structured_events`（只有单会话详情才带，还会被 idle 内存
 * 降界清空），所以 `structuredEvents` 对未打开过的会话恒为 `[]`。改用 agent
 * 上报、列表里常驻的 `filesTouchedCount`；仅当它缺失（旧会话）时才回退到
 * 已水合的 `structuredEvents` 长度。
 */
export function changeReviewCount(session: VibeCodingRun | undefined): number {
  if (!session) return 0;
  // 三档 resident 计数，按可靠性排序：会话级 gitChangedCount（publicAiSession
 // line git_changed_count，列表快照常带）→ filesTouchedCount → 已水合的
  // structuredEvents。三者都可能为空，所以调用方还应用「有匹配会话」兜底显隐。
  return (
    session.gitChangedCount ??
    session.filesTouchedCount ??
    collectFileChanges(session.structuredEvents).length
  );
}

/**
 * 从「每个 file_change 的 detail 拉取结果」里**只保留真正带 diff 文本**的。
 * slim envelope 不带 diff（heavy detail 才有），所以是否有 diff 只能在拉取后
 * 判断；拉取失败（null）或 detail.text 为空/缺失的条目丢弃，避免审核页出现
 * 「无 diff」空泡。保持首次出现顺序。
 */
export function pickChangesWithDiff(
  results: Array<{
    fc: SessionFileChange;
    detail: { text?: string; truncated: boolean };
  } | null>,
): SessionFileChange[] {
  const kept: SessionFileChange[] = [];
  for (const r of results) {
    if (r && r.detail.text) kept.push(r.fc);
  }
  return kept;
}
