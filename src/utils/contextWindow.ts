/**
 * 会话上下文窗口（tokens）的共享常量与纯函数。
 *
 * 语义与 PhoneServer `server/src/modelConfig.ts` 的 clampContextWindow 保持一致：
 * 非有限 / 非正 → undefined（= 未设置，由服务端回落默认），否则四舍五入后
 * 钳到 [100k, 1M]。手机端额外提供「常见挡位」与「K 单位输入框」的换算。
 *
 * 这个值最终会以 `--autocompact <tokens>` 下发给 claude 子进程（宿主
 * withClaudeAutoCompact），或作为 AliangCode 内核自动压缩的窗口
 * （agentcore Config.ContextWindow）。
 */

export const MIN_CONTEXT_WINDOW = 100_000;
export const MAX_CONTEXT_WINDOW = 1_000_000;
/** 未设置时的有效值（与 server DEFAULT_CONTEXT_WINDOW 一致）。 */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** 滑块吸附点（也用于刻度与无障碍步进）。 */
export const CONTEXT_WINDOW_STOPS: ReadonlyArray<number> = [
  100_000,
  200_000,
  300_000,
  500_000,
  750_000,
  1_000_000,
];

/**
 * 归一化：undefined / null / 非有限 / ≤0 → undefined；其余四舍五入并钳到
 * [MIN, MAX]。服务端对「省略字段」保持原值、对 null 清除，手机端只有
 * 「有效数值」与「未设置」两态。
 */
export function clampContextWindow(value?: number | null): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded <= 0) return undefined;
  return Math.min(MAX_CONTEXT_WINDOW, Math.max(MIN_CONTEXT_WINDOW, rounded));
}

/** 实际生效的窗口值（未设置 → 默认 200k）。 */
export const resolveContextWindow = (value?: number | null): number =>
  clampContextWindow(value) ?? DEFAULT_CONTEXT_WINDOW;

/** 最近的常见挡位（拖动/点按轨道后的吸附目标）。 */
export function nearestContextWindowStop(value: number): number {
  const target = resolveContextWindow(value);
  let best = CONTEXT_WINDOW_STOPS[0];
  for (const stop of CONTEXT_WINDOW_STOPS) {
    if (Math.abs(stop - target) < Math.abs(best - target)) best = stop;
  }
  return best;
}

/** 无障碍「增减一步」：按挡位阶梯前进/后退，两端饱和。 */
export function nextContextWindowStop(value: number, direction: 1 | -1): number {
  const current = nearestContextWindowStop(value);
  const index = CONTEXT_WINDOW_STOPS.indexOf(current);
  const nextIndex = Math.min(
    CONTEXT_WINDOW_STOPS.length - 1,
    Math.max(0, index + direction),
  );
  return CONTEXT_WINDOW_STOPS[nextIndex];
}

/** 值在轨道上的位置（0..1，线性映射）。 */
export function contextWindowFraction(value: number): number {
  const tokens = resolveContextWindow(value);
  return (tokens - MIN_CONTEXT_WINDOW) / (MAX_CONTEXT_WINDOW - MIN_CONTEXT_WINDOW);
}

/** 轨道位置 → 吸附后的挡位。 */
export function contextWindowAtFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return DEFAULT_CONTEXT_WINDOW;
  const clamped = Math.min(1, Math.max(0, fraction));
  return nearestContextWindowStop(
    MIN_CONTEXT_WINDOW + clamped * (MAX_CONTEXT_WINDOW - MIN_CONTEXT_WINDOW),
  );
}

/** K 单位显示值（整数 K，四舍五入）。 */
export const contextWindowKValue = (value: number): number =>
  Math.round(resolveContextWindow(value) / 1000);

/**
 * 展示标签：200k / 750k / 1M。输入框只收整数 K，因此非整千 tokens 会以
 * 四舍五入后的 K 展示——与提交时的解析互逆。
 */
export function formatContextWindow(value?: number | null): string {
  const tokens = resolveContextWindow(value);
  if (tokens >= MAX_CONTEXT_WINDOW) return '1M';
  return `${contextWindowKValue(tokens)}k`;
}

/**
 * 解析右侧 K 输入框：接受 "200" / "200k" / " 300K "。
 * 非法（空、非整数、≤0）→ undefined；超界按 clampContextWindow 收敛
 * （输入 5 → 100k，输入 9999 → 1M）。
 */
export function parseContextWindowK(text: string): number | undefined {
  const cleaned = text.trim().replace(/k$/i, '').trim();
  if (!/^\d+$/.test(cleaned)) return undefined;
  return clampContextWindow(Number(cleaned) * 1000);
}
