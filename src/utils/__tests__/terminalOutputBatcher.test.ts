import {
  createTerminalOutputBatcher,
  TERMINAL_OUTPUT_FLUSH_MS,
} from '../terminalOutputBatcher';

// RN↔WebView 桥接合并(2026-10 终端卡顿修复):挂载态的 terminal.output 逐块
// injectJavaScript 是打字卡顿的主因。批 Contracts:
//   1. 空闲批处理器的首块立即冲刷(零额外回显延迟);
//   2. 窗口内的后续块合并为一次冲刷,保持到达顺序;
//   3. 连续风暴被限制在约每窗口一次冲刷;
//   4. drain() 在不冲刷的前提下归还缓冲(teardown 时回填 registry)。
describe('terminalOutputBatcher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('flushes the leading chunk of an idle batcher immediately', () => {
    const flushed: string[][] = [];
    const batcher = createTerminalOutputBatcher(items =>
      flushed.push(items.map(item => item.data)),
    );

    batcher.push('first');

    expect(flushed).toEqual([['first']]);
  });

  it('coalesces a burst into one trailing flush, preserving arrival order', () => {
    const flushed: string[][] = [];
    const batcher = createTerminalOutputBatcher(items =>
      flushed.push(items.map(item => item.data)),
    );

    batcher.push('a');
    batcher.push('b');
    batcher.push('c');

    expect(flushed).toEqual([['a']]);

    jest.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS);

    expect(flushed).toEqual([['a'], ['b', 'c']]);
  });

  it('caps a continuous storm far below one flush per chunk', () => {
    let flushes = 0;
    let delivered = 0;
    const batcher = createTerminalOutputBatcher(items => {
      flushes += 1;
      delivered += items.length;
    });

    for (let i = 0; i < 100; i += 1) {
      batcher.push(`chunk-${i}`);
      jest.advanceTimersByTime(1);
    }
    jest.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS);

    expect(delivered).toBe(100);
    // 100 chunks over 100ms must never cost 100 bridge crossings.
    expect(flushes).toBeLessThan(20);
  });

  it('flush() delivers immediately and cancels the pending window', () => {
    const flushed: string[][] = [];
    const batcher = createTerminalOutputBatcher(items =>
      flushed.push(items.map(item => item.data)),
    );

    batcher.push('a');
    batcher.push('b');
    batcher.flush();

    expect(flushed).toEqual([['a'], ['b']]);

    jest.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS * 2);

    expect(flushed).toEqual([['a'], ['b']]);
  });

  it('drain() returns buffered chunks in order without flushing', () => {
    const flushed: string[][] = [];
    const batcher = createTerminalOutputBatcher(items =>
      flushed.push(items.map(item => item.data)),
    );

    batcher.push('a', 'text', { leading: false });
    batcher.push('b', 'base64', { leading: false });

    expect(batcher.drain()).toEqual([
      { data: 'a', encoding: 'text' },
      { data: 'b', encoding: 'base64' },
    ]);
    expect(flushed).toEqual([]);

    // The cancelled window must not fire into an emptied buffer.
    jest.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS * 2);
    expect(flushed).toEqual([]);
  });

  it('backfill pushes coalesce instead of leading-flushing', () => {
    const flushed: string[][] = [];
    const batcher = createTerminalOutputBatcher(items =>
      flushed.push(items.map(item => item.data)),
    );

    // Registry-drained backlog must not masquerade as fresh live output.
    batcher.push('backlog-1', 'text', { leading: false });
    batcher.push('backlog-2', 'text', { leading: false });

    expect(flushed).toEqual([]);

    jest.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS);

    expect(flushed).toEqual([['backlog-1', 'backlog-2']]);
  });

  it('ignores empty chunks', () => {
    const flushed: string[][] = [];
    const batcher = createTerminalOutputBatcher(items =>
      flushed.push(items.map(item => item.data)),
    );

    batcher.push('');

    expect(batcher.stats()).toEqual({ chunks: 0, flushes: 0 });
    expect(batcher.drain()).toEqual([]);
    jest.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS * 2);
    expect(flushed).toEqual([]);
  });

  it('stats() tracks accepted chunks and flush invocations', () => {
    const batcher = createTerminalOutputBatcher(() => {});

    batcher.push('a');
    batcher.push('b');
    jest.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS);

    expect(batcher.stats()).toEqual({ chunks: 2, flushes: 2 });
  });

  it('logs per-second chunk→flush deltas when labelled (dev bridge audit)', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const batcher = createTerminalOutputBatcher(
        () => {},
        TERMINAL_OUTPUT_FLUSH_MS,
        'terminal-bridge',
      );

      for (let i = 0; i < 50; i += 1) {
        batcher.push('x');
        jest.advanceTimersByTime(1);
      }
      jest.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS);

      const logLine = info.mock.calls
        .map(call => String(call[0]))
        .find(line => line.includes('terminal-bridge'));
      expect(logLine).toBeDefined();
      expect(logLine).toMatch(/chunks/);
      expect(logLine).toMatch(/injectJavaScript/);
    } finally {
      info.mockRestore();
    }
  });

  it('does not log when no label is provided', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const batcher = createTerminalOutputBatcher(() => {});

      batcher.push('x');
      jest.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS);

      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
    }
  });
});
