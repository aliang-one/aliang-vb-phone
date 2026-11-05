/**
 * 字符画布交互契约（Task 23 Step 1；2026-10-23 随 PanResponder 改版更新；
 * 2026-10-30「先涂抹后生成」改版）。
 *
 * 画布本身是「坐标 → 格子」的映射层，编辑语义在 useAsciiEditing 里。这里
 * 用一个小 harness 把两者接起来，验证核心端到端行为：
 *   - 文字工具点一下 → 对应格子变成选中字符；
 *   - 手绘拖动过程**不落字**，只有涂抹高亮层；松手按完整轨迹生成 ─│╱╲；
 *   - 撤销：一笔收笔后撤销，画布回到该笔之前；
 *   - 无效笔画（橡皮在空白处拖）不入撤销栈；
 *   - 越界坐标夹回画布，不崩溃。
 *
 * 手势用 RN 原生 PanResponder（iOS 26 真机上 RNGH 回调不触发），测试直接
 * 驱动 panHandlers 的回调，无需 mock 手势库。
 *
 * 格子尺寸由 fontSize 推导（触摸层显式定尺寸，不依赖文本测量——iOS 测量
 * 全空格 Text 会剥行尾空白导致宽度塌缩为 0）。测试喂容器 onLayout
 * 360×405：fontSize = min(352/20/0.6, 397/10/1.35, 14) = 14，
 * cellWidth = 8.4，lineHeight = 19。
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ThemeContext } from '../../../theme/ThemeContext';
import { utilityMinimalist } from '../../../theme/themes/utilityMinimalist';

import { AsciiCanvas } from '../AsciiCanvas';
import { useAsciiEditing, type AsciiEditing, type AsciiTool } from '../asciiGrid';

const COLS = 20;
const ROWS = 10;
/** 喂给容器的可用区域；fontSize 推导出的格宽/行高（见文件头注释）。 */
const FRAME_WIDTH = 360;
const FRAME_HEIGHT = 405;
const CELL_W = 8.4; // fontSize 14 × 0.6
const CELL_H = 19;  // round(14 × 1.35)

type EditingRef = { current: AsciiEditing | null };

/** 把画布与编辑状态机接起来的最小宿主（editingRef 供断言撤销状态）。 */
const Harness: React.FC<{ tool: AsciiTool; char: string; editingRef?: EditingRef }> = ({
  tool,
  char,
  editingRef,
}) => {
  const editing = useAsciiEditing(COLS, ROWS);
  if (editingRef) editingRef.current = editing;
  return (
    <AsciiCanvas
      grid={editing.grid}
      pending={editing.pendingCells}
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

const renderCanvas = async (
  tool: AsciiTool,
  char: string,
  editingRef?: EditingRef,
) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <Providers>
        <Harness tool={tool} char={char} editingRef={editingRef} />
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

const hasTestID = (
  renderer: ReactTestRenderer.ReactTestRenderer,
  testID: string,
) =>
  renderer.root.findAll(node => node.props?.testID === testID).length > 0;

/** 固定容器可用区域，让格子映射可预测。 */
const layoutCanvas = (renderer: ReactTestRenderer.ReactTestRenderer) => {
  const frame = byTestID(renderer, 'ascii-canvas-frame');
  act(() => {
    frame.props.onLayout({
      nativeEvent: { layout: { width: FRAME_WIDTH, height: FRAME_HEIGHT } },
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

/** 拖到一半停住（grant + move，不 release），测「涂抹中」状态。 */
const dragHalfway = async (
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
  });
};

describe('AsciiCanvas', () => {
  it('文字工具点一下 → 对应格子变成选中字符', async () => {
    const renderer = await renderCanvas('text', 'X');
    layoutCanvas(renderer);

    await tapCell(renderer, 3, 2);

    expect(rowText(renderer, 2)[3]).toBe('X');
    // 只落一格，周围保持空白。
    expect(rowText(renderer, 2)).toBe('   X' + ' '.repeat(COLS - 4));

    act(() => renderer.unmount());
  });

  it('手绘拖动过程不落字，只有涂抹高亮；松手按轨迹生成 ─', async () => {
    const renderer = await renderCanvas('freehand', '?');
    layoutCanvas(renderer);

    await dragHalfway(renderer, { x: 1, y: 4 }, { x: 6, y: 4 });

    // 涂抹中：字符网格原封不动，高亮层出现。
    expect(rowText(renderer, 4)).toBe(' '.repeat(COLS));
    expect(hasTestID(renderer, 'ascii-pending-overlay')).toBe(true);

    await act(async () => {
      responderOf(renderer).onResponderRelease?.(touch(pointOf(6, 4)));
    });

    // 松手：高亮层消失，整段 ─（含两端）一次生成。
    expect(hasTestID(renderer, 'ascii-pending-overlay')).toBe(false);
    expect(rowText(renderer, 4)).toBe(
      ' ' + '─'.repeat(6) + ' '.repeat(COLS - 7),
    );
    expect(rowText(renderer, 3)).toBe(' '.repeat(COLS));

    act(() => renderer.unmount());
  });

  it('手绘：向右拖 → ─；向下拖 → │', async () => {
    const renderer = await renderCanvas('freehand', '?');
    layoutCanvas(renderer);

    await dragCells(renderer, { x: 1, y: 1 }, { x: 4, y: 1 });
    expect(rowText(renderer, 1).slice(1, 5)).toBe('────');

    await dragCells(renderer, { x: 1, y: 1 }, { x: 1, y: 3 });
    expect(rowText(renderer, 2)[1]).toBe('│');
    expect(rowText(renderer, 3)[1]).toBe('│');

    act(() => renderer.unmount());
  });

  it('手绘：斜拖按方向取 ╱ ╲', async () => {
    const renderer = await renderCanvas('freehand', '?');
    layoutCanvas(renderer);

    await dragCells(renderer, { x: 2, y: 2 }, { x: 4, y: 4 });
    expect(rowText(renderer, 2)[2]).toBe('╲');
    expect(rowText(renderer, 3)[3]).toBe('╲');
    expect(rowText(renderer, 4)[4]).toBe('╲');

    const downLeft = await renderCanvas('freehand', '?');
    layoutCanvas(downLeft);
    await dragCells(downLeft, { x: 14, y: 2 }, { x: 12, y: 4 });
    expect(rowText(downLeft, 3)[13]).toBe('╱');

    act(() => renderer.unmount());
    act(() => downLeft.unmount());
  });

  it('一笔收笔记一步撤销；撤销后画布回到该笔之前', async () => {
    const editingRef: EditingRef = { current: null };
    const renderer = await renderCanvas('freehand', '?', editingRef);
    layoutCanvas(renderer);

    expect(editingRef.current!.canUndo).toBe(false);
    await dragCells(renderer, { x: 1, y: 1 }, { x: 4, y: 1 });
    expect(rowText(renderer, 1).slice(1, 5)).toBe('────');
    expect(editingRef.current!.canUndo).toBe(true);

    await act(async () => {
      editingRef.current!.undo();
    });
    expect(rowText(renderer, 1)).toBe(' '.repeat(COLS));
    expect(editingRef.current!.canUndo).toBe(false);
    expect(editingRef.current!.canRedo).toBe(true);

    act(() => renderer.unmount());
  });

  it('无效笔画（橡皮拖过空白）不入撤销栈', async () => {
    const editingRef: EditingRef = { current: null };
    const renderer = await renderCanvas('eraser', '─', editingRef);
    layoutCanvas(renderer);

    await dragCells(renderer, { x: 2, y: 2 }, { x: 5, y: 2 });

    expect(editingRef.current!.canUndo).toBe(false);

    act(() => renderer.unmount());
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
    const renderer = await renderCanvas('freehand', '?');
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
