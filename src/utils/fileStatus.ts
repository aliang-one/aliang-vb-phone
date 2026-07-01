/** 文件 git 状态（与 ProjectFileEntry.status 同构）。 */
export type FileStatus = 'clean' | 'modified' | 'added' | 'deleted';

/**
 * 把 agent 上报的 status 字符串规范化成 phone 的 FileStatus。
 * 大小写/空白容错；未知或缺省 → clean（非 git 项目或 agent 未上报时兜底）。
 */
export function normalizeFileStatus(raw: string | undefined): FileStatus {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'modified' || v === 'added' || v === 'deleted') return v;
  return 'clean';
}
