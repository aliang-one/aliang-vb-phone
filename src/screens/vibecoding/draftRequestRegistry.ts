/**
 * draftRequestRegistry — 新建会话 client_request_id 的跨导航复用登记表。
 *
 * 2026-10-28 取证实锤(7-24 重复卡样本):服务端幂等键是
 * `(userId, requestId, payloadHash)`——重试时换了 requestId 就等于新会话。
 * 屏幕层原有的 pendingRequestId 存在 draftConfig(navigation params)里,只在
 * 同一次 draft 生命周期内复用;失败/超时/离开页面后重试会重新生成 requestId,
 * 服务端按设计无法拒绝「同内容不同 requestId」,于是列表出现两条同文会话。
 *
 * 这里按「服务端 create 载荷指纹」登记 requestId(模块级 Map,存活于应用进程,
 * 屏幕卸载/导航不丢):TTL 内同载荷重试 → 复用同一 requestId → 服务端幂等回放
 * 同一会话(failed 终态还会走 shouldRetryFailedDispatch 原地重投,正好是用户
 * 要的「重试」语义)。创建**成功**即删除登记——成功后用户再次发送同样内容是
 * 「有意再开一个会话」,必须放行新会话而不是回放到旧会话。
 *
 * TTL 取 10 分钟:实锤样本两次尝试间隔 2分17秒,10 分钟覆盖慢失败 + 用户反应
 * 时间;过期后同文本重发视为新的会话意图。
 */

const TTL_MS = 10 * 60 * 1000;
// 防无界增长:登记按「创建过的 draft」计,量级极小;上限裁掉最旧。
const MAX_ENTRIES = 32;

interface DraftRequestEntry {
  requestId: string;
  createdAt: number;
}

const entries = new Map<string, DraftRequestEntry>();

/** 服务端 create 载荷中会改变 payloadHash 的字段(与屏幕 startAgentSession 入参对齐)。 */
export interface DraftCreatePayload {
  deviceId: string;
  projectId: string;
  directory: string;
  provider: string;
  objective: string;
  model?: string;
  effort?: string;
  contextWindow?: number;
  approvalScheme?: string;
  canRead?: boolean;
  canModify?: boolean;
  canRun?: boolean;
}

export function draftRequestKey(payload: DraftCreatePayload): string {
  // 显式枚举字段(而非 Object.keys 反射):与 DraftCreatePayload 定义保持
  // 同步演进,也躲开 interface→Record 的 TS2352。
  const fields: Array<[keyof DraftCreatePayload, unknown]> = [
    ['approvalScheme', payload.approvalScheme],
    ['canModify', payload.canModify],
    ['canRead', payload.canRead],
    ['canRun', payload.canRun],
    ['contextWindow', payload.contextWindow],
    ['deviceId', payload.deviceId],
    ['directory', payload.directory],
    ['effort', payload.effort],
    ['model', payload.model],
    ['objective', payload.objective],
    ['projectId', payload.projectId],
    ['provider', payload.provider],
  ];
  return fields.map(([key, value]) => `${key}=${String(value ?? '')}`).join('|');
}

function pruneExpired(nowMs: number): void {
  for (const [key, entry] of entries) {
    if (nowMs - entry.createdAt >= TTL_MS) entries.delete(key);
  }
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/**
 * 取该载荷对应的 requestId:未过期登记命中 → 复用(幂等重试);未命中 →
 * 生成新 id 并登记。`nowMs` 供测试注入时钟。
 */
export function acquireDraftRequestId(
  payload: DraftCreatePayload,
  nowMs: number = Date.now(),
): string {
  pruneExpired(nowMs);
  const key = draftRequestKey(payload);
  const hit = entries.get(key);
  if (hit && nowMs - hit.createdAt < TTL_MS) {
    return hit.requestId;
  }
  // 与 store/internals 的 createId 同族格式(前缀-时间戳-随机),不直接 import
  // 是为保持本模块零依赖(store/internals 牵 i18n 等副作用)。
  const requestId = `ai-create-${nowMs}-${Math.random().toString(36).slice(2, 7)}`;
  entries.set(key, { requestId, createdAt: nowMs });
  return requestId;
}

/** 创建成功后调用:删除登记,放行后续「有意再开一个」的同文本会话。 */
export function confirmDraftRequestId(payload: DraftCreatePayload): void {
  entries.delete(draftRequestKey(payload));
}

/** 测试隔离用。 */
export function resetDraftRequestRegistryForTests(): void {
  entries.clear();
}
