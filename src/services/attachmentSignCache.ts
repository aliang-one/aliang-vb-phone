/**
 * 附件显示 URL 的内存缓存（Task 19）。
 *
 * 气泡要显示一张历史图片，只有两条路：
 *   1. 这张图是**本次会话里自己刚发的** —— 磁盘上还有原文件，直接
 *      `file://` 渲染，零网络请求（见 `registerLocalAssetPath`）；
 *   2. 其余情况一律找服务端换一张 GET 预签名 URL（15 分钟有效）。
 *
 * 第 2 条有两个必须处理的现实：
 *   - 一屏可能有十几张图。逐个签名会把 `/api/ai/attachments/sign` 打成
 *     一串并发小请求，所以这里做**同 tick 合并**：一次 commit 里所有气泡
 *     的请求攒进 `pending`，下一个微任务统一发一批（服务端单批上限 50）。
 *   - URL 会过期。缓存里提前 60 秒判定失效，让组件在过期前重新签，避免
 *     用户滑回一条老消息时看到裂图。
 *
 * 失败语义：**绝不抛给渲染层**。签名失败（或服务端静默跳过未知 id）就把
 * 该 id 记进 `failed`，气泡渲染「图片已过期」占位——宁可少一张图，也不
 * 显示裂图。下次组件挂载会再试一次。
 */
import { signAttachments } from '../api/attachments';

/** 提前多久把缓存判为失效（毫秒）。 */
const EARLY_REFRESH_MS = 60_000;
/** 服务端单次签名上限。 */
const MAX_BATCH = 50;

/**
 * 一条待签名素材的完整引用。历史图片（server 重启后内存上传位已丢）靠
 * mime + sessionId 在服务端推导对象键，所以这两项必须随 assetId 一起带。
 */
export interface AttachmentRef {
  assetId: string;
  mime: string;
  sessionId: string;
}

interface CacheEntry {
  url: string;
  /** 毫秒时间戳。 */
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
/** 已排进下一批、还没发出（或还在飞行中）的引用，按 assetId 去重。 */
const pending = new Map<string, AttachmentRef>();
/** 签名失败 / 服务端没返回的 id。 */
const failed = new Set<string>();
/**
 * 本地文件路径注册表：asset_id → 手机磁盘路径。
 * 只对「本次运行里自己发出去的素材」有效，App 重启后自然清空——那时原
 * 文件可能已被缓存清理，回落到签名才是对的。
 */
const localPaths = new Map<string, string>();
const listeners = new Set<() => void>();

let flushScheduled = false;

const notify = () => {
  listeners.forEach(listener => listener());
};

/** 注册一条本地文件路径，让气泡跳过签名直接读磁盘。 */
export function registerLocalAssetPath(
  assetId: string,
  localPath: string | undefined,
): void {
  if (!assetId || !localPath) return;
  if (localPaths.get(assetId) === localPath) return;
  localPaths.set(assetId, localPath);
  // 之前可能已经签名失败过；现在有本地文件了，占位要撤掉。
  failed.delete(assetId);
  notify();
}

/** 该素材的本地文件路径（没有则 undefined）。 */
export function localAssetPath(assetId: string): string | undefined {
  return localPaths.get(assetId);
}

/** 可用的签名 URL；未签、已过期（含提前 60s）或失败时返回 undefined。 */
export function getSignedUrl(assetId: string): string | undefined {
  const entry = cache.get(assetId);
  if (!entry) return undefined;
  if (entry.expiresAt - Date.now() <= EARLY_REFRESH_MS) return undefined;
  return entry.url;
}

/** 该素材最近一次签名尝试是否失败（用于渲染过期占位）。 */
export function attachmentUrlFailed(assetId: string): boolean {
  return failed.has(assetId);
}

/**
 * 距离「提前刷新点」还有多少毫秒（用于给已渲染的图排一个续签定时器）。
 * 没有缓存条目时返回 undefined。
 */
export function signedUrlRefreshDelay(assetId: string): number | undefined {
  const entry = cache.get(assetId);
  if (!entry) return undefined;
  return Math.max(0, entry.expiresAt - EARLY_REFRESH_MS - Date.now());
}

/** 订阅缓存变化；返回取消订阅函数（配合 useSyncExternalStore）。 */
export function subscribeAttachmentUrls(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 确保这些素材有可用的签名 URL。同步返回，异步补数据；调用方通过
 * `subscribeAttachmentUrls` 收到完成通知。本地已有文件或缓存仍有效的 id
 * 会被跳过——所以重复调用是廉价的。
 */
export function ensureAttachmentUrls(refs: readonly AttachmentRef[]): void {
  let added = false;
  for (const ref of refs) {
    if (!ref?.assetId) continue;
    if (localPaths.has(ref.assetId)) continue;
    if (getSignedUrl(ref.assetId)) continue;
    if (pending.has(ref.assetId)) continue;
    pending.set(ref.assetId, ref);
    added = true;
  }
  if (added) scheduleFlush();
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  // 微任务而不是 setTimeout：同一轮 React commit 里所有气泡的 effect 都会
  // 在微任务前跑完，从而合并成一次请求；同时不额外引入一帧延迟。
  Promise.resolve().then(() => {
    flushScheduled = false;
    const refs = [...pending.values()];
    pending.clear();
    if (refs.length > 0) void flush(refs);
  });
}

async function flush(refs: readonly AttachmentRef[]): Promise<void> {
  const now = Date.now();
  // 排队期间可能已被别处填好（例如并发的本地注册），发请求前再筛一遍。
  const missing = refs.filter(ref => {
    const entry = cache.get(ref.assetId);
    return !entry || entry.expiresAt - now <= EARLY_REFRESH_MS;
  });
  if (missing.length === 0) return;

  for (let offset = 0; offset < missing.length; offset += MAX_BATCH) {
    const chunk = missing.slice(offset, offset + MAX_BATCH);
    try {
      const response = await signAttachments(
        chunk.map(ref => ({
          asset_id: ref.assetId,
          mime: ref.mime,
          session_id: ref.sessionId,
        })),
      );
      const fallbackExpiry = Date.now() + (response.expires_in ?? 0) * 1000;
      for (const ref of chunk) {
        const signed = response.urls?.[ref.assetId];
        if (!signed?.url) {
          // 服务端对未知/他人/ASCII 的条目静默跳过：视为不可用，占位。
          failed.add(ref.assetId);
          continue;
        }
        const parsed = signed.expires_at ? Date.parse(signed.expires_at) : NaN;
        cache.set(ref.assetId, {
          url: signed.url,
          expiresAt: Number.isFinite(parsed) ? parsed : fallbackExpiry,
        });
        failed.delete(ref.assetId);
      }
    } catch {
      // 网络/服务端错误：整批记失败，渲染占位；不向调用方抛。
      for (const ref of chunk) failed.add(ref.assetId);
    } finally {
      notify();
    }
  }
}

/** 测试用：清空所有内存状态。 */
export function clearAttachmentSignCache(): void {
  cache.clear();
  pending.clear();
  failed.clear();
  localPaths.clear();
  flushScheduled = false;
  notify();
}
