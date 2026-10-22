/**
 * 字符画布交互契约（Task 23 Step 1）。
 *
 * 画布本身是「坐标 → 格子」的映射层，编辑语义在 useAsciiEditing 里。这里
 * 用一个小 harness 把两者接起来，验证 plan 里的两条端到端行为：
 *   - 点一下 → 对应格子变成选中字符；
 *   - 拖一条横线 → 整行填充。
 *
 * 格子尺寸来自**实测文本尺寸**，所以测试先喂一次 onLayout 把 120×135 的
 * 文本布局固定下来（20 列 / 10 行 → 每格 6×13.5），再按像素坐标点。
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ThemeContext } from '../../../theme/ThemeContext';
import { utilityMinimalist } from '../../../theme/themes/utilityMinimalist';

// 全局 gesture-handler mock 只导出 GestureHandlerRootView；画布需要
// Gesture.Pan 的链式 API 与 GestureDetector（与 DrawingScreen 测试同款）。
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

import { AsciiCanvas } from '../AsciiCanvas';
import { useAsciiEditing, type AsciiTool } from '../asciiGrid';

const COLS = 20;
const ROWS = 10;
/** 实测文本布局：20 列 → 每格 6pt；10 行 → 每格 13.5pt。 */
const TEXT_WIDTH = 120;
const TEXT_HEIGHT = 135;
const CELL_W = TEXT_WIDTH / COLS;
const CELL_H = TEXT_HEIGHT / ROWS;

/** 把画布与编辑状态机接起来的最小宿主。 */
const Harness: React.FC<{ tool: AsciiTool; char: string }> = ({
  tool,
  char,
}) => {
  const editing = useAsciiEditing(COLS, ROWS);
  return (
    <AsciiCanvas
      grid={editing.grid}
      onStrokeStart={cell => editing.beginStroke(cell, tool, char)}
      onStrokeMove={cell => editing.moveStroke(cell, tool, char)}
      onStrokeEnd={cell => editing.endStroke(cell, tool, char)}
    />
  );
};

const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeContext.Provider
    value={{
      theme: utilityMinimalist,
      mode: 'light',
      setMode: jest.fn(),
      isDark: false,
    }}>
    {children}
  </ThemeContext.Provider>
);

const renderCanvas = async (tool: AsciiTool, char: string) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <Providers>
        <Harness tool={tool} char={char} />
      </Providers>,
    );
    await Promise.resolve();
  });
  return renderer!;
};

const byTestID = (
  renderer: ReactTestRenderer.ReactTestRenderer,
  testID: string,
) => renderer.root.findAll(node => node.props?.testID === testID)[0];

/** 固定可用区域与文本实测尺寸，让格子映射可预测。 */
const layoutCanvas = (renderer: ReactTestRenderer.ReactTestRenderer) => {
  const touchLayer = byTestID(renderer, 'ascii-canvas');
  act(() => {
    touchLayer.props.onLayout({
      nativeEvent: { layout: { width: TEXT_WIDTH, height: TEXT_HEIGHT } },
    });
  });
};

/** 读取当前渲染出来的整块文本。 */
const renderedText = (renderer: ReactTestRenderer.ReactTestRenderer): string =>
  byTestID(renderer, 'ascii-text').props.children as string;

const rowText = (
  renderer: ReactTestRenderer.ReactTestRenderer,
  y: number,
): string => renderedText(renderer).split('\n')[y];

/** 格子中心对应的像素坐标。 */
const pointOf = (x: number, y: number) => ({
  x: x * CELL_W + CELL_W / 2,
  y: y * CELL_H + CELL_H / 2,
});

const tapCell = async (x: number, y: number) => {
  const point = pointOf(x, y);
  await act(async () => {
    mockGestureHandlers.onBegin?.(point);
    mockGestureHandlers.onEnd?.(point);
  });
};

const dragCells = async (
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  const start = pointOf(from.x, from.y);
  const end = pointOf(to.x, to.y);
  await act(async () => {
    mockGestureHandlers.onBegin?.(start);
    mockGestureHandlers.onUpdate?.(end);
    mockGestureHandlers.onEnd?.(end);
  });
};

beforeEach(() => {
  for (const key of Object.keys(mockGestureHandlers)) {
    delete mockGestureHandlers[key];
  }
});

describe('AsciiCanvas', () => {
  it('点一下 → 对应格子变成选中字符', async () => {
    const renderer = await renderCanvas('text', 'X');
    layoutCanvas(renderer);

    await tapCell(3, 2);

    expect(rowText(renderer, 2)[3]).toBe('X');
    // 只落一格，周围保持空白。
    expect(rowText(renderer, 2)).toBe('   X' + ' '.repeat(COLS - 4));

    act(() => renderer.unmount());
  });

  it('拖一条横线 → 整行填充（含两端）', async () => {
    const renderer = await renderCanvas('hline', '─');
    layoutCanvas(renderer);

    await dragCells({ x: 1, y: 4 }, { x: 6, y: 4 });

    expect(rowText(renderer, 4)).toBe(
      ' ' + '─'.repeat(6) + ' '.repeat(COLS - 7),
    );
    expect(rowText(renderer, 3)).toBe(' '.repeat(COLS));

    act(() => renderer.unmount());
  });

  it('拖出画布边界时坐标夹到最后一格，不越界崩溃', async () => {
    const renderer = await renderCanvas('text', 'X');
    layoutCanvas(renderer);

    await act(async () => {
      mockGestureHandlers.onBegin?.({ x: 10_000, y: 10_000 });
      mockGestureHandlers.onEnd?.({ x: 10_000, y: 10_000 });
    });

    expect(rowText(renderer, ROWS - 1)[COLS - 1]).toBe('X');

    act(() => renderer.unmount());
  });
});
