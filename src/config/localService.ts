// Platform service — 所有平台服务 URL 的唯一真相源(HTTP/WS/STT 三条消费链)。
//
// 改址/加节点 = 改下方编译期常量:主通道改 PLATFORM_SERVICE_BASE_URL,
// nat0 改 NAT0_BASE_URL;新增节点在 ENDPOINTS 加一行。
//
// 双通道不变量(2026-10 nat0 中继):
//   1. 候选表 = 编译期常量(ENDPOINTS,加节点 = 加一行),不是运行时状态;
//   2. AsyncStorage 只存"先验"(上次赢家 primary|nat0),且仅作探测平手时
//      的裁决——不是缓存,不参与可达性判定;
//   3. 每次冷启/后台重探都对双通道做真实 /health 探测择优,stale 先验
//      钉不住流量。当年移除缓存的病根正是"先验赢了探测":旧版把
//      AsyncStorage 里的宿主回插成首选候选,一个 stale
//      http://127.0.0.1:4000 扛住了所有配置编辑(2026-10 事故)。
//      候选表现以编译期常量回归,缓存则被阉割成只兜平手的先验。
//
// 运行期通道态:activeId 起始 primary;网络层连续失败达阈值即翻转通道
// (见 reportChannelFailure),成功上报清零计数。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { pickChannel, domesticPrior, type EndpointId } from './channelSelector';

// ---------------------------------------------------------------------------
// URL helpers + 通道常量(改址见文件头)
// ---------------------------------------------------------------------------
export function normalizeServiceBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function toWebSocketUrl(baseUrl: string): string {
  return normalizeServiceBaseUrl(baseUrl).replace(/^http/, 'ws');
}

/** 主通道(primary)基址 —— ENDPOINTS 的编译期来源之一。 */
export const PLATFORM_SERVICE_BASE_URL = normalizeServiceBaseUrl(
  'https://ws-vb-phone.aliang.one',
);
export const PLATFORM_SERVICE_WS_URL = toWebSocketUrl(PLATFORM_SERVICE_BASE_URL);

export interface PlatformServiceHealth {
  ok: boolean;
  status?: number;
  latencyMs: number;
  checkedAt: string;
  message: string;
  baseUrl: string;
}

// —— 双通道候选(编译期常量;新增节点=加一行)——
const PRIMARY_BASE_URL = PLATFORM_SERVICE_BASE_URL; // https://ws-vb-phone.aliang.one(HK)
const NAT0_BASE_URL = normalizeServiceBaseUrl('https://ws-vb-phone.nat.aliang.one:40557');
const ENDPOINTS: ReadonlyArray<{ id: EndpointId; baseUrl: string }> = [
  { id: 'primary', baseUrl: PRIMARY_BASE_URL },
  { id: 'nat0', baseUrl: NAT0_BASE_URL },
];

const PRIOR_STORAGE_KEY = 'nat.channel.prior';
const PROBE_TIMEOUT_MS = 3000;
const PROBE_SAMPLES = 2;
const FAILURE_SWITCH_THRESHOLD = 3;
// 防横跳锁(spec §5.2):回切仅由 10 分钟后台重探驱动,禁止故障恢复后立即横跳。
const FLIP_LOCK_MS = 5 * 60 * 1000;
const REPROBE_INTERVAL_MS = 10 * 60 * 1000;

const DEFAULT_CHECK_TIMEOUT_MS = 5000;

/** Race a promise against a timeout. Clears the timer when either side
 * settles (promise wins OR timeout wins) so Jest doesn't report an open
 * handle. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Session flag: confirmed reachable at least once this session so the HTTP
// client can skip re-probing /health on every request once the host answered.
let platformServiceReachable = false;

// 通道运行态:当前生效通道 + 连续失败计数(达阈值翻转)+ 防横跳锁。
let activeId: EndpointId = 'primary';
let consecutiveFailures = 0;
let lockedAgainst: EndpointId | null = null;
let lockUntil = 0;
let reprobeTimer: ReturnType<typeof setInterval> | null = null;

const endpointBy = (id: EndpointId) => ENDPOINTS.find(e => e.id === id)!;

/** 当前通道 baseUrl —— HTTP/WS/STT 三条消费链唯一的 URL 入口。 */
export async function getPlatformServiceBaseUrl(): Promise<string> {
  return endpointBy(activeId).baseUrl;
}

/** 当前生效通道 id(诊断/测试观测用)。 */
export function getActiveEndpointId(): EndpointId {
  return activeId;
}

export function isPlatformServiceReachable(): boolean {
  return platformServiceReachable;
}

/** 网络层失败上报(client.ts markPlatformServiceUnreachable 与 WS 重连失败接线)。 */
export function reportChannelFailure(): void {
  platformServiceReachable = false;
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_SWITCH_THRESHOLD) {
    // 防横跳锁(spec §5.2):先记下被逃离的通道再翻转。锁定期内即使它
    // 探测更快也不得切回——单次 /health 便宜可能假赢(快 ≠ 扛得住重载
    // 流量),故障恢复后的回切只能由后台重探/锁过期驱动,禁止立即横跳。
    lockedAgainst = activeId;
    lockUntil = Date.now() + FLIP_LOCK_MS;
    activeId = activeId === 'primary' ? 'nat0' : 'primary';
    consecutiveFailures = 0;
  }
}

// Mark the host unreachable (a request just failed with a network error) so
// the next apiFetch re-probes instead of trusting the stale session flag.
// 同时计入通道失败计数——网络层错误正是翻通道的信号源。
export function markPlatformServiceUnreachable(): void {
  reportChannelFailure();
}

// Retained for the HTTP client's call site (client.ts marks a host reachable
// after a successful request). 成功即清零连续失败计数:间歇性抖动不翻通道。
export async function rememberPlatformServiceBaseUrl(
  _baseUrl: string,
): Promise<void> {
  platformServiceReachable = true;
  consecutiveFailures = 0;
}

/** 单通道 TTFB 采样:PROBE_SAMPLES 次 /health,均值;全部失败返回 null。 */
async function probeTtfb(baseUrl: string): Promise<number | null> {
  const normalized = normalizeServiceBaseUrl(baseUrl);
  const samples: number[] = [];
  for (let i = 0; i < PROBE_SAMPLES; i++) {
    const startedAt = Date.now();
    try {
      const response = await withTimeout(
        fetch(`${normalized}/health`, { method: 'GET' }),
        PROBE_TIMEOUT_MS,
      );
      if (response.ok) samples.push(Date.now() - startedAt);
    } catch { /* 该次样本作废 */ }
  }
  return samples.length
    ? samples.reduce((a, b) => a + b, 0) / samples.length
    : null;
}

/** 持久化先验:仅 'primary'|'nat0' 合法,其余(含幽灵 127.0.0.1)一律弃用,
 * 回落地理先验。读失败同回落。 */
async function loadPrior(): Promise<EndpointId> {
  try {
    const stored = await AsyncStorage.getItem(PRIOR_STORAGE_KEY);
    if (stored === 'primary' || stored === 'nat0') return stored;
  } catch { /* 读失败回落地理先验 */ }
  return domesticPrior();
}

/**
 * 冷启/重探入口:双通道并行探测 → 择优(30%滞回,平手用持久化先验→地理先验)。
 * 先验只是平手裁决,不是缓存——每次都真探,坏通道钉不住流量。
 * 最坏耗时 = 每通道 PROBE_TIMEOUT_MS × PROBE_SAMPLES(双通道并行)。
 * 防横跳锁生效期内,即使被逃离通道探测夺冠也保持现状(见 reportChannelFailure);
 * 双通道皆不可达时 throw(保持/翻转 reachable 标记)。
 */
export async function discoverReachableBaseUrl(): Promise<string> {
  const prior = await loadPrior();
  const probes = await Promise.all(
    ENDPOINTS.map(async e => ({ id: e.id, ttfbMs: await probeTtfb(e.baseUrl) })),
  );
  const winner = pickChannel(probes, prior);
  // 防横跳锁(spec §5.2):锁定期内被逃离通道即使探测更快也不得切回;
  // 锁过期后 Date 守卫自然失效。锁只有在"没拦成"时才解除(赢家非锁定
  // 通道,或已过期)——被拦截这一次必须保住锁,否则一次被拦的重探就
  // 把锁放掉,下一次探测立刻横跳回去。
  const lockApplies = winner === lockedAgainst && Date.now() < lockUntil;
  const effective = lockApplies ? activeId : winner;
  if (!lockApplies) {
    lockedAgainst = null;
  }
  activeId = effective;
  consecutiveFailures = 0;
  await AsyncStorage.setItem(PRIOR_STORAGE_KEY, effective).catch(() => {});
  scheduleBackgroundReprobe();
  if (probes.find(p => p.id === effective)?.ttfbMs == null) {
    platformServiceReachable = false;
    throw new Error('Unable to reach platform service (primary & nat0 relay)');
  }
  platformServiceReachable = true;
  return endpointBy(effective).baseUrl;
}

/** 周期后台重探,让坏通道自动回流。探测失败保持现状。 */
function scheduleBackgroundReprobe(): void {
  if (reprobeTimer) return;
  reprobeTimer = setInterval(() => {
    discoverReachableBaseUrl().catch(() => { /* 探测失败保持现状 */ });
  }, REPROBE_INTERVAL_MS);
}

/** 测试专用:清掉后台重探定时器,防 jest open handle。生产代码勿调用。 */
export function __stopBackgroundReprobeForTests(): void {
  if (reprobeTimer) {
    clearInterval(reprobeTimer);
    reprobeTimer = null;
  }
}

async function probePlatformService(
  baseUrl: string,
  timeoutMs: number,
): Promise<PlatformServiceHealth> {
  const normalized = normalizeServiceBaseUrl(baseUrl);
  const startedAt = Date.now();
  try {
    const response = await withTimeout(
      fetch(`${normalized}/health`, { method: 'GET' }),
      timeoutMs,
    );
    const latencyMs = Date.now() - startedAt;
    return {
      ok: response.ok,
      status: response.status,
      latencyMs,
      checkedAt: new Date().toLocaleTimeString(),
      baseUrl: normalized,
      message: response.ok
        ? `Connected to ${normalized}`
        : `Service responded with HTTP ${response.status}`,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      ok: false,
      latencyMs,
      checkedAt: new Date().toLocaleTimeString(),
      baseUrl: normalized,
      message:
        error instanceof Error ? error.message : `Unable to reach ${normalized}`,
    };
  }
}

/** Connectivity check for the ACTIVE channel (diagnostics use). */
export const checkPlatformService = async (
  timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS,
): Promise<PlatformServiceHealth> => {
  const result = await probePlatformService(
    endpointBy(activeId).baseUrl,
    timeoutMs,
  );
  if (result.ok) {
    platformServiceReachable = true;
  }
  return result;
};
