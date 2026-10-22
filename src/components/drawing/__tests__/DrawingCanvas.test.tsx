/**
 * 画布与笔迹契约（Task 20）。
 *
 * 四条不变量（plan Step 1）：
 *   - 画一笔 → 只有一条笔迹（一次手势 = 一条 Path）；
 *   - 撤销 → 长度 -1；重做 → 恢复；
 *   - 新笔迹后重做栈清空；
 *   - 抽稀：连续 1px 位移不新增点。
 *
 * 手势回调通过本地 mock 捕获：jest.setup 的全局 gesture-handler mock 只导出
 * GestureHandlerRootView，而画布需要 Gesture.Pan 链式 API 与 GestureDetector。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';
import { Path } from 'react-native-svg';

// eslint-disable-next-line @typescript-eslint/ban-types
const mockGestureHandlers: Record<string, Function> = {};

jest.mock('react-native-gesture-handler', () => {
  const ReactInner = require('react');
  const { View } = require('react-native');
  const chain = () => {
    const gesture: Record<string, unknown> = {};
    for (const method of [
      'minDistance',
      'runOnJS',
      'onBegin',
      'onUpdate',
      'onEnd',
      'onFinalize',
    ]) {
      gesture[method] = (arg?: unknown) => {
        if (typeof arg === 'function') {
          mockGestureHandlers[method] = arg;
        }
        return gesture;
      };
    }
    return gesture;
  };
  return {
    GestureHandlerRootView: ReactInner.forwardRef(
      (props: Record<string, unknown>, ref: unknown) =>
        ReactInner.createElement(View, { ...props, ref }),
    ),
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    Gesture: { Pan: chain, Tap: chain, LongPress: chain },
  };
});

import { DrawingCanvas } from '../DrawingCanvas';
import {
  beginStroke,
  clearStrokes,
  extendStroke,
  initialDrawingState,
  pushPoint,
  redoStroke,
  undoStroke,
  useDrawingState,
  type DrawingStroke,
} from '../drawingModel';

const strokeOf = (points: { x: number; y: number }[] = [{ x: 0, y: 0 }]): DrawingStroke => ({
  id: 's1',
  color: '#111827',
  width: 4,
  points,
});

/** 把 hook 与画布接起来，模拟屏幕里的真实组合。 */
const Harness: React.FC = () => {
  const drawing = useDrawingState();
  return (
    <>
      <DrawingCanvas
        strokes={drawing.strokes}
        color="#111827"
        width={4}
        onStrokeBegin={drawing.begin}
        onStrokeExtend={drawing.extend}
      />
      <Text testID="stroke-count">{String(drawing.strokes.length)}</Text>
      <Pressable testID="undo" onPress={drawing.undo} />
      <Pressable testID="redo" onPress={drawing.redo} />
    </>
  );
};

// 取组合组件节点（不是 host 节点）：Pressable 的 onPress 只在组合层上，
// host View 拿不到。深度优先下组合节点先于其 host 节点出现。
const findById = (renderer: TestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props?.testID === testID)[0];

const countPaths = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(Path).length;

const countOf = (renderer: TestRenderer.ReactTestRenderer) =>
  findById(renderer, 'stroke-count').props.children;

beforeEach(() => {
  for (const key of Object.keys(mockGestureHandlers)) delete mockGestureHandlers[key];
});

describe('画布手势', () => {
  it('画一笔 → 一条笔迹、一条 Path', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<Harness />);
    });

    await act(async () => {
      mockGestureHandlers.onBegin?.({ x: 10, y: 10 });
    });
    await act(async () => {
      mockGestureHandlers.onUpdate?.({ x: 40, y: 50 });
    });
    await act(async () => {
      mockGestureHandlers.onUpdate?.({ x: 80, y: 90 });
      mockGestureHandlers.onEnd?.();
    });

    expect(countOf(renderer)).toBe('1');
    expect(countPaths(renderer)).toBe(1);

    const path = renderer.root.findAllByType(Path)[0];
    expect(path.props.d).toBe('M 10 10 L 40 50 L 80 90');
    expect(path.props.stroke).toBe('#111827');
    expect(path.props.strokeWidth).toBe(4);

    act(() => renderer.unmount());
  });

  it('抬手后的迟到 update 不会续到新笔迹上', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<Harness />);
    });

    await act(async () => {
      mockGestureHandlers.onBegin?.({ x: 10, y: 10 });
      mockGestureHandlers.onEnd?.();
    });
    await act(async () => {
      // 手势已结束，迟到的 update 应被忽略（activeStrokeId 已清空）。
      mockGestureHandlers.onUpdate?.({ x: 99, y: 99 });
    });

    const path = renderer.root.findAllByType(Path)[0];
    expect(path.props.d).toBe('M 10 10 L 10 10');

    act(() => renderer.unmount());
  });
});

describe('撤销 / 重做', () => {
  it('撤销 -1，重做恢复', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<Harness />);
    });
    await act(async () => {
      mockGestureHandlers.onBegin?.({ x: 10, y: 10 });
      mockGestureHandlers.onUpdate?.({ x: 50, y: 50 });
      mockGestureHandlers.onEnd?.();
    });
    expect(countOf(renderer)).toBe('1');

    await act(async () => {
      findById(renderer, 'undo').props.onPress();
    });
    expect(countOf(renderer)).toBe('0');
    expect(countPaths(renderer)).toBe(0);

    await act(async () => {
      findById(renderer, 'redo').props.onPress();
    });
    expect(countOf(renderer)).toBe('1');

    act(() => renderer.unmount());
  });

  it('新笔迹清空重做栈', () => {
    let state = beginStroke(initialDrawingState, strokeOf());
    state = undoStroke(state);
    expect(state.redoStack).toHaveLength(1);

    state = beginStroke(state, { ...strokeOf(), id: 's2' });
    expect(state.redoStack).toHaveLength(0);
    // 此时「重做」应是无操作。
    expect(redoStroke(state)).toBe(state);
  });

  it('清空画布同时清掉重做栈', () => {
    let state = beginStroke(initialDrawingState, strokeOf());
    state = undoStroke(state);
    state = clearStrokes(state);
    expect(state.strokes).toHaveLength(0);
    expect(state.redoStack).toHaveLength(0);
  });
});

describe('抽稀', () => {
  it('连续 1px 位移不新增点；超过 2px 才记一个点', () => {
    const points = pushPoint([{ x: 0, y: 0 }], { x: 1, y: 0 });
    expect(points).toHaveLength(1);

    const grown = pushPoint(points, { x: 3, y: 0 });
    expect(grown).toHaveLength(2);
    expect(grown[1]).toEqual({ x: 3, y: 0 });
  });

  it('extendStroke 抽稀后引用不变（不触发重渲染）', () => {
    let state = beginStroke(initialDrawingState, strokeOf());
    const before = state.strokes[0].points;
    state = extendStroke(state, 's1', { x: 0.5, y: 0.5 });
    expect(state.strokes[0].points).toBe(before);
  });
});
