import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { ContextWindowSlider } from '../ContextWindowSlider';

// 组件级契约：滑轨本体靠手势（react-test-renderer 无法模拟 PanResponder 的
// 原生触摸），但两条最容易回归的通道可以直调 props：
//  · K 输入框失焦提交 → onChange(解析后的 tokens)，非法输入恢复原值；
//  · 无障碍 increment/decrement → 按挡位步进。
// 主题用 ThemeContext 的 darkTheme 默认值（useTheme 不依赖 Provider）。

const renderSlider = (value: number, onChange = jest.fn()) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ContextWindowSlider
        value={value}
        onChange={onChange}
        label="Context window"
        testID="ctx-slider"
      />,
    );
  });
  // testID 会同时落在组件元素（<ContextWindowSlider testID>) 与轨道 View 上，
  // 因此按无障碍角色定位轨道本体，避免误取组件元素。
  const input = () => renderer.root.findByType(TextInput);
  const track = () =>
    renderer.root.findAll(
      node =>
        node.props.accessibilityRole === 'adjustable' &&
        typeof node.props.onAccessibilityAction === 'function',
    )[0];
  return { renderer, onChange, input, track };
};

describe('ContextWindowSlider', () => {
  it('K 输入框失焦提交：200 → 200000', () => {
    const { input, onChange } = renderSlider(300_000);
    act(() => input().props.onFocus());
    act(() => input().props.onChangeText('200'));
    act(() => input().props.onBlur());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(200_000);
    expect(input().props.value).toBe('200');
  });

  it('越界输入按 clamp 收敛：5 → 100000', () => {
    const { input, onChange } = renderSlider(200_000);
    act(() => input().props.onFocus());
    act(() => input().props.onChangeText('5'));
    act(() => input().props.onBlur());
    expect(onChange).toHaveBeenCalledWith(100_000);
    expect(input().props.value).toBe('100');
  });

  it('非法输入恢复原值且不触发 onChange', () => {
    const { input, onChange } = renderSlider(500_000);
    act(() => input().props.onFocus());
    act(() => input().props.onChangeText('abc'));
    act(() => input().props.onBlur());
    expect(onChange).not.toHaveBeenCalled();
    expect(input().props.value).toBe('500');
  });

  it('无障碍步进：increment/decrement 按挡位移动', () => {
    const { track, onChange } = renderSlider(200_000);
    act(() =>
      track().props.onAccessibilityAction({
        nativeEvent: { actionName: 'increment' },
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith(300_000);
    act(() =>
      track().props.onAccessibilityAction({
        nativeEvent: { actionName: 'decrement' },
      }),
    );
    // 组件内部 ref 记住「最后一次发出的值」：父组件在本测试里不回灌 prop，
    // 第二次步进仍基于 300k 后退到 200k（真实调用方都会 setState 回灌）。
    expect(onChange).toHaveBeenLastCalledWith(200_000);
    expect(track().props.accessibilityValue.now).toBe(200);
  });

  it('disabled 时输入框不可编辑、无障碍状态同步', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ContextWindowSlider
          value={200_000}
          onChange={jest.fn()}
          label="Context window"
          disabled
          testID="ctx-slider"
        />,
      );
    });
    const input = renderer.root.findByType(TextInput);
    expect(input.props.editable).toBe(false);
    expect(
      renderer.root.findAll(
        node =>
          node.props.accessibilityRole === 'adjustable' &&
          typeof node.props.onAccessibilityAction === 'function',
      )[0].props.accessibilityState,
    ).toEqual({ disabled: true });
  });
});
