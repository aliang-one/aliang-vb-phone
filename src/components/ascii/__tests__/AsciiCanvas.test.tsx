/**
 * 字符画布交互契约（Task 23 Step 1；2026-10-23 随 PanResponder 改版更新）。
 *
 * 画布本身是「坐标 → 格子」的映射层，编辑语义在 useAsciiEditing 里。这里
 * 用一个小 harness 把两者接起来，验证核心端到端行为：
 *   - 点一下 → 对应格子变成选中字符；
 *   - 拖一条横线 → 整行填充；
 *   - auto 工具按拖动方向自动选字符；
 *   - 越界坐标夹回画布，不崩溃。
 *
 * 手势已从 RNGH 换成 RN 原生 PanResponder（iOS 26 真机上 RNGH 回调不触发），
 * 测试直接驱动 panHandlers 的回调，无需再 mock 手势库。
 *
 * 格子尺寸来自**实测文本尺寸**，所以测试先喂一次 onLayout 把 120×135 的
 * 文本布局固定下来（20 列 / 10 行 → 每格 6×13.5），再按像素坐标点。
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ThemeContext } from '../../../theme/ThemeContext';
import { utilityMinimalist } from '../../../theme/themes/utilityMinimalist';

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

const responderOf = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  byTestID(renderer, 'ascii-canvas').props;

/** PanResponder 暴露的是 responder 协议名；move 有 touchHistory 时间戳去重。
 *  touchHistory 按 RN 约定 1-indexed（touchBank[0] 为 null）。 */
let fakeTouchClock = 0;
const touch = (point: { x: number; y: number }) => {
  fakeTouchClock += 1;
  const stamp = fakeTouchClock;
  return {
    nativeEvent: { locationX: point.x, locationY: point.y },
    touchHistory: {
      mostRecentTimeStamp: stamp,
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 1,
      touchBank: [
        null,
        {
          touchActive: true,
          currentTimeStamp: stamp,
          previousTimeStamp: stamp,
          currentPageX: point.x,
          currentPageY: point.y,
          previousPageX: point.x,
          previousPageY: point.y,
        },
      ],
    },
  };
};

const tapCell = async (renderer: ReactTestRenderer.ReactTestRenderer, x: number, y: number) => {
  const responder = responderOf(renderer);
  const point = pointOf(x, y);
  await act(async () => {
    responder.onResponderGrant?.(touch(point));
    responder.onResponderRelease?.(touch(point));
  });
};

const dragCells = async (
  renderer: ReactTestRenderer.ReactTestRenderer,
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  const responder = responderOf(renderer);
  const start = pointOf(from.x, from.y);
  const end = pointOf(to.x, to.y);
  await act(async () => {
    responder.onResponderGrant?.(touch(start));
    responder.onResponderMove?.(touch(end));
    responder.onResponderRelease?.(touch(end));
  });
};

describe('AsciiCanvas', () => {
  it('点一下 → 对应格子变成选中字符', async () => {
    const renderer = await renderCanvas('text', 'X');
    layoutCanvas(renderer);

    await tapCell(renderer, 3, 2);

    expect(rowText(renderer, 2)[3]).toBe('X');
    // 只落一格，周围保持空白。
    expect(rowText(renderer, 2)).toBe('   X' + ' '.repeat(COLS - 4));

    act(() => renderer.unmount());
  });

  it('拖一条横线 → 整行填充（含两端）', async () => {
    const renderer = await renderCanvas('hline', '─');
    layoutCanvas(renderer);

    await dragCells(renderer, { x: 1, y: 4 }, { x: 6, y: 4 });

    expect(rowText(renderer, 4)).toBe(
      ' ' + '─'.repeat(6) + ' '.repeat(COLS - 7),
    );
    expect(rowText(renderer, 3)).toBe(' '.repeat(COLS));

    act(() => renderer.unmount());
  });

  it('auto 工具：向右拖 → 整行 ─；向下拖 → 整列 │', async () => {
    const renderer = await renderCanvas('auto', '?');
    layoutCanvas(renderer);

    await dragCells(renderer, { x: 1, y: 1 }, { x: 4, y: 1 });
    expect(rowText(renderer, 1).slice(1, 5)).toBe('────');

    await dragCells(renderer, { x: 1, y: 1 }, { x: 1, y: 3 });
    expect(rowText(renderer, 2)[1]).toBe('│');
    expect(rowText(renderer, 3)[1]).toBe('│');

    act(() => renderer.unmount());
  });

  it('auto 工具：斜拖按方向取 ╱ ╲', async () => {
    const renderer = await renderCanvas('auto', '?');
    layoutCanvas(renderer);

    await dragCells(renderer, { x: 2, y: 2 }, { x: 4, y: 4 });
    expect(rowText(renderer, 2)[2]).toBe('╲');
    expect(rowText(renderer, 3)[3]).toBe('╲');
    expect(rowText(renderer, 4)[4]).toBe('╲');

    await dragCells(renderer, { x: 12, y: 2 }, { x: 14, y: 4 });
    expect(rowText(renderer, 2)[12]).toBe('╲');

    const downLeft = await renderCanvas('auto', '?');
    layoutCanvas(downLeft);
    await dragCells(downLeft, { x: 14, y: 2 }, { x: 12, y: 4 });
    expect(rowText(downLeft, 3)[13]).toBe('╱');

    act(() => renderer.unmount());
    act(() => downLeft.unmount());
  });

  it('拖出画布边界时坐标夹到最后一格，不越界崩溃', async () => {
    const renderer = await renderCanvas('text', 'X');
    layoutCanvas(renderer);

    const responder = responderOf(renderer);
    const far = { x: 10_000, y: 10_000 };
    await act(async () => {
      responder.onResponderGrant?.(touch(far));
      responder.onResponderRelease?.(touch(far));
    });

    expect(rowText(renderer, ROWS - 1)[COLS - 1]).toBe('X');

    act(() => renderer.unmount());
  });

  it('布局后渲染方格背景（Svg、不挡触摸）', async () => {
    const renderer = await renderCanvas('auto', '?');
    const svgNodes = () =>
      renderer.root.findAll(
        node => typeof node.type === 'string' && /svg/i.test(node.type),
      );
    expect(svgNodes().length).toBe(0);
    layoutCanvas(renderer);
    expect(svgNodes().length).toBeGreaterThan(0);
    expect(svgNodes()[0]!.props.pointerEvents).toBe('none');
    act(() => renderer.unmount());
  });
});
