// 模块级 preview 会话注册表:屏幕卸载/返回不再撤上传——重进同一视频直接
// 附到在飞会话(回放最新进度)或已就绪直链(秒开)。只有显式 cancel()(用户
// 点「取消准备」)才 DELETE 服务端撤上传删对象。
// 配套 server 幂等:即使本模块状态丢失,POST /files/preview 也会复用服务端
// 活跃会话——两层防线,彻底消灭「返回重进=二次全量上传」。
import {
  createPreviewSession,
  PreviewCancelledError,
  type PreviewPhase,
  type PreviewSession,
} from './videoPreview';

export interface VideoPreviewHandlers {
  onPhase(phase: PreviewPhase): void;
  onError(message: string): void;
}

export interface VideoPreviewHandle {
  /** 移除本监听;在飞上传继续(后台),ready 直链保留可复用。 */
  detach(): void;
  /** 显式取消:DELETE 服务端记录(撤 agent 上传+删 COS 对象)并清条目。
   * resolve 于会话 start 的收尾(取消 rejection)落定,便于测试对齐。 */
  cancel(): Promise<void>;
}

export interface VideoPreviewManagerDeps {
  createSession?: () => PreviewSession;
  now?: () => number;
}

interface ManagedEntry {
  session: PreviewSession;
  phase: PreviewPhase;
  listeners: Set<VideoPreviewHandlers>;
  readyAt?: number;
  /** start() 的收尾 promise(cancel() 等它落定)。 */
  settled: Promise<void>;
}

const MAX_INFLIGHT = 2; // starting/uploading 条目上限,超出撤最旧
const MAX_READY = 8;    // ready 条目上限(直链保留复用),超出丢最旧
const READY_TTL_MS = 90 * 60_000; // < server 2h presign 窗,过期重开(服务端幂等秒回)

const registry = new Map<string, ManagedEntry>();
const keyOf = (projectId: string, path: string) => `${projectId}:${path}`;

export function resetVideoPreviewManagerForTests(): void {
  registry.clear();
}

const broadcast = (entry: ManagedEntry, phase: PreviewPhase) => {
  entry.phase = phase;
  for (const listener of entry.listeners) {
    try {
      listener.onPhase(phase);
    } catch {
      // 单个坏监听不拖垮广播
    }
  }
};

const evictOverflow = (now: () => number) => {
  const entries = [...registry.entries()];
  // 在「即将插入新条目」前调用:腾出一个名额 → 当前在飞 ≥ 上限就得撤最旧。
  const inflight = entries.filter(([, e]) => !e.readyAt);
  if (inflight.length >= MAX_INFLIGHT) {
    for (const [key, entry] of inflight.slice(0, inflight.length - MAX_INFLIGHT + 1)) {
      entry.session.cancel();
      registry.delete(key);
    }
  }
  const ready = entries
    .filter(([, e]) => e.readyAt !== undefined)
    .sort((a, b) => (a[1].readyAt ?? 0) - (b[1].readyAt ?? 0));
  for (const [key] of ready.slice(0, Math.max(0, ready.length - MAX_READY))) {
    registry.delete(key); // 不 cancel:已 ready,对象靠服务端生命周期兜底
  }
  void now;
};

export function subscribeVideoPreview(
  projectId: string,
  path: string,
  handlers: VideoPreviewHandlers,
  deps: VideoPreviewManagerDeps = {},
): VideoPreviewHandle {
  const createSession = deps.createSession ?? (() => createPreviewSession());
  const now = deps.now ?? Date.now;
  const key = keyOf(projectId, path);

  const existing = registry.get(key);
  if (existing) {
    // ready 过期(< server presign 窗已近尾声)→ 丢弃重开;服务端幂等会秒回。
    if (existing.readyAt !== undefined && now() - existing.readyAt > READY_TTL_MS) {
      registry.delete(key);
    } else {
      existing.listeners.add(handlers);
      try {
        handlers.onPhase(existing.phase); // 立即回放最新阶段(核心:重进秒附)
      } catch {
        // 坏监听
      }
      return {
        detach: () => existing.listeners.delete(handlers),
        cancel: () => cancelEntry(key),
      };
    }
  }

  const entry: ManagedEntry = {
    session: createSession(),
    phase: { kind: 'starting' as const },
    listeners: new Set([handlers]),
    settled: Promise.resolve(),
  };
  evictOverflow(now);
  registry.set(key, entry);

  entry.settled = entry.session
    .start(projectId, path, phase => broadcast(entry, phase))
    .then(phase => {
      // start 正常收场 = ready(onPhase 已广播);记录 readyAt 供 TTL 判断。
      if (phase.kind === 'ready') entry.readyAt = now();
    })
    .catch((error: unknown) => {
      // 失败/取消:清条目(下次订阅重开);仅真实失败广播 onError。
      if (registry.get(key) === entry) registry.delete(key);
      if (!(error instanceof PreviewCancelledError)) {
        const message = error instanceof Error ? error.message : 'preview_failed';
        for (const listener of entry.listeners) {
          try {
            listener.onError(message);
          } catch {
            // 坏监听
          }
        }
      }
    });

  return {
    detach: () => entry.listeners.delete(handlers),
    cancel: () => cancelEntry(key),
  };
}

function cancelEntry(key: string): Promise<void> {
  const entry = registry.get(key);
  if (!entry) return Promise.resolve();
  registry.delete(key);
  entry.session.cancel(); // 撤 agent 上传 + DELETE 服务端记录(start 内部处理)
  return entry.settled.then(() => undefined);
}
