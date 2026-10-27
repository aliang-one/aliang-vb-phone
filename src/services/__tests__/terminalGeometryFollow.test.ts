import {
  consumeTerminalGeometryTakeover,
  forgetTerminalGeometryFollow,
  isLocalTerminalResizeRecent,
  markLocalTerminalResize,
  markTerminalGeometryTakeover,
  resetTerminalGeometryFollowForTests,
} from '../terminalGeometryFollow';

// 自发 resize 时间窗(设计 §1):手机发出的 resize 会以 geometry_changed 回显
// 给自己(publishToMobiles 无排除参数),毫秒级到达。2.5s 窗口内的回显按自发
// 过滤;窗口过后,同一会话的后续几何变化才是别人(web)发起的跟随。
describe('terminalGeometryFollow local-resize window', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetTerminalGeometryFollowForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a freshly marked session counts as recent', () => {
    markLocalTerminalResize('term-1');
    expect(isLocalTerminalResizeRecent('term-1')).toBe(true);
  });

  it('the window expires after 2500ms', () => {
    markLocalTerminalResize('term-1');
    jest.advanceTimersByTime(2500);
    expect(isLocalTerminalResizeRecent('term-1')).toBe(false);
  });

  it('is still recent a tick before the window edge', () => {
    markLocalTerminalResize('term-1');
    jest.advanceTimersByTime(2499);
    expect(isLocalTerminalResizeRecent('term-1')).toBe(true);
  });

  it('an unmarked session is never recent', () => {
    expect(isLocalTerminalResizeRecent('term-unknown')).toBe(false);
  });

  it('windows are per-session and independent', () => {
    markLocalTerminalResize('term-1');

    // term-2's mark lands one full window later: term-1's expiry must not
    // be affected by it, and vice versa.
    jest.advanceTimersByTime(2500);
    markLocalTerminalResize('term-2');

    expect(isLocalTerminalResizeRecent('term-1')).toBe(false);
    expect(isLocalTerminalResizeRecent('term-2')).toBe(true);
  });

  it('forget drops the window entry at once (session-close hygiene)', () => {
    markLocalTerminalResize('term-1');
    forgetTerminalGeometryFollow('term-1');
    expect(isLocalTerminalResizeRecent('term-1')).toBe(false);
  });

  it('forget on an unmarked session is a harmless no-op', () => {
    expect(() => forgetTerminalGeometryFollow('term-unknown')).not.toThrow();
  });
});

// 夺回标记(2026-10-27 浏览器优先):跟随徽章 tap 打点,桥侧 unfollow 引发的
// 那次自发 resize 消费它并升级为 takeover:true,让服务端对「网页授权在线」
// 的降级分支放行。一次性 + 2.5s 同寿命,残留不得长期毒化后续上报。
describe('terminalGeometryFollow takeover marker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetTerminalGeometryFollowForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a freshly marked session consumes as a takeover exactly once', () => {
    markTerminalGeometryTakeover('term-1');
    expect(consumeTerminalGeometryTakeover('term-1')).toBe(true);
    expect(consumeTerminalGeometryTakeover('term-1')).toBe(false);
  });

  it('an unmarked session never consumes as a takeover', () => {
    expect(consumeTerminalGeometryTakeover('term-unknown')).toBe(false);
  });

  it('the marker expires with the 2.5s window', () => {
    markTerminalGeometryTakeover('term-1');
    jest.advanceTimersByTime(2500);
    expect(consumeTerminalGeometryTakeover('term-1')).toBe(false);
  });

  it('is still live a tick before the window edge', () => {
    markTerminalGeometryTakeover('term-1');
    jest.advanceTimersByTime(2499);
    expect(consumeTerminalGeometryTakeover('term-1')).toBe(true);
  });

  it('forget drops a pending takeover (session-close hygiene)', () => {
    markTerminalGeometryTakeover('term-1');
    forgetTerminalGeometryFollow('term-1');
    expect(consumeTerminalGeometryTakeover('term-1')).toBe(false);
  });

  it('an expiry followed by consume does not leak into the resize window', () => {
    markTerminalGeometryTakeover('term-1');
    jest.advanceTimersByTime(2600);
    expect(consumeTerminalGeometryTakeover('term-1')).toBe(false);
    // 消费即清除:过期条目不会在后续任何时刻复活。
    expect(consumeTerminalGeometryTakeover('term-1')).toBe(false);
    expect(isLocalTerminalResizeRecent('term-1')).toBe(false);
  });
});
