import {
  forgetTerminalGeometryFollow,
  isLocalTerminalResizeRecent,
  markLocalTerminalResize,
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
