import type { DiffLine } from '../../data/platformModels';

/**
 * 把 unified diff 文本解析成 {@link DiffLine} 数组。
 *
 * `CodeDiffViewer` 自行渲染 +/-/空格 前缀，所以这里的 `content` 是
 * **去掉前缀**的纯行内容。
 *
 * 跳过：文件头（`+++`/`---`）、hunk 头（`@@`）、以及 `diff --git`/`index`
 * 等元数据行（不以 +/-/空格 开头的行）。
 */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const result: DiffLine[] = [];
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (raw.startsWith('@@')) continue;
    if (raw.startsWith('+')) {
      result.push({ type: 'add', content: raw.slice(1) });
    } else if (raw.startsWith('-')) {
      result.push({ type: 'remove', content: raw.slice(1) });
    } else if (raw.startsWith(' ')) {
      result.push({ type: 'context', content: raw.slice(1) });
    }
    // 其余（diff --git / index / "\ No newline" / 空行）→ 跳过
  }
  return result;
}
