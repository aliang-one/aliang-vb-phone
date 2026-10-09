/**
 * 版本更新比较工具(纯函数)。
 *
 * 与官网检查端点(aliang-official-website backend/internal/download/service.go)
 * 的格式约束对齐:服务端 versionPattern = ^v\d+\.\d+\.\d+$,裸版本或预发布
 * 一律 400。客户端在上报前归一化,收到响应后**本地复算**一次比较(不盲信
 * 服务端的 needs/force 运算——参考 alianggate software_update_service.go
 * 的防呆做法)。
 */

const APP_VERSION_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
const BARE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export function normalizeAppVersion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // 缺 v 前缀则补齐(参考 alianggate normalizeVersionString);其余非法形态
  // 一律 null——服务端对不合规版本直接 400,不要把坏值发出去。
  if (BARE_VERSION_PATTERN.test(trimmed)) return `v${trimmed}`;
  if (APP_VERSION_PATTERN.test(trimmed)) return trimmed;
  return null;
}

/** a<b → -1;a==b → 0;a>b → 1。入参必须是 normalizeAppVersion 的合法输出。 */
export function compareAppVersions(a: string, b: string): number {
  const pa = parseSegments(a);
  const pb = parseSegments(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function parseSegments(v: string): [number, number, number] {
  const m = APP_VERSION_PATTERN.exec(v);
  if (!m) throw new Error(`compareAppVersions: invalid version "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export interface UpdateDecision {
  needsUpdate: boolean;
  forceUpdate: boolean;
}

/**
 * 客户端版本 vs 服务端最新行的更新判定。返回 null = 无法判定(本机版本读
 * 不到/服务端无行/格式非法),调用方一律按"不提示"处理——检查失败绝不锁人。
 *
 * force 语义与 website CheckVersion 对齐:needs(本地复算) && 服务端最新行
 * 的行级 force_update 标志。升到位后两者自然归 false。
 */
export function resolveUpdateDecision(
  clientRaw: string | null | undefined,
  serverLatest: string | null | undefined,
  serverForceFlag: boolean | undefined,
): UpdateDecision | null {
  const client = normalizeAppVersion(clientRaw);
  const latest = normalizeAppVersion(serverLatest);
  if (!client || !latest) return null;
  const needsUpdate = compareAppVersions(client, latest) < 0;
  return { needsUpdate, forceUpdate: needsUpdate && serverForceFlag === true };
}
