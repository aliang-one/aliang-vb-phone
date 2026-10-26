// 多通道选择纯函数 — 零 RN/网络依赖,规则见 spec §5.2:
// docs/superpowers/specs/2026-10-26-nat0-relay-dual-channel-design.md
// 探测主判据:最快者需比次快者快 ≥30% 才当选;滞回带内 → 地理/持久化先验裁决。
// 通道列表由 config/localService 的 ENDPOINTS 决定(primary/nat0/hk)。
export type EndpointId = 'primary' | 'nat0' | 'hk';

export interface ChannelProbe {
  id: EndpointId;
  /** 两次探测 TTFB 均值(ms);null = 探测失败/超时 */
  ttfbMs: number | null;
}

/** 挑战者当选所需的最小优势:比次快者快 ≥30%(即 ≤ 对手×0.7) */
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

/**
 * N 通道择优:最快者需比次快者快 ≥30%;滞回带内 → 先验裁决(地理先验兜平手)。
 * 仅一条通道可达 → 直接选它;全部不可达 → 先验。
 */
export function pickChannel(probes: ChannelProbe[], prior: EndpointId): EndpointId {
  const ok = probes.filter(p => p.ttfbMs !== null);
  if (ok.length === 0) return prior;
  const sorted = [...ok].sort((a, b) => (a.ttfbMs as number) - (b.ttfbMs as number));
  const best = sorted[0];
  if (ok.length === 1) return best.id;
  const second = sorted[1];
  // 位移规则(优先):最快者比次快者快 ≥30% → 直接当选,先验不参与
  if ((best.ttfbMs as number) <= (second.ttfbMs as number) * RELAY_WIN_RATIO) {
    return best.id;
  }
  // 滞回带:无人有 ≥30% 优势 → 先验裁决,但仅限带内成员
  // (带内 = 与最快者差距 <43%;带外通道绝不能因先验当选——三通道下
  // 两条快线打平、先验指向慢 47 倍的第三通道,实测事故形态)
  const bandMax = (best.ttfbMs as number) / RELAY_WIN_RATIO;
  const inBand = sorted.filter(p => (p.ttfbMs as number) <= bandMax);
  const priorPick = inBand.find(p => p.id === prior);
  return (priorPick ?? best).id;
}
