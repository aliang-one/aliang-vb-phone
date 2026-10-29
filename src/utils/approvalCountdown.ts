/**
 * 审批作答 SLA 的倒计时分档（跨端统一 P4-2）。
 *
 * expiresAt 是服务端归一后的 ms epoch（approval.requested payload 的
 * expires_at；agent 侧 tool_ask 才带，普通审批缺省）。分档（按剩余时长）：
 *   >1h    「约 X 小时」（约 = round 的模糊量级）
 *   ≤1h    「X 分钟」（ceil，向上取整——宁多勿少）
 *   <2min  「即将超时」
 *   ≤0    null（已过期不渲染）
 *   缺失    null（不显示倒计时）
 */

export type ApprovalCountdown =
  | { tier: 'hours'; hours: number }
  | { tier: 'minutes'; minutes: number }
  | { tier: 'expiring' };

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export function approvalCountdown(
  expiresAt: number | undefined,
  now: number,
): ApprovalCountdown | null {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) return null;
  if (remainingMs < 2 * MINUTE_MS) return { tier: 'expiring' };
  if (remainingMs <= HOUR_MS) {
    return {
      tier: 'minutes',
      minutes: Math.max(1, Math.ceil(remainingMs / MINUTE_MS)),
    };
  }
  return {
    tier: 'hours',
    hours: Math.max(1, Math.round(remainingMs / HOUR_MS)),
  };
}
