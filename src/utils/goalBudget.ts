/**
 * Goal 预算行的统一文案。
 *
 * 2026-10-28 预算审计:计划 tab 此前只展示预算上限(「最多 Y 个回合」),
 * 已用回合数仅 admin 视图可见——用户撞上 budget_limited 时无从判断烧了多少。
 * 服务端 publicGoal 带 turn_count 后,这里把它拼进同一行;老服务端不给
 * turn_count 时回落到原文案,保持向前兼容。
 */
export const formatGoalBudgetLine = (
  budget: { maxAttemptsPerTask?: number; maxTurns?: number },
  turnCount: number | undefined,
  deadlineText?: string,
): string => {
  const turnsText = turnCount === undefined
    ? `最多 ${budget.maxTurns ?? '-'} 个回合`
    : `已用 ${turnCount} / 最多 ${budget.maxTurns ?? '-'} 个回合`;
  const deadlineSuffix = deadlineText ? ` · 截止 ${deadlineText}` : '';
  return `预算：每项最多 ${budget.maxAttemptsPerTask ?? '-'} 次尝试 · ${turnsText}${deadlineSuffix}`;
};
