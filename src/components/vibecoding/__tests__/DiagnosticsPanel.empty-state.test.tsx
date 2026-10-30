/**
 * 诊断面板空态契约（2026-10-29「面板长期为空」RCA 收口）。
 *
 * 「上游没报过用量」和「已用 0 tokens」是两回事：前者（旧内核 / 该通道无
 * usage 上报）显示「暂无用量数据」，后者（真实用量恰好为 0 的场景不存在——
 * 只要报了 usage 三项和必 > 0）显示数字。窗口兜底自 run.contextWindow 时
 * 同样走空态文案，不再渲染「0 / 1M」这种把缺数据伪装成零用量的形态。
 *
 * DiagnosticsPanel 依赖 reanimated/safe-area（jest.setup.js 已全局 mock），
 * i18n 锁 zh（setup 里 changeLanguage('zh')），直接断言中文文案。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { DiagnosticsPanel } from '../DiagnosticsPanel';
import type { VibeCodingRun } from '../../../data/platformModels';

function makeRun(overrides: Partial<VibeCodingRun> = {}): VibeCodingRun {
  return {
    id: 'run-diag',
    title: '诊断面板',
    deviceId: 'dev-1',
    projectId: 'proj-1',
    directory: '/tmp/proj',
    status: 'running',
    phase: 'running',
    contextWindow: 1_000_000,
    ...overrides,
  } as VibeCodingRun;
}

function renderPanel(run: VibeCodingRun): string {
  let root: TestRenderer.ReactTestRenderer;
  act(() => {
    root = TestRenderer.create(
      <DiagnosticsPanel open onClose={() => {}} run={run} />,
    );
  });
  const texts: string[] = [];
  root!.root.findAllByType('Text' as never).forEach(node => {
    const { children } = node.props as { children?: unknown };
    if (typeof children === 'string') texts.push(children);
  });
  return texts.join('\n');
}

describe('DiagnosticsPanel 空态', () => {
  it('diag 存在但 contextTokens=0 → 显示「暂无用量数据」而非「0 / …」', () => {
    const output = renderPanel(
      makeRun({
        diagnostics: {
          turns: 21,
          contextTokens: 0,
          contextWindow: 1_000_000,
          dupStreak: 0,
          errStreak: 0,
          truncStreak: 0,
          elapsedMs: 212_000,
          stopReason: 'tool_use',
        },
      }),
    );
    expect(output).toContain('暂无用量数据');
    expect(output).not.toMatch(/0 \/ 1M/);
    // 回合数照常展示——空态只针对用量，不吞运行状态。
    expect(output).toContain('21');
  });

  it('diag 缺失但 run.contextWindow 兜底 → 同样空态文案', () => {
    const output = renderPanel(makeRun());
    expect(output).toContain('暂无用量数据');
    expect(output).not.toMatch(/0 \/ 1M/);
  });

  it('contextTokens>0 → 正常渲染「X / Y」', () => {
    const output = renderPanel(
      makeRun({
        diagnostics: {
          turns: 3,
          contextTokens: 45_600,
          contextWindow: 1_000_000,
          dupStreak: 0,
          errStreak: 0,
          truncStreak: 0,
          elapsedMs: 5_000,
        },
      }),
    );
    expect(output).toContain('45,600 / 1M');
    expect(output).not.toContain('暂无用量数据');
  });
});
