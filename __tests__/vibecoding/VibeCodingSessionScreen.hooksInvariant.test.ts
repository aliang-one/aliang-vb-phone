import * as fs from 'fs';
import * as path from 'path';

/**
 * 结构不变量回归测试（真机崩溃 2026-09-24, iPhone16Pro）:
 *
 * VibeCodingSessionScreen 的 render 体里有一个 `if (!session)` 提前 return
 * 守卫（LOADING 屏）。React 的 Rules of Hooks 要求同一组件实例每次渲染执行
 * 相同数量/顺序的 hook —— 守卫之后若再出现 hook 调用，session 从
 * undefined→defined 翻转时 hook 数 +1，React 抛
 * "Rendered more hooks than during the previous render"，
 * Release 构建无红屏兜底直接 abort。
 *
 * 这个 bug 类在本文件已复发两次：
 *   - 第一次: 历史注释（组件内 "Hooks that USED to sit after..."）记录曾修复
 *   - 第二次: 96c32c5 (2026-09-23) 把 sessionSupportedEfforts 的 useMemo
 *     又放回了守卫之后 → 17:14 真机崩溃
 *
 * 本测试把不变量固化：守卫起、至组件主 JSX return 之间，不允许出现任何
 * hook 调用。往守卫后加代码前先让测试说话。
 */

const SCREEN_PATH = path.resolve(
  __dirname,
  '../../src/screens/vibecoding/VibeCodingSessionScreen.tsx',
);

describe('VibeCodingSessionScreen hooks invariant', () => {
  it('在 if (!session) 早退守卫与主 return 之间不调用任何 hook', () => {
    const lines = fs.readFileSync(SCREEN_PATH, 'utf8').split('\n');

    const guardIdx = lines.findIndex(l => /^ {2}if \(!session\) \{$/.test(l));
    expect(guardIdx).toBeGreaterThanOrEqual(0);

    // 主 JSX return：守卫之后第一个两空格缩进的 `return (`。
    let mainReturnIdx = -1;
    for (let i = guardIdx + 1; i < lines.length; i++) {
      if (/^ {2}return \($/.test(lines[i])) {
        mainReturnIdx = i;
        break;
      }
    }
    expect(mainReturnIdx).toBeGreaterThan(guardIdx);

    // 去掉行内注释后扫描守卫起点 → 主 return 之间的全部代码。
    const region = lines
      .slice(guardIdx, mainReturnIdx)
      .map(l => l.replace(/\/\/.*$/, ''))
      .join('\n');

    const hookCalls = region.match(/\buse[A-Z][A-Za-z0-9]*\s*\(/g) ?? [];

    expect(hookCalls).toEqual([]);
  });
});
