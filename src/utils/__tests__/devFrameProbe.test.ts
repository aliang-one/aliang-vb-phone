// devFrameProbe 单测:超阈间隔取证行 + 标记因果对照 + 单例与 release no-op 纪律。
import {
  GAP_THRESHOLD_MS,
  __resetDevFrameProbeForTests,
  perfMark,
  startDevFrameProbe,
} from '../devFrameProbe';

let rafCallbacks: Array<() => void> = [];

beforeEach(() => {
  __resetDevFrameProbeForTests();
  rafCallbacks = [];
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
    cb: () => void,
  ) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  };
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('devFrameProbe', () => {
  it('超阈间隔输出取证行,带最近标记与距今毫秒', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(10_000);
    startDevFrameProbe();
    perfMark('snapshot:321ms');

    now.mockReturnValue(10_000 + GAP_THRESHOLD_MS + 100); // 第一帧:gap 250ms
    expect(rafCallbacks.length).toBe(1);
    rafCallbacks[0]();

    expect(console.log).toHaveBeenCalledTimes(1);
    const line = (console.log as jest.Mock).mock.calls[0][0] as string;
    expect(line).toContain(`js-gap=${GAP_THRESHOLD_MS + 100}ms`);
    expect(line).toContain('after=snapshot:321ms');
    expect(line).toContain(`${GAP_THRESHOLD_MS + 100}ms ago`);

    // 亚阈帧不产生日志,且巡检继续排程
    (console.log as jest.Mock).mockClear();
    now.mockReturnValue(10_000 + GAP_THRESHOLD_MS + 100 + 40);
    rafCallbacks[1]();
    expect(console.log).not.toHaveBeenCalled();
    // 每次巡检帧都重排程:首帧 + 亚阈帧 → 已注册 2 个执行回调,第 3 个在排程。
    expect(rafCallbacks.length).toBe(3);
  });

  it('重复 start 是单例,不叠加巡检回调', () => {
    startDevFrameProbe();
    startDevFrameProbe();
    startDevFrameProbe();
    expect(rafCallbacks.length).toBe(1);
  });

  it('标记刷新后,下一个超阈 gap 归零距标时间', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(20_000);
    startDevFrameProbe();
    perfMark('toast:error:x');
    now.mockReturnValue(20_000 + 5_000);
    perfMark('catchup-commit:+60');
    now.mockReturnValue(20_000 + 5_000 + GAP_THRESHOLD_MS);
    rafCallbacks[0]();
    const line = (console.log as jest.Mock).mock.calls[0][0] as string;
    expect(line).toContain('after=catchup-commit:+60');
    expect(line).toContain(`${GAP_THRESHOLD_MS}ms ago`);
  });
});
