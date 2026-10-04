/**
 * RN↔WebView 桥接合并(2026-10 终端卡顿修复)。
 *
 * 挂载态的 terminal.output 曾逐块 injectJavaScript:PTY 回显按 pty.onData
 * 原样转发,输入回显是逐字符小块,每块一次原生桥穿越,打字/刷屏即卡。
 * 这个批处理器在「输出注册表 → injectJavaScript」之间加一个合并窗口:
 *   - 空闲时的首块立即冲刷(孤立回显零附加延迟);
 *   - 窗口内的后续块合并为一次冲刷 —— 冲刷脚本里逐块调用
 *     injectTerminalData,xterm.write 排队保序,字节流语义不变;
 *   - drain() 在不冲刷的前提下归还缓冲 —— 卸载/换会话时由调用方回填
 *     registry pending,不丢字节、不把旧会话注入已换主的 WebView。
 *
 * 连续风暴的上限 ≈ 每窗口 1~2 次冲刷(100 块/100ms < 20 次桥穿越),
 * 稀疏块(>窗口间隔)保持逐块直通,与旧行为一致。
 */

export const TERMINAL_OUTPUT_FLUSH_MS = 24;

export interface TerminalOutputBatchItem {
  data: string;
  encoding: string;
}

export interface TerminalOutputBatcher {
  /**
   * Buffer a chunk. The leading chunk of an idle batcher flushes
   * synchronously unless `leading: false` (registry-drained backlog must
   * coalesce, not masquerade as fresh live output).
   */
  push(data: string, encoding?: string, options?: { leading?: boolean }): void;
  /** Flush buffered chunks now; cancels the pending window. */
  flush(): void;
  /** Return buffered chunks (arrival order) and cancel the pending window. */
  drain(): TerminalOutputBatchItem[];
  /** Accepted chunks vs flush invocations — the dev bridge audit numbers. */
  stats(): { chunks: number; flushes: number };
}

export function createTerminalOutputBatcher(
  onFlush: (items: TerminalOutputBatchItem[]) => void,
  flushMs: number = TERMINAL_OUTPUT_FLUSH_MS,
  debugLabel?: string,
): TerminalOutputBatcher {
  let pending: TerminalOutputBatchItem[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chunks = 0;
  let flushes = 0;
  let lastLoggedAt = 0;
  let lastLoggedChunks = 0;
  let lastLoggedFlushes = 0;

  // Dev-only bridge audit: chunks in → injectJavaScript out, per active second.
  // Counters live here so the numbers cover exactly the path being measured.
  const maybeLog = () => {
    if (!debugLabel) return;
    if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
    const now = Date.now();
    if (now - lastLoggedAt < 1000) return;
    const chunkDelta = chunks - lastLoggedChunks;
    const flushDelta = flushes - lastLoggedFlushes;
    lastLoggedAt = now;
    lastLoggedChunks = chunks;
    lastLoggedFlushes = flushes;
    console.info(
      `[${debugLabel}] ${chunkDelta} chunks → ${flushDelta} injectJavaScript ` +
        `(cumulative ${chunks}/${flushes})`,
    );
  };

  const doFlush = () => {
    if (!pending.length) return;
    const items = pending;
    pending = [];
    flushes += 1;
    onFlush(items);
    maybeLog();
  };

  const armTimer = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      doFlush();
    }, flushMs);
  };

  return {
    push(data, encoding = 'text', options) {
      if (!data) return;
      chunks += 1;
      pending.push({ data, encoding });
      if (!timer && pending.length === 1 && options?.leading !== false) {
        // Leading chunk of an idle window: render now, then open the merge
        // window so the rest of the burst coalesces behind it.
        doFlush();
      }
      armTimer();
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      doFlush();
    },
    drain() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const items = pending;
      pending = [];
      return items;
    },
    stats: () => ({ chunks, flushes }),
  };
}
