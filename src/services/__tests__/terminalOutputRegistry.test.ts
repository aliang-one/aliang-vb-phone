import {
  clearPendingTerminalOutput,
  drainPendingTerminalOutput,
  requeuePendingTerminalOutput,
  registerTerminalOutputHandler,
  routeTerminalOutputToEmulator,
  unregisterTerminalOutputHandler,
} from '../terminalOutputRegistry';

// 批量输出在 teardown 时的去路(2026-10 终端卡顿修复):模拟器卸载/换会话
// 时,批量缓冲里未冲刷的块不能丢,也不能注入到已经换主的 WebView —— 回填
// registry pending,让下一次挂载按到达顺序补放。
describe('terminalOutputRegistry requeue', () => {
  const SESSION = 'requeue-session';

  afterEach(() => {
    unregisterTerminalOutputHandler(SESSION);
    clearPendingTerminalOutput(SESSION);
  });

  it('prepends requeued chunks ahead of output buffered while unmounted', () => {
    requeuePendingTerminalOutput(SESSION, [
      { data: 'old-1', encoding: 'text' },
      { data: 'old-2', encoding: 'text' },
    ]);

    // No handler mounted: this chunk buffers behind the requeued backlog.
    expect(routeTerminalOutputToEmulator(SESSION, 'during-gap')).toBe(false);

    expect(drainPendingTerminalOutput(SESSION)).toEqual([
      { data: 'old-1', encoding: 'text' },
      { data: 'old-2', encoding: 'text' },
      { data: 'during-gap', encoding: 'text' },
    ]);
  });

  it('keeps the latest chunks when the buffer exceeds the cap', () => {
    for (let i = 0; i < 200; i += 1) {
      routeTerminalOutputToEmulator(SESSION, `live-${i}`);
    }

    requeuePendingTerminalOutput(SESSION, [
      { data: 'older-than-all', encoding: 'text' },
    ]);

    const drained = drainPendingTerminalOutput(SESSION);
    expect(drained).toHaveLength(200);
    expect(drained[0]).toEqual({ data: 'live-0', encoding: 'text' });
    expect(drained[199]).toEqual({ data: 'live-199', encoding: 'text' });
  });

  it('is a no-op for an empty chunk list', () => {
    requeuePendingTerminalOutput(SESSION, []);

    expect(drainPendingTerminalOutput(SESSION)).toEqual([]);
  });

  it('requeued chunks drain once through a fresh register', () => {
    requeuePendingTerminalOutput(SESSION, [
      { data: 'leftover', encoding: 'text' },
    ]);

    const drained = registerTerminalOutputHandler(SESSION, () => {});

    expect(drained).toEqual([{ data: 'leftover', encoding: 'text' }]);
    expect(drainPendingTerminalOutput(SESSION)).toEqual([]);
  });
});
