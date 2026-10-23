import { useCallback, useRef, useState } from 'react';

/**
 * ASCII 字符网格模型（Task 22）。
 *
 * 纯函数 + 不可变更新：每次编辑返回新 grid，旧引用不动。网格很小
 * （默认 60×30，最大 120×60），整表复制比做结构共享简单得多，也避免了
 * 「改了单元格但列表不刷新」这类难查的问题。
 *
 * 每个 cell 恒为**单个字符**（空位是空格），这样 `row.join('')` 得到的
 * 就是严格 cols 列的行——等宽字体下所有行列才能对齐。裁剪/导出都依赖
 * 这个不变量。
 *
 * 坐标系：x 向右、y 向下，原点在左上角，与触摸事件的屏幕坐标一致。
 */

export interface AsciiGrid {
  cols: number;
  rows: number;
  cells: string[][];
}

/** 单字符格；空位用空格而不是 ''，保证 join 后列数不塌陷。 */
export const EMPTY_CELL = ' ';

/**
 * 工具条可选的制表符/箭头字符集。等宽字体下制表符必须占一格宽
 * （真机验证项，见 plan Task 23 Step 2）；万一某平台错位，回退到 -|+。
 */
export const ASCII_CHARSET = [
  '─',
  '│',
  '╱',
  '╲',
  '┌',
  '┐',
  '└',
  '┘',
  '├',
  '┤',
  '┬',
  '┴',
  '┼',
  '→',
  '←',
  '↑',
  '↓',
  '▶',
  '◀',
  '▲',
  '▼',
] as const;

export const DEFAULT_GRID_COLS = 60;
export const DEFAULT_GRID_ROWS = 30;

/** 网格坐标。 */
export interface Cell {
  x: number;
  y: number;
}

/**
 * 工具条语义。'auto'、'text' 与 'eraser' 是**自由手绘**（沿拖动轨迹连续
 * 落笔），其余是**形状工具**（每次 move 都从起笔快照重算，拖动时是实时预览）。
 */
export type AsciiTool =
  | 'auto'
  | 'hline'
  | 'vline'
  | 'diag'
  | 'rect'
  | 'arrow'
  | 'text'
  | 'eraser';

export const ASCII_TOOLS: AsciiTool[] = [
  'auto',
  'hline',
  'vline',
  'diag',
  'rect',
  'arrow',
  'text',
  'eraser',
];

const isFreehandTool = (tool: AsciiTool): boolean =>
  tool === 'auto' || tool === 'text' || tool === 'eraser';

export function createGrid(
  cols: number = DEFAULT_GRID_COLS,
  rows: number = DEFAULT_GRID_ROWS,
): AsciiGrid {
  const safeCols = Math.max(1, Math.floor(cols));
  const safeRows = Math.max(1, Math.floor(rows));
  return {
    cols: safeCols,
    rows: safeRows,
    cells: Array.from({ length: safeRows }, () =>
      Array.from({ length: safeCols }, () => EMPTY_CELL),
    ),
  };
}

const inBounds = (g: AsciiGrid, x: number, y: number): boolean =>
  Number.isInteger(x) &&
  Number.isInteger(y) &&
  x >= 0 &&
  y >= 0 &&
  x < g.cols &&
  y < g.rows;

/**
 * 写一个格子。越界返回原引用（画线/拖拽经常擦到边界，不该因此分配或抛错）。
 */
export function setCell(
  g: AsciiGrid,
  x: number,
  y: number,
  ch: string,
): AsciiGrid {
  if (!inBounds(g, x, y)) return g;
  const nextChar = ch.length > 0 ? ch[0] : EMPTY_CELL;
  if (g.cells[y][x] === nextChar) return g;
  const cells = [...g.cells];
  const row = [...cells[y]];
  row[x] = nextChar;
  cells[y] = row;
  return { ...g, cells };
}

/** Bresenham 直线，包含两端点。 */
export function drawLine(
  g: AsciiGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ch: string,
): AsciiGrid {
  let grid = g;
  let x = Math.round(x0);
  let y = Math.round(y0);
  const endX = Math.round(x1);
  const endY = Math.round(y1);
  const dx = Math.abs(endX - x);
  const sx = x < endX ? 1 : -1;
  const dy = -Math.abs(endY - y);
  const sy = y < endY ? 1 : -1;
  let err = dx + dy;

  for (;;) {
    grid = setCell(grid, x, y, ch);
    if (x === endX && y === endY) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return grid;
}

/** 矩形：四角用 ┌┐└┘，四边用 ─│。端点顺序随意。 */
export function drawRect(
  g: AsciiGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): AsciiGrid {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);

  let grid = g;
  for (let x = left + 1; x < right; x++) {
    grid = setCell(grid, x, top, '─');
    grid = setCell(grid, x, bottom, '─');
  }
  for (let y = top + 1; y < bottom; y++) {
    grid = setCell(grid, left, y, '│');
    grid = setCell(grid, right, y, '│');
  }
  // 角最后写，保证细长矩形（宽/高为 1）时角字符胜出。
  grid = setCell(grid, left, top, '┌');
  grid = setCell(grid, right, top, '┐');
  grid = setCell(grid, left, bottom, '└');
  grid = setCell(grid, right, bottom, '┘');
  return grid;
}

/** 橡皮：把矩形区域（含端点）清成空格。 */
export function erase(
  g: AsciiGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): AsciiGrid {
  const left = Math.max(0, Math.min(x0, x1));
  const right = Math.min(g.cols - 1, Math.max(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(g.rows - 1, Math.max(y0, y1));

  let grid = g;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      grid = setCell(grid, x, y, EMPTY_CELL);
    }
  }
  return grid;
}

/**
 * 裁掉四周空白（按非空格子的外接矩形）。内部空白行/列原样保留。
 * 全空网格回落成 1×1——导出空串会让下游（代码块、缩略图）没有可渲染的行。
 */
export function crop(g: AsciiGrid): AsciiGrid {
  let minX = g.cols;
  let minY = g.rows;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) {
      if (g.cells[y][x] === EMPTY_CELL) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return createGrid(1, 1);

  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  return {
    cols,
    rows,
    cells: Array.from({ length: rows }, (_, y) =>
      Array.from({ length: cols }, (_, x) => g.cells[minY + y][minX + x]),
    ),
  };
}

/**
 * 改画布尺寸：保留左上角重叠区域的内容，多出来的部分补空格、超出的裁掉。
 * 直接新建空网格会把用户画到一半的东西清掉，切一次尺寸就白画了。
 */
export function resizeGrid(g: AsciiGrid, cols: number, rows: number): AsciiGrid {
  const safeCols = Math.max(1, Math.floor(cols));
  const safeRows = Math.max(1, Math.floor(rows));
  if (safeCols === g.cols && safeRows === g.rows) return g;

  const next = createGrid(safeCols, safeRows);
  const copyCols = Math.min(safeCols, g.cols);
  const copyRows = Math.min(safeRows, g.rows);
  // next.cells 是刚分配出来的，直接写不会影响入参。
  for (let y = 0; y < copyRows; y++) {
    for (let x = 0; x < copyCols; x++) {
      next.cells[y][x] = g.cells[y][x];
    }
  }
  return next;
}

/**
 * 导出为多行文本。每行强制补齐/截断到 cols：索引可能来自旧版本或被手工
 * 改过，短一行就会让等宽布局错位。
 */
export function toText(g: AsciiGrid): string {
  return g.cells
    .map(row => {
      const line = row.join('');
      if (line.length === g.cols) return line;
      return line.length < g.cols
        ? line + EMPTY_CELL.repeat(g.cols - line.length)
        : line.slice(0, g.cols);
    })
    .join('\n');
}

/** 全空网格（保存前判空用）。 */
export function isBlank(g: AsciiGrid): boolean {
  return g.cells.every(row => row.every(cell => cell === EMPTY_CELL));
}

/** 箭头：主轴方向画线，终点换成箭头字符。 */
export function drawArrow(
  g: AsciiGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): AsciiGrid {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let grid = g;
  if (Math.abs(dx) >= Math.abs(dy)) {
    grid = drawLine(grid, x0, y0, x1, y1, '─');
    grid = setCell(grid, x1, y1, dx >= 0 ? '→' : '←');
  } else {
    grid = drawLine(grid, x0, y0, x1, y1, '│');
    grid = setCell(grid, x1, y1, dy >= 0 ? '↓' : '↑');
  }
  return grid;
}

/**
 * 'auto' 工具的连通模型：每格记录「与哪些相邻格有连线」，按掩码选字符。
 * 用户随手画，转角自动变 ┌┐└┘、T 型变 ┬┴├┤、交叉变 ┼——不需要手动
 * 挑字符。斜线（╱╲）单独成系；斜线格混入正交连线时以正交为准。
 */
export const CONN_U = 1;
export const CONN_D = 2;
export const CONN_L = 4;
export const CONN_R = 8;
export const CONN_NE = 16;
export const CONN_NW = 32;

const ORTHO_MASK = CONN_U | CONN_D | CONN_L | CONN_R;
const DIAG_MASK = CONN_NE | CONN_NW;

/** 制表符 ↔ 连通掩码对照。 */
const CHAR_TO_MASK: Record<string, number> = {
  '│': CONN_U | CONN_D,
  '─': CONN_L | CONN_R,
  '┌': CONN_R | CONN_D,
  '┐': CONN_L | CONN_D,
  '└': CONN_R | CONN_U,
  '┘': CONN_L | CONN_U,
  '┬': CONN_L | CONN_R | CONN_D,
  '┴': CONN_L | CONN_R | CONN_U,
  '├': CONN_U | CONN_D | CONN_R,
  '┤': CONN_U | CONN_D | CONN_L,
  '┼': CONN_U | CONN_D | CONN_L | CONN_R,
  '╱': CONN_NE,
  '╲': CONN_NW,
};

const MASK_TO_CHAR: Record<number, string> = Object.fromEntries(
  Object.entries(CHAR_TO_MASK).map(([ch, mask]) => [mask, ch]),
) as Record<number, string>;

/** 连通掩码 → 制表符。正交方向优先于斜线；空掩码回落圆点。
 *  单方向位（线段端点）显示为所在轴的线字符。 */
export function lineCharFor(mask: number): string {
  const ortho = mask & ORTHO_MASK;
  if (ortho !== 0) {
    return (
      MASK_TO_CHAR[ortho] ??
      ((ortho & (CONN_L | CONN_R)) !== 0 ? '─' : '│')
    );
  }
  const diag = mask & DIAG_MASK;
  if (diag !== 0) return MASK_TO_CHAR[diag] ?? '·';
  return '·';
}

/** 从结果字符重建掩码（非 auto 工具的产物不参与增量连通合并）。 */
function rebuildMasksFromChars(g: AsciiGrid): number[][] {
  return g.cells.map(row => row.map(c => CHAR_TO_MASK[c] ?? 0));
}

/** 相邻两格之间的连线位（进 cur 的方向；prev 取反向位）。 */
function stepBits(prev: Cell, cur: Cell): { prevBits: number; curBits: number } {
  const dx = cur.x - prev.x;
  const dy = cur.y - prev.y;
  if (dy === 0) {
    const bit = dx > 0 ? CONN_R : CONN_L;
    return { prevBits: bit, curBits: dx > 0 ? CONN_L : CONN_R };
  }
  if (dx === 0) {
    const bit = dy > 0 ? CONN_D : CONN_U;
    return { prevBits: bit, curBits: dy > 0 ? CONN_U : CONN_D };
  }
  // 对角步进（|dx|=|dy|=1 或 Bresenham 的合成步）：字面形状与行进方向无关。
  const diag = dx > 0 === dy > 0 ? CONN_NW : CONN_NE;
  return { prevBits: diag, curBits: diag };
}

/**
 * 编辑草稿：字符网格 + 连通掩码。字符只是掩码的渲染——转角 ┐ 的正确性
 * 依赖「行尾 ─ 的 R 位是渲染装饰、不是真连接」这一事实被显式建模，
 * 从字符反推连通天然有歧义（真机实测会把直角弯画成 ┬）。
 */
export interface AsciiDraft {
  grid: AsciiGrid;
  masks: number[][];
}

export function createDraft(cols: number, rows: number): AsciiDraft {
  const grid = createGrid(cols, rows);
  return {
    grid,
    masks: Array.from({ length: grid.rows }, () => Array(grid.cols).fill(0)),
  };
}

/** 给草稿的一格并上连通位，字符按合并结果重选（纯函数，返回新草稿）。 */
function unionCell(draft: AsciiDraft, x: number, y: number, bits: number): AsciiDraft {
  if (x < 0 || y < 0 || x >= draft.grid.cols || y >= draft.grid.rows) return draft;
  const masks = draft.masks.map((row, ry) =>
    ry === y ? row.slice() : row,
  );
  masks[y][x] = (masks[y][x] | bits) & (ORTHO_MASK | DIAG_MASK);
  const grid = setCell(draft.grid, x, y, lineCharFor(masks[y][x]));
  return { grid, masks };
}

/**
 * 'auto' 工具：沿 Bresenham 步进逐格**并上**连线位。转角自动长成
 * ┌┐└┘，与既有线交叉处自动长成 ┬├┼。同格一笔画圆点（无连通）。
 */
export function applyAutoTool(draft: AsciiDraft, from: Cell, to: Cell): AsciiDraft {
  if (from.x === to.x && from.y === to.y) {
    return { ...draft, grid: setCell(draft.grid, from.x, from.y, '·') };
  }
  let next = draft;
  let x = Math.round(from.x);
  let y = Math.round(from.y);
  const endX = Math.round(to.x);
  const endY = Math.round(to.y);
  const dxx = Math.abs(endX - x);
  const sx = x < endX ? 1 : -1;
  const dyy = -Math.abs(endY - y);
  const sy = y < endY ? 1 : -1;
  let err = dxx + dyy;
  for (;;) {
    const prev: Cell = { x, y };
    if (x === endX && y === endY) break;
    const e2 = 2 * err;
    if (e2 >= dyy) {
      err += dyy;
      x += sx;
    }
    if (e2 <= dxx) {
      err += dxx;
      y += sy;
    }
    const { prevBits, curBits } = stepBits(prev, { x, y });
    next = unionCell(next, prev.x, prev.y, prevBits);
    next = unionCell(next, x, y, curBits);
  }
  return next;
}

/**
 * 把一次「从 from 到 to」的编辑应用到网格。形状工具用它做实时预览：
 * 调用方保留起笔快照，每次 move 都从快照重算，不会叠出重影。
 */
export function applyTool(
  g: AsciiGrid,
  tool: AsciiTool,
  from: Cell,
  to: Cell,
  ch: string,
): AsciiGrid {
  switch (tool) {
    case 'auto':
      // auto 走 applyAutoTool（需要连通掩码草稿），不经此纯字符入口。
      return g;
    case 'hline':
      return drawLine(g, from.x, from.y, to.x, from.y, ch);
    case 'vline':
      return drawLine(g, from.x, from.y, from.x, to.y, ch);
    case 'diag':
      return drawLine(g, from.x, from.y, to.x, to.y, ch);
    case 'rect':
      return drawRect(g, from.x, from.y, to.x, to.y);
    case 'arrow':
      return drawArrow(g, from.x, from.y, to.x, to.y);
    case 'eraser':
      return drawLine(g, from.x, from.y, to.x, to.y, EMPTY_CELL);
    case 'text':
      return setCell(g, to.x, to.y, ch);
  }
}

// --- 编辑状态 ---

/** 撤销栈上限：网格是字符串二维数组，50 步足够覆盖一次编辑会话。 */
const HISTORY_LIMIT = 50;

export interface AsciiEditing {
  grid: AsciiGrid;
  canUndo: boolean;
  canRedo: boolean;
  /** 起笔：记录快照与起点。形状工具从快照重算，自由工具沿轨迹累积。 */
  beginStroke: (cell: Cell, tool: AsciiTool, ch: string) => void;
  moveStroke: (cell: Cell, tool: AsciiTool, ch: string) => void;
  endStroke: (cell: Cell, tool: AsciiTool, ch: string) => void;
  undo: () => void;
  redo: () => void;
  clearAll: () => void;
  /** 切换画布尺寸（60×30 ↔ 120×60）。保留重叠区域内容，记一步撤销。 */
  resize: (cols: number, rows: number) => void;
}

/**
 * 编辑状态机。手势回调是高频事件（每帧一次），所以「当前网格」用 ref 镜像，
 * 避免闭包读到上一帧的旧值；撤销/重做是低频的用户动作，直接用 state 即可。
 */
export function useAsciiEditing(
  cols: number = DEFAULT_GRID_COLS,
  rows: number = DEFAULT_GRID_ROWS,
): AsciiEditing {
  const [draft, setDraft] = useState<AsciiDraft>(() => createDraft(cols, rows));
  const [undoStack, setUndoStack] = useState<AsciiDraft[]>([]);
  const [redoStack, setRedoStack] = useState<AsciiDraft[]>([]);

  const draftRef = useRef<AsciiDraft>(draft);
  /** 形状工具的起笔快照。 */
  const baseRef = useRef<AsciiGrid | null>(null);
  const startRef = useRef<Cell | null>(null);
  /** 自由工具的上一个落笔格（画线到当前格，避免快速拖动时跳格）。 */
  const lastRef = useRef<Cell | null>(null);

  const commit = useCallback((next: AsciiDraft) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const pushHistory = useCallback((snapshot: AsciiDraft) => {
    setUndoStack(prev =>
      prev.length >= HISTORY_LIMIT
        ? [...prev.slice(prev.length - HISTORY_LIMIT + 1), snapshot]
        : [...prev, snapshot],
    );
    setRedoStack([]);
  }, []);

  /** 一次笔画段的统一切换：auto 走连通合并，其余走纯字符然后重建掩码。 */
  const applyStroke = useCallback(
    (d: AsciiDraft, tool: AsciiTool, from: Cell, to: Cell, ch: string): AsciiDraft => {
      if (tool === 'auto') return applyAutoTool(d, from, to);
      const grid = applyTool(d.grid, tool, from, to, ch);
      return { grid, masks: rebuildMasksFromChars(grid) };
    },
    [],
  );

  const beginStroke = useCallback(
    (cell: Cell, tool: AsciiTool, ch: string) => {
      const current = draftRef.current;
      pushHistory(current);
      baseRef.current = current.grid;
      startRef.current = cell;
      lastRef.current = cell;
      // 起笔只落一个点：形状工具后续 move 会从快照重算，自由工具从这里开始累积。
      commit(applyStroke(current, tool, cell, cell, ch));
    },
    [applyStroke, commit, pushHistory],
  );

  const moveStroke = useCallback(
    (cell: Cell, tool: AsciiTool, ch: string) => {
      const start = startRef.current;
      if (!start) return;

      if (isFreehandTool(tool)) {
        const last = lastRef.current ?? cell;
        if (last.x === cell.x && last.y === cell.y) return;
        commit(applyStroke(draftRef.current, tool, last, cell, ch));
        lastRef.current = cell;
        return;
      }

      const base = baseRef.current ?? draftRef.current.grid;
      commit(applyStroke({ ...draftRef.current, grid: base }, tool, start, cell, ch));
    },
    [applyStroke, commit],
  );

  const endStroke = useCallback(
    (cell: Cell, tool: AsciiTool, ch: string) => {
      moveStroke(cell, tool, ch);
      baseRef.current = null;
      startRef.current = null;
      lastRef.current = null;
    },
    [moveStroke],
  );

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack([...redoStack, draftRef.current]);
    commit(previous);
  }, [commit, redoStack, undoStack]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack([...undoStack, draftRef.current]);
    commit(next);
  }, [commit, redoStack, undoStack]);

  const clearAll = useCallback(() => {
    const current = draftRef.current;
    pushHistory(current);
    commit(createDraft(current.grid.cols, current.grid.rows));
  }, [commit, pushHistory]);

  const resize = useCallback(
    (nextCols: number, nextRows: number) => {
      const current = draftRef.current;
      if (nextCols === current.grid.cols && nextRows === current.grid.rows) return;
      pushHistory(current);
      baseRef.current = null;
      startRef.current = null;
      lastRef.current = null;
      const grid = resizeGrid(current.grid, nextCols, nextRows);
      commit({
        grid,
        masks: Array.from({ length: grid.rows }, (_, y) =>
          Array.from({ length: grid.cols }, (_, x) => current.masks[y]?.[x] ?? 0),
        ),
      });
    },
    [commit, pushHistory],
  );

  return {
    grid: draft.grid,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    beginStroke,
    moveStroke,
    endStroke,
    undo,
    redo,
    clearAll,
    resize,
  };
}
