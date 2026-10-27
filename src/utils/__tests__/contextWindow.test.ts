import {
  CONTEXT_WINDOW_STOPS,
  DEFAULT_CONTEXT_WINDOW,
  MAX_CONTEXT_WINDOW,
  MIN_CONTEXT_WINDOW,
  clampContextWindow,
  contextWindowAtFraction,
  contextWindowFraction,
  contextWindowKValue,
  formatContextWindow,
  nearestContextWindowStop,
  nextContextWindowStop,
  parseContextWindowK,
  resolveContextWindow,
} from '../contextWindow';

// 这一组锁死手机端上下文窗口的三条契约：
//  1. clamp 与 PhoneServer 的 clampContextWindow 同语义（越界钳制、非法丢弃）——
//     手机与服务端任何一边漂移都会让「界面显示的值」≠「实际下发值」；
//  2. 滑块的挡位吸附与 K 输入框解析互逆（输入 200 → 200k，输入 5 → 100k）；
//  3. 1M 展示为 1M 而不是 1000k。

describe('clampContextWindow', () => {
  it('空值/非法值 → undefined（=未设置）', () => {
    expect(clampContextWindow(undefined)).toBeUndefined();
    expect(clampContextWindow(null)).toBeUndefined();
    expect(clampContextWindow(NaN)).toBeUndefined();
    expect(clampContextWindow(Infinity)).toBeUndefined();
    expect(clampContextWindow(0)).toBeUndefined();
    expect(clampContextWindow(-5)).toBeUndefined();
  });

  it('低于下限钳到 100k，高于上限钳到 1M', () => {
    expect(clampContextWindow(50_000)).toBe(MIN_CONTEXT_WINDOW);
    expect(clampContextWindow(100_000)).toBe(100_000);
    expect(clampContextWindow(2_000_000)).toBe(MAX_CONTEXT_WINDOW);
  });

  it('四舍五入到整数 token', () => {
    expect(clampContextWindow(200_000.4)).toBe(200_000);
    expect(clampContextWindow(200_000.6)).toBe(200_001);
  });
});

describe('resolveContextWindow', () => {
  it('未设置回落到 200k 默认', () => {
    expect(resolveContextWindow(undefined)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindow(null)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindow(0)).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it('已设置时原样生效（经钳制）', () => {
    expect(resolveContextWindow(500_000)).toBe(500_000);
    expect(resolveContextWindow(1_500_000)).toBe(MAX_CONTEXT_WINDOW);
  });
});

describe('挡位吸附', () => {
  it('最近挡位', () => {
    expect(nearestContextWindowStop(100_000)).toBe(100_000);
    expect(nearestContextWindowStop(149_000)).toBe(100_000);
    expect(nearestContextWindowStop(151_000)).toBe(200_000);
    expect(nearestContextWindowStop(600_000)).toBe(500_000);
    expect(nearestContextWindowStop(900_000)).toBe(1_000_000);
    // 非整千的任意输入也能吸附。
    expect(nearestContextWindowStop(320_000)).toBe(300_000);
  });

  it('无障碍步进按挡位前后移动，两端饱和', () => {
    expect(nextContextWindowStop(200_000, 1)).toBe(300_000);
    expect(nextContextWindowStop(1_000_000, 1)).toBe(1_000_000);
    expect(nextContextWindowStop(100_000, -1)).toBe(100_000);
    expect(nextContextWindowStop(350_000, 1)).toBe(500_000); // 350k 最近的挡位是 300k
    expect(nextContextWindowStop(350_000, -1)).toBe(200_000);
  });

  it('轨道位置与挡位互逆', () => {
    expect(contextWindowFraction(100_000)).toBe(0);
    expect(contextWindowFraction(1_000_000)).toBe(1);
    expect(contextWindowFraction(550_000)).toBeCloseTo(0.5, 6);
    expect(contextWindowAtFraction(0)).toBe(100_000);
    expect(contextWindowAtFraction(1)).toBe(1_000_000);
    expect(contextWindowAtFraction(0.5)).toBe(500_000);
    expect(contextWindowAtFraction(-1)).toBe(100_000); // 越界拖出轨道
    expect(contextWindowAtFraction(2)).toBe(1_000_000);
    expect(contextWindowAtFraction(NaN)).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it('挡位表覆盖 100k–1M 且单调递增', () => {
    expect(CONTEXT_WINDOW_STOPS[0]).toBe(MIN_CONTEXT_WINDOW);
    expect(CONTEXT_WINDOW_STOPS[CONTEXT_WINDOW_STOPS.length - 1]).toBe(
      MAX_CONTEXT_WINDOW,
    );
    const sorted = [...CONTEXT_WINDOW_STOPS].sort((a, b) => a - b);
    expect(CONTEXT_WINDOW_STOPS).toEqual(sorted);
  });
});

describe('parseContextWindowK', () => {
  it('接受纯数字与 K 后缀（大小写/空格容错）', () => {
    expect(parseContextWindowK('200')).toBe(200_000);
    expect(parseContextWindowK('200k')).toBe(200_000);
    expect(parseContextWindowK(' 300K ')).toBe(300_000);
    expect(parseContextWindowK('1000')).toBe(1_000_000);
  });

  it('越界输入按 clamp 收敛', () => {
    expect(parseContextWindowK('5')).toBe(100_000);
    expect(parseContextWindowK('9999')).toBe(1_000_000);
    expect(parseContextWindowK('1k')).toBe(100_000);
  });

  it('非法输入返回 undefined（调用方恢复原值）', () => {
    expect(parseContextWindowK('')).toBeUndefined();
    expect(parseContextWindowK('abc')).toBeUndefined();
    expect(parseContextWindowK('0')).toBeUndefined();
    expect(parseContextWindowK('-5')).toBeUndefined();
    expect(parseContextWindowK('1.5')).toBeUndefined();
    expect(parseContextWindowK('k')).toBeUndefined();
  });

  it('与 K 输入框展示值互逆', () => {
    for (const stop of CONTEXT_WINDOW_STOPS) {
      expect(parseContextWindowK(String(contextWindowKValue(stop)))).toBe(stop);
    }
  });
});

describe('formatContextWindow', () => {
  it('K 展示，1M 特判', () => {
    expect(formatContextWindow(100_000)).toBe('100k');
    expect(formatContextWindow(200_000)).toBe('200k');
    expect(formatContextWindow(750_000)).toBe('750k');
    expect(formatContextWindow(1_000_000)).toBe('1M');
    // 非设置值先钳制再展示。
    expect(formatContextWindow(2_000_000)).toBe('1M');
    expect(formatContextWindow(0)).toBe('200k');
  });
});
