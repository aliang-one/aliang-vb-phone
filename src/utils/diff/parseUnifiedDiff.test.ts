import { parseUnifiedDiff } from './parseUnifiedDiff';
import type { DiffLine } from '../../data/platformModels';

// CodeDiffViewer 自己渲染 +/-/空格 前缀，所以 DiffLine.content 是去掉前缀的纯内容。

describe('parseUnifiedDiff', () => {
  test('解析 add/remove/context 行，跳过文件头与 hunk 头', () => {
    const diff = [
      'diff --git a/foo.ts b/foo.ts',
      'index 1234567..89abcde 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -10,4 +10,5 @@',
      ' context line',
      '-removed line',
      '+added line',
      '+second add',
      ' trailing context',
    ].join('\n');

    const result = parseUnifiedDiff(diff);

    const expected: DiffLine[] = [
      { type: 'context', content: 'context line' },
      { type: 'remove', content: 'removed line' },
      { type: 'add', content: 'added line' },
      { type: 'add', content: 'second add' },
      { type: 'context', content: 'trailing context' },
    ];
    expect(result).toEqual(expected);
  });

  test('空输入返回 []', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });

  test('只有元数据（diff/index/文件头，无 hunk 体）返回 []', () => {
    const diff = ['diff --git a/foo b/foo', 'index 1..2 100644', '--- a/foo', '+++ b/foo'].join('\n');
    expect(parseUnifiedDiff(diff)).toEqual([]);
  });

  test('跳过 "No newline at end of file" 标记', () => {
    const diff = ['@@ -1,1 +1,1 @@', '-old', '\\ No newline at end of file', '+new'].join('\n');
    expect(parseUnifiedDiff(diff)).toEqual([
      { type: 'remove', content: 'old' },
      { type: 'add', content: 'new' },
    ]);
  });

  test('多个 hunk 合并为一个连续序列', () => {
    const diff = [
      '@@ -1,1 +1,1 @@',
      ' a',
      '+b',
      '@@ -10,1 +11,1 @@',
      ' c',
      '-d',
    ].join('\n');
    expect(parseUnifiedDiff(diff)).toEqual([
      { type: 'context', content: 'a' },
      { type: 'add', content: 'b' },
      { type: 'context', content: 'c' },
      { type: 'remove', content: 'd' },
    ]);
  });

  test('空内容行：新增空行 + 空白上下文行 content 为空串', () => {
    const diff = ['@@ -1,2 +1,3 @@', ' ', '+', ' x'].join('\n');
    expect(parseUnifiedDiff(diff)).toEqual([
      { type: 'context', content: '' },
      { type: 'add', content: '' },
      { type: 'context', content: 'x' },
    ]);
  });

  test('纯新增或纯删除', () => {
    expect(parseUnifiedDiff(['@@ -0,0 +1,1 @@', '+brand new'].join('\n'))).toEqual([
      { type: 'add', content: 'brand new' },
    ]);
    expect(parseUnifiedDiff(['@@ -1,1 +0,0 @@', '-gone'].join('\n'))).toEqual([
      { type: 'remove', content: 'gone' },
    ]);
  });
});
