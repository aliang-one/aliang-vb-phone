/**
 * useTranscriptCacheHydration — 进会话屏时用 AsyncStorage 缓存回填空 transcript
 * (修复「重启/后台降级/LRU 驱逐后进对话一片空白」,RCA 2026-10-29 症状一)。
 *
 * 时序契约(与 useSessionDetailLoader 的总闸严格正交):
 *  - run 一落 store(冷启动时列表快照可能晚于屏幕挂载)且 transcript 为空,
 *    立即读缓存注入,用户先看到上次聊到哪,不等网络;
 *  - 注入只落 transcript + transcriptSource:'cache',绝不碰 detailState /
 *    detailFromPage → computeHasDetail 不误判「已加载」,mount auto-load 与
 *    catch-up 照常发起,服务器数据按既有 merge 语义覆盖缓存;
 *  - store action 内部再校验「内存 transcript 仍为空」,缓存读取与服务器
 *    首包竞态时让位。
 */
import { useEffect, useRef } from 'react';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { readCachedTranscript } from '../../store/transcriptCache';

export function useTranscriptCacheHydration(
  sessionId: string | undefined,
  /** run 在 store 里的 transcript 长度;undefined = run 尚未落 store。 */
  transcriptLength: number | undefined,
) {
  // 每次挂载对同一会话只读一次磁盘(App 重启/重进屏幕都重新挂载,天然重试)。
  const attemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!sessionId) return;
    if (transcriptLength === undefined) return; // run 未落 store,等它出现
    if (transcriptLength > 0 || attemptedRef.current.has(sessionId)) return;
    attemptedRef.current.add(sessionId);
    let cancelled = false;
    void (async () => {
      const cached = await readCachedTranscript(sessionId);
      if (cancelled || !cached) return;
      useControlCenterStore
        .getState()
        .hydrateRunTranscriptFromCache(sessionId, cached);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, transcriptLength]);
}
