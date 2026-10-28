import { formatGoalBudgetLine } from '../goalBudget';

describe('formatGoalBudgetLine', () => {
  const budget = { maxAttemptsPerTask: 3, maxTurns: 100 };

  it('服务端带 turn_count 时展示「已用 N / 最多 Y 个回合」', () => {
    // 2026-10-28 预算审计:计划 tab 此前只展示上限,用户撞上 budget_limited
    // 时看不到烧了多少回合(turn_count 仅 admin 视图可见)。
    expect(formatGoalBudgetLine(budget, 37)).toBe(
      '预算：每项最多 3 次尝试 · 已用 37 / 最多 100 个回合',
    );
  });

  it('老服务端不带 turn_count 时保持原「最多 Y 个回合」文案', () => {
    expect(formatGoalBudgetLine(budget, undefined)).toBe(
      '预算：每项最多 3 次尝试 · 最多 100 个回合',
    );
  });

  it('缺省数值以 - 占位', () => {
    expect(formatGoalBudgetLine({}, undefined)).toBe(
      '预算：每项最多 - 次尝试 · 最多 - 个回合',
    );
  });

  it('有截止时间时追加截止段', () => {
    expect(formatGoalBudgetLine(budget, 2, '10-21 18:00')).toBe(
      '预算：每项最多 3 次尝试 · 已用 2 / 最多 100 个回合 · 截止 10-21 18:00',
    );
    expect(formatGoalBudgetLine(budget, undefined, '10-21 18:00')).toBe(
      '预算：每项最多 3 次尝试 · 最多 100 个回合 · 截止 10-21 18:00',
    );
  });
});
