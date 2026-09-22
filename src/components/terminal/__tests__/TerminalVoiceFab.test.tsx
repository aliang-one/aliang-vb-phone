// TerminalVoiceFab 手势状态机 + logo 恒定渲染(spec 2026-09-22)。
// 仓库惯例:react-test-renderer + act,直接调实例 props 上的回调。Pressable
// 的按压语义用 props.onPressIn / props.onPressOut 直呼模拟,fake timers 推进
// 长按阈值(测试传 100ms 短阈值)。
// 定位说明(偏离计划逐字稿的两处,均为环境事实,组件零改):RN 的 Pressable
// 是 memo 包裹的,findByType(Pressable) 永远匹配不到(仓库既有先例
// FileLongPressMenu.test.tsx:103),改用 FAB 恒定 testID 定位,onPressIn/
// onPressOut/disabled 就在该节点 props 上;脉冲 Animated.View 因
// createAnimatedComponent 的 props 透传会扇出 3 个带同 testID 的节点,
// 断言用「存在/不存在」而非计数。
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator } from 'react-native';
import { TerminalVoiceFab } from '../TerminalVoiceFab';
import { Logo } from '../../visual/Logo';
import { darkTheme } from '../../../theme/themes/darkTheme';

type FabProps = React.ComponentProps<typeof TerminalVoiceFab>;

const renderFab = (overrides: Partial<FabProps> = {}) => {
  const props: FabProps = {
    phase: 'idle',
    disabled: false,
    onShortPress: jest.fn(),
    onHoldStart: jest.fn(),
    onHoldEnd: jest.fn(),
    holdThresholdMs: 100,
    ...overrides,
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<TerminalVoiceFab {...props} />);
  });
  return { renderer, props };
};

// Pressable 是 memo 包裹的,findByType 不匹配(见文件头注释)——用 FAB
// 恒定 testID 定位,onPressIn/onPressOut/disabled 都在该节点 props 上。
const pressableOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findByProps({ testID: 'terminal-voice-fab' });

describe('TerminalVoiceFab 手势状态机', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('短按(阈值内松开)→ 只触发 onShortPress', () => {
    const { renderer, props } = renderFab();
    const pressable = pressableOf(renderer);
    act(() => pressable.props.onPressIn());
    act(() => jest.advanceTimersByTime(50));
    act(() => pressable.props.onPressOut());
    expect(props.onShortPress).toHaveBeenCalledTimes(1);
    expect(props.onHoldStart).not.toHaveBeenCalled();
    expect(props.onHoldEnd).not.toHaveBeenCalled();
  });

  it('长按(≥阈值)→ pressIn 侧触发 onHoldStart,松开触发 onHoldEnd,不触发 onShortPress', () => {
    const { renderer, props } = renderFab();
    const pressable = pressableOf(renderer);
    act(() => pressable.props.onPressIn());
    act(() => jest.advanceTimersByTime(100));
    expect(props.onHoldStart).toHaveBeenCalledTimes(1);
    act(() => pressable.props.onPressOut());
    expect(props.onHoldEnd).toHaveBeenCalledTimes(1);
    expect(props.onShortPress).not.toHaveBeenCalled();
  });

  it('阈值差一点松开仍算短按', () => {
    const { renderer, props } = renderFab();
    const pressable = pressableOf(renderer);
    act(() => pressable.props.onPressIn());
    act(() => jest.advanceTimersByTime(99));
    act(() => pressable.props.onPressOut());
    expect(props.onShortPress).toHaveBeenCalledTimes(1);
    expect(props.onHoldStart).not.toHaveBeenCalled();
  });

  it('无配对 pressIn 的 pressOut 是 no-op', () => {
    const { renderer, props } = renderFab();
    act(() => pressableOf(renderer).props.onPressOut());
    expect(props.onShortPress).not.toHaveBeenCalled();
    expect(props.onHoldStart).not.toHaveBeenCalled();
    expect(props.onHoldEnd).not.toHaveBeenCalled();
  });

  it('长按期间多次 advance 只触发一次 onHoldStart;松开只触发一次 onHoldEnd', () => {
    const { renderer, props } = renderFab();
    const pressable = pressableOf(renderer);
    act(() => pressable.props.onPressIn());
    act(() => jest.advanceTimersByTime(500));
    act(() => jest.advanceTimersByTime(500));
    expect(props.onHoldStart).toHaveBeenCalledTimes(1);
    act(() => pressable.props.onPressOut());
    act(() => pressableOf(renderer).props.onPressOut());
    expect(props.onHoldEnd).toHaveBeenCalledTimes(1);
  });

  it('按压中卸载 → 不触发任何回调(计时器随卸载清理)', () => {
    const { renderer, props } = renderFab();
    const pressable = pressableOf(renderer);
    act(() => pressable.props.onPressIn());
    act(() => renderer.unmount());
    act(() => jest.advanceTimersByTime(500));
    expect(props.onHoldStart).not.toHaveBeenCalled();
    expect(props.onHoldEnd).not.toHaveBeenCalled();
    expect(props.onShortPress).not.toHaveBeenCalled();
  });

  it('disabled → Pressable 收到 disabled 且直接调用回调也被短路', () => {
    const { renderer, props } = renderFab({ disabled: true });
    expect(pressableOf(renderer).props.disabled).toBe(true);
    act(() => pressableOf(renderer).props.onPressIn());
    act(() => jest.advanceTimersByTime(200));
    act(() => pressableOf(renderer).props.onPressOut());
    expect(props.onShortPress).not.toHaveBeenCalled();
    expect(props.onHoldStart).not.toHaveBeenCalled();
    expect(props.onHoldEnd).not.toHaveBeenCalled();
  });
});

describe('TerminalVoiceFab 渲染:logo 恒定', () => {
  // recording 相位的 Animated.loop 只有卸载才 stop;不卸载会让 jest 主进程
  // 事件循环挂着退不出去(「Jest did not exit」),故跟踪并逐个卸载。
  const mounted: TestRenderer.ReactTestRenderer[] = [];
  afterEach(() => {
    for (const r of mounted.splice(0)) act(() => r.unmount());
  });
  const renderTrackedFab = (overrides: Partial<FabProps> = {}) => {
    const out = renderFab(overrides);
    mounted.push(out.renderer);
    return out;
  };

  it('idle/recording/generating/error 四相位 logo 都在,不因相位消失', () => {
    const phases: FabProps['phase'][] = ['idle', 'recording', 'generating', 'error'];
    for (const phase of phases) {
      const { renderer } = renderTrackedFab({ phase });
      expect(renderer.root.findAllByType(Logo)).toHaveLength(1);
    }
  });

  it('generating 才出现角标 spinner,其余相位没有', () => {
    const { renderer } = renderTrackedFab({ phase: 'idle' });
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    const gen = renderTrackedFab({ phase: 'generating' });
    expect(gen.renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  });

  it('recording 出现脉冲叠层,idle 没有(spec §6 渲染断言)', () => {
    const idle = renderTrackedFab({ phase: 'idle' });
    expect(idle.renderer.root.findAllByProps({ testID: 'terminal-voice-fab-pulse' })).toHaveLength(0);
    const rec = renderTrackedFab({ phase: 'recording' });
    // Animated.View 扇出 3 个带同 testID 的节点(见文件头注释),断存在性。
    expect(rec.renderer.root.findAllByProps({ testID: 'terminal-voice-fab-pulse' }).length).toBeGreaterThan(0);
  });

  // 以下四条移植自被删除的旧根级测试(2026-09-22 评审):颜色/动效不能是
  // 唯一指示,相位还要有 a11y 播报;红边红底与 busy 态是主相位视觉。
  // 渲染走 renderTrackedFab(非裸 renderFab):recording 的 Animated.loop
  // 只有卸载才 stop,不跟踪卸载会让 jest 挂着退不出(见本 describe 头注释)。
  it('recording/error 相位无障碍标签随相位播报', () => {
    const rec = renderTrackedFab({ phase: 'recording' });
    expect(pressableOf(rec.renderer).props.accessibilityLabel).toContain('正在聆听…');
    const err = renderTrackedFab({ phase: 'error' });
    expect(pressableOf(err.renderer).props.accessibilityLabel).toContain('语音识别失败');
  });

  it('recording 样式含主题 error 色(红边红底)', () => {
    const rec = renderTrackedFab({ phase: 'recording' });
    expect(JSON.stringify(pressableOf(rec.renderer).props.style)).toContain(darkTheme.colors.error);
  });

  it('generating 相位 accessibilityState.busy=true,其余相位 false', () => {
    const gen = renderTrackedFab({ phase: 'generating' });
    expect(pressableOf(gen.renderer).props.accessibilityState).toEqual({
      disabled: false,
      busy: true,
    });
    const idle = renderTrackedFab({ phase: 'idle' });
    expect(pressableOf(idle.renderer).props.accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });
  });

  it('generating 无脉冲叠层', () => {
    const gen = renderTrackedFab({ phase: 'generating' });
    expect(gen.renderer.root.findAllByProps({ testID: 'terminal-voice-fab-pulse' })).toHaveLength(0);
  });
});
