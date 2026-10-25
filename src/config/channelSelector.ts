// 双通道选择纯函数 — 零 RN/网络依赖,规则见 spec §5.2:
// docs/superpowers/specs/2026-10-26-nat0-relay-dual-channel-design.md
// 海外走 HK 主通道、国内走 nat0 直连 = 探测主判据 + 地理先验兜平手。
export type EndpointId = 'primary' | 'nat0';

export interface ChannelProbe {
  id: EndpointId;
  /** 两次探测 TTFB 均值(ms);null = 探测失败/超时 */
  ttfbMs: number | null;
}

/** 中继当选所需的最小优势:比对手快 ≥30%(即 ≤ 对手×0.7) */
export const RELAY_WIN_RATIO = 0.7;

const CHINA_TIMEZONES = new Set([
  'Asia/Shanghai', 'Asia/Urumqi', 'Asia/Chongqing', 'Asia/Harbin', 'Asia/Kashgar',
]);

/**
 * 地理先验:中国时区(按时区名,而非裸 UTC+8——新加坡/吉隆坡同为 +08:00 但属海外)
 * → nat0 直连;其余 → HK 主通道。Intl 不可用时回落 UTC+8 offset(先验仅兜探测平手,误差可容忍)。
 */
export function domesticPrior(now: Date = new Date()): EndpointId {
  try {
    const { timeZone } = new Intl.DateTimeFormat().resolvedOptions();
    if (timeZone && CHINA_TIMEZONES.has(timeZone)) return 'nat0';
    if (timeZone) return 'primary';
  } catch { /* Intl 缺失,走 offset 兜底 */ }
  return now.getTimezoneOffset() === -480 ? 'nat0' : 'primary';
}

export function pickChannel(probes: ChannelProbe[], prior: EndpointId): EndpointId {
  const byId = new Map(probes.map(p => [p.id, p] as const));
  const primary = byId.get('primary');
  const nat0 = byId.get('nat0');
  const primaryOk = !!primary && primary.ttfbMs !== null;
  const nat0Ok = !!nat0 && nat0.ttfbMs !== null;
  if (primaryOk && nat0Ok) {
    const a = primary!.ttfbMs as number;
    const b = nat0!.ttfbMs as number;
    if (b <= a * RELAY_WIN_RATIO) return 'nat0';
    if (a <= b * RELAY_WIN_RATIO) return 'primary';
    return prior; // 平手 → 先验
  }
  if (nat0Ok) return 'nat0';
  if (primaryOk) return 'primary';
  return prior; // 皆不可达 → 先验
}
