import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface IncrementalListOptions {
  initialCount?: number;
  step?: number;
  resetKey?: string | number | boolean;
  from?: 'start' | 'end';
}

export interface RevealGraduallyOptions {
  chunkSize?: number;
  gapMs?: number;
  /** 自然完成(最后一批挂载完)时回调;被顶掉/取消时**不**回调。 */
  onSettled?: () => void;
}

/** 揭示的收尾形态:superseded=true 表示这次揭示被更新的一次顶掉/被取消。 */
export interface RevealSettleResult {
  superseded: boolean;
}

// 分批揭示(浏览长历史防单帧巨挂载)。一次 setState 揭示过多条目会在单个
// React commit 里同步挂载全部内容(Fabric 一个 mount 事务),长历史上翻
// "加载更早"或 scrubber 跳转时把 JS 线程与主线程同时打满。拆成小批 +
// 宏任务间隔,给每批的 commit→mount→layout 留出呼吸窗口。
const DEFAULT_REVEAL_CHUNK_SIZE = 4;
const DEFAULT_REVEAL_CHUNK_GAP_MS = 32;

export const useIncrementalList = <T,>(
  items: T[],
  {
    initialCount = 6,
    step = 10,
    resetKey,
    from = 'start',
  }: IncrementalListOptions = {},
) => {
  const [visibleCount, setVisibleCount] = useState(initialCount);
  // 分批揭示的批间定时器;窗口镜像 ref 供绝对式分批在调用时取起点。
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 在途揭示的 settle 集合:被顶掉/取消时以 {superseded:true} 决议,等待方
  // 据此跳过清理(revealHoldRef 由新一轮揭示接管)。这是 revealHold 竞态的
  // 根修:旧方案"cancel 不触发 onSettled"会让持有者永远挂起。
  const pendingSettlesRef = useRef<Set<(superseded: boolean) => void>>(
    new Set(),
  );
  const visibleCountRef = useRef(visibleCount);
  visibleCountRef.current = visibleCount;

  const cancelReveal = useCallback(() => {
    if (revealTimerRef.current !== null) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    if (pendingSettlesRef.current.size) {
      const pending = pendingSettlesRef.current;
      pendingSettlesRef.current = new Set();
      pending.forEach(resolve => resolve(true));
    }
  }, []);

  // 卸载与 resetKey 重置都必须取消在途批次,避免旧会话的批次写进新窗口。
  useEffect(() => cancelReveal, [cancelReveal]);

  useEffect(() => {
    setVisibleCount(initialCount);
    cancelReveal();
  }, [initialCount, resetKey, cancelReveal]);

  const visibleItems = useMemo(
    () =>
      from === 'end'
        ? items.slice(Math.max(0, items.length - visibleCount))
        : items.slice(0, visibleCount),
    [from, items, visibleCount],
  );

  // Stable callbacks: the returned object is fresh every render, but consumers
  // destructure these into dependency arrays / memo boundaries (e.g. the
  // scrubber commit path), so per-render identities would defeat React.memo.
  const showMore = useCallback(
    () => setVisibleCount(current => current + step),
    [step],
  );
  // Mount every item at once. Used when a layout is needed for an arbitrary
  // off-screen element (e.g. jump-to-message from the conversation scrubber);
  // incremental showMore above would otherwise never reach the earliest items.
  const showAll = useCallback(
    () => setVisibleCount(items.length),
    [items.length],
  );
  // Widen the window just enough to cover a needed visible count (never
  // shrink). The scrubber commit path uses this to reveal a far-away turn
  // without paying showAll's full-list mount on long conversations.
  const revealThrough = useCallback(
    (neededVisibleCount: number) =>
      setVisibleCount(current => Math.max(current, neededVisibleCount)),
    [],
  );
  // 分批版 showMore:与 showMore 同义(+step),把 step 拆成 chunkSize 一批、
  // 批间 gapMs 揭示。每批函数式 setState 读最新窗口。返回 Promise:自然完成
  // 决议 {superseded:false};被新揭示/reset/卸载顶掉决议 {superseded:true}
  // ——调用方据此决定是否释放随揭示持有的状态(revealHoldRef),杜绝"顶掉
  // 后 onSettled 永不触发→持有者挂起"的竞态。onSettled 仅自然完成时回调
  // (与旧语义一致,同步调用方无感)。
  const showMoreGradually = useCallback(
    (options: RevealGraduallyOptions = {}): Promise<RevealSettleResult> => {
      const {
        chunkSize = DEFAULT_REVEAL_CHUNK_SIZE,
        gapMs = DEFAULT_REVEAL_CHUNK_GAP_MS,
        onSettled,
      } = options;
      cancelReveal();
      return new Promise(resolve => {
        let settled = false;
        const finish = (superseded: boolean) => {
          if (settled) return;
          settled = true;
          pendingSettlesRef.current.delete(finish);
          if (!superseded) onSettled?.();
          resolve({ superseded });
        };
        pendingSettlesRef.current.add(finish);
        let remaining = step;
        const tick = () => {
          const chunk = Math.min(chunkSize, remaining);
          remaining -= chunk;
          setVisibleCount(current => current + chunk);
          if (remaining > 0) {
            revealTimerRef.current = setTimeout(tick, gapMs);
          } else {
            revealTimerRef.current = null;
            finish(false);
          }
        };
        tick();
      });
    },
    [cancelReveal, step],
  );
  // 分批版 revealThrough(绝对目标、绝不回缩)。目标在调用时可同步算出时使用
  // (scrubber commit 无 await):以调用时窗口为起点分批走到目标;窗口已到达
  // 目标则直接 settle。批内用函数式 setState 钳到目标,并发扩窗不会回缩。
  // Promise 语义同 showMoreGradually。
  const revealThroughGradually = useCallback(
    (
      neededVisibleCount: number,
      options: RevealGraduallyOptions = {},
    ): Promise<RevealSettleResult> => {
      const {
        chunkSize = DEFAULT_REVEAL_CHUNK_SIZE,
        gapMs = DEFAULT_REVEAL_CHUNK_GAP_MS,
        onSettled,
      } = options;
      cancelReveal();
      const remaining = Math.max(
        neededVisibleCount - visibleCountRef.current,
        0,
      );
      return new Promise(resolve => {
        let settled = false;
        const finish = (superseded: boolean) => {
          if (settled) return;
          settled = true;
          pendingSettlesRef.current.delete(finish);
          if (!superseded) onSettled?.();
          resolve({ superseded });
        };
        pendingSettlesRef.current.add(finish);
        if (remaining === 0) {
          finish(false);
          return;
        }
        let done = 0;
        const tick = () => {
          done = Math.min(done + chunkSize, remaining);
          setVisibleCount(current =>
            Math.max(current, Math.min(current + chunkSize, neededVisibleCount)),
          );
          if (done < remaining) {
            revealTimerRef.current = setTimeout(tick, gapMs);
          } else {
            revealTimerRef.current = null;
            finish(false);
          }
        };
        tick();
      });
    },
    [cancelReveal],
  );

  return {
    visibleItems,
    visibleCount: Math.min(visibleCount, items.length),
    totalCount: items.length,
    hasMore: visibleCount < items.length,
    showMore,
    showAll,
    revealThrough,
    showMoreGradually,
    revealThroughGradually,
    cancelReveal,
  };
};
