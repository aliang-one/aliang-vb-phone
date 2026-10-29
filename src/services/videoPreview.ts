// 视频在线播放编排:POST preview → 轮询状态 → 拿 COS 直链(inline 语义)。
// 取消经 DELETE 通知服务端撤上传+删对象;轮询而非等推送:与下载 sheet 的
// 事件通道解耦,实现更薄。
import {
  cancelProjectFilePreview,
  fetchProjectFilePreview,
  startProjectFilePreview,
  type ServerFilePreview,
} from '../api/projects';

export type PreviewPhase =
  | { kind: 'starting' }
  | { kind: 'uploading'; percent: number }
  | { kind: 'ready'; url: string; requestId: string };

export interface PreviewApi {
  start(projectId: string, path: string): Promise<ServerFilePreview>;
  get(projectId: string, requestId: string): Promise<ServerFilePreview>;
  cancel(projectId: string, requestId: string): Promise<ServerFilePreview>;
}

export const previewApi: PreviewApi = {
  start: startProjectFilePreview,
  get: fetchProjectFilePreview,
  cancel: cancelProjectFilePreview,
};

const POLL_INTERVAL_MS = 2_000;
// 上传编排超时上限取 server 侧公式上界(30min)再加余量;到点按失败收场,
// 用户可改走下载。正常视频(≤100MB/512KB/s 上行)远早于此。
const POLL_DEADLINE_MS = 35 * 60_000;

export class PreviewCancelledError extends Error {
  constructor() {
    super('preview_cancelled');
  }
}

/**
 * 跑完一次 preview 会话:resolve 于拿到直链;服务端 failed/cancelled、轮询
 * 超时或外部 cancel() 都 reject(调用方按播放失败兜底渲染下载 CTA)。
 * onPhase 汇报 starting/uploading(percent)/ready;cancel() 只在
 * starting/uploading 阶段有效,ready 后是 no-op(播放中)。
 */
export function createPreviewSession(api: PreviewApi = previewApi) {
  let active: { projectId: string; requestId: string } | null = null;
  let cancelled = false;

  const cancel = (): void => {
    cancelled = true;
    const current = active;
    if (current) {
      active = null;
      // best-effort:失败不阻塞 UI(对象靠生命周期兜底)
      void api.cancel(current.projectId, current.requestId).catch(() => {});
    }
  };

  const start = async (
    projectId: string,
    path: string,
    onPhase?: (phase: PreviewPhase) => void,
  ): Promise<PreviewPhase> => {
    cancelled = false;
    onPhase?.({ kind: 'starting' });
    const created = await api.start(projectId, path);
    if (cancelled) {
      // start 返回前用户已取消:补一刀删除,再以取消态收场
      void api.cancel(projectId, created.request_id).catch(() => {});
      throw new PreviewCancelledError();
    }
    active = { projectId, requestId: created.request_id };
    if (created.state === 'ready' && created.url) {
      active = null;
      const phase: PreviewPhase = { kind: 'ready', url: created.url, requestId: created.request_id };
      onPhase?.(phase);
      return phase;
    }

    const deadline = Date.now() + POLL_DEADLINE_MS;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      if (cancelled) throw new PreviewCancelledError();
      const snapshot = await api.get(projectId, created.request_id);
      if (snapshot.state === 'ready' && snapshot.url) {
        active = null;
        const phase: PreviewPhase = { kind: 'ready', url: snapshot.url, requestId: snapshot.request_id };
        onPhase?.(phase);
        return phase;
      }
      if (snapshot.state === 'failed' || snapshot.state === 'cancelled') {
        active = null;
        throw new Error(snapshot.reason ?? 'preview_failed');
      }
      if (snapshot.state === 'uploading') {
        const done = snapshot.uploaded_bytes ?? 0;
        const total = snapshot.total_bytes ?? 0;
        // total 未知时给 0%——UI 显示「准备中」而非误导性进度
        onPhase?.({
          kind: 'uploading',
          percent: total > 0 ? Math.min(99, Math.floor((done / total) * 100)) : 0,
        });
      }
    }
    active = null;
    throw new Error('preview_timeout');
  };

  return { start, cancel };
}

export type PreviewSession = ReturnType<typeof createPreviewSession>;
