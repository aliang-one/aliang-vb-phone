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
 * 快捷字符：只保留 4 个方向符号做「文字工具」的快捷落笔字符（可选，不选也
 * 能画——线形由绘制工具自动生成）。其余字符走自定义输入。
 */
export const ASCII_PRESET_CHARS = ['─', '│', '╱', '╲'] as const;

export const DEFAULT_GRID_COLS = 60;
export const DEFAULT_GRID_ROWS = 30;

/** 网格坐标。 */
export interface Cell {
  x: number;
  y: number;
}

/**
 * 工具条语义。'freehand'、'text' 与 'eraser' 是**自由手绘**（沿拖动轨迹连续
 * 落笔），'rect' 是形状工具（每次 move 都从起笔快照重算，拖动时是实时预览）。
 */
export type AsciiTool = 'freehand' | 'rect' | 'text' | 'eraser';

export const ASCII_TOOLS: AsciiTool[] = ['freehand', 'rect', 'text', 'eraser'];

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

/**
 * Bresenham 轨迹填充（含两端点）。供橡皮 / 文字工具沿拖动轨迹连续落笔——
 * 形状类线段不再走字符直填，改由连通模型统一生成。
 */
function drawCells(
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

/**
 * 连通模型：每格记录「与哪些相邻格有连线」，按掩码选字符。
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

/** 相反方向的连线位（连线两端各记一半）。 */
function oppositeBit(bit: number): number {
  switch (bit) {
    case CONN_U:
      return CONN_D;
    case CONN_D:
      return CONN_U;
    case CONN_L:
      return CONN_R;
    case CONN_R:
      return CONN_L;
    // 对角连线两端形状一致（╱ 或 ╲）。
    default:
      return bit;
  }
}

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

/** 从结果字符重建掩码（橡皮/文字等直填字符的工具不参与连通合并）。 */
function rebuildMasksFromChars(g: AsciiGrid): number[][] {
  return g.cells.map(row => row.map(c => CHAR_TO_MASK[c] ?? 0));
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

/**
 * 一笔 freehand 的待生成记录：本笔轨迹覆盖的格子集合（y × cols + x 编码）
 * + 起笔快照（与既有线交叉处要长出 ┬/┼，必须知道画到这笔之前的样子）。
 */
export interface PendingStroke {
  cells: Set<number>;
  baseMasks: number[][];
}

/**
 * 从「待生成格子集合」计算每个格子的连通掩码：
 *   - 集合内部相邻（含对角）的格子对按方向互相补位——
 *     正交格对补正交位，对角格对补斜线位；
 *   - 与起笔时的既有掩码（baseMasks）求并——跨笔交叉自动长出 ┬/┼。
 *
 * 集合里孤立的格子（无任何相邻）不补任何位，落在基掩码上；空画布上单击
 * 一格即掩码 0，lineCharFor 回落圆点 `·`——与旧「同格一笔画圆点」一致。
 */
function computeMasksFromStrokes(
  cols: number,
  rows: number,
  base: number[][],
  cells: Set<number>,
): number[][] {
  const masks = base.map(row => row.slice());
  const key = (x: number, y: number) => y * cols + x;

  const connect = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    let bit: number;
    if (dy === 0 && dx === 1) bit = CONN_R;
    else if (dy === 0 && dx === -1) bit = CONN_L;
    else if (dx === 0 && dy === 1) bit = CONN_D;
    else if (dx === 0 && dy === -1) bit = CONN_U;
    // 对角：符号同向（↘↖）落 ╲（NW 边界），符号反向（↗↙）落 ╱（NE 边界）。
    else if (dx > 0 === dy > 0) bit = CONN_NW;
    else bit = CONN_NE;
    masks[ay][ax] |= bit;
    masks[by][bx] |= oppositeBit(bit);
  };

  for (const k of cells) {
    const x = k % cols;
    const y = Math.floor(k / cols);
    if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
    // 只扫右/下/右下/左下四个方向，避免同一格对被处理两遍。
    if (cells.has(key(x + 1, y))) connect(x, y, x + 1, y);
    if (cells.has(key(x, y + 1))) connect(x, y, x, y + 1);
    if (cells.has(key(x + 1, y + 1))) connect(x, y, x + 1, y + 1);
    if (cells.has(key(x - 1, y + 1))) connect(x, y, x - 1, y + 1);
  }
  return masks;
}

/**
 * 收笔时的最终字符生成：把待生成格子集合按**完整轨迹**重算掩码（基于起笔
 * 快照做并集），一次性选出所有字符。中途帧从未碰过字符网格，所以不存在
 * 「画歪的符号残留」。
 */
export function commitStrokes(
  draft: AsciiDraft,
  pending: PendingStroke,
): AsciiDraft {
  if (pending.cells.size === 0) return draft;
  const { grid } = draft;
  const masks = computeMasksFromStrokes(
    grid.cols,
    grid.rows,
    pending.baseMasks,
    pending.cells,
  );
  let nextGrid = grid;
  for (const k of pending.cells) {
    const x = k % grid.cols;
    const y = Math.floor(k / grid.cols);
    if (x < 0 || x >= grid.cols || y < 0 || y >= grid.rows) continue;
    nextGrid = setCell(nextGrid, x, y, lineCharFor(masks[y][x]));
  }
  return { grid: nextGrid, masks };
}

/** 矩形轨迹：外接框四条边的所有格子登记进待生成集合（起点顺序随意）。 */
export function rectStrokeCells(
  from: Cell,
  to: Cell,
  cols: number,
  rows: number,
): Set<number> {
  const cells = new Set<number>();
  const left = Math.max(0, Math.min(from.x, to.x));
  const right = Math.min(cols - 1, Math.max(from.x, to.x));
  const top = Math.max(0, Math.min(from.y, to.y));
  const bottom = Math.min(rows - 1, Math.max(from.y, to.y));
  for (let x = left; x <= right; x++) {
    cells.add(top * cols + x);
    cells.add(bottom * cols + x);
  }
  for (let y = top; y <= bottom; y++) {
    cells.add(y * cols + left);
    cells.add(y * cols + right);
  }
  return cells;
}

/** 沿 Bresenham 轨迹（含两端）把格子登记进待生成集合。 */
export function pathStrokeCells(
  from: Cell,
  to: Cell,
  cols: number,
  rows: number,
  cells: Set<number> = new Set<number>(),
): Set<number> {
  let x = Math.round(from.x);
  let y = Math.round(from.y);
  const endX = Math.round(Math.max(0, Math.min(cols - 1, to.x)));
  const endY = Math.round(Math.max(0, Math.min(rows - 1, to.y)));
  const startX = Math.round(Math.max(0, Math.min(cols - 1, x)));
  const startY = Math.round(Math.max(0, Math.min(rows - 1, y)));
  const dx = Math.abs(endX - startX);
  const sx = startX < endX ? 1 : -1;
  const dy = -Math.abs(endY - startY);
  const sy = startY < endY ? 1 : -1;
  let err = dx + dy;

  let cx = startX;
  let cy = startY;
  for (;;) {
    cells.add(cy * cols + cx);
    if (cx === endX && cy === endY) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      cx += sx;
    }
    if (e2 <= dx) {
      err += dx;
      cy += sy;
    }
  }
  return cells;
}

/**
 * 把一次「从 from 到 to」的编辑应用到网格。橡皮/文字沿轨迹连续落笔；
 * freehand 不经此入口（轨迹只累积、收笔统一生成）。
 */
export function applyTool(
  g: AsciiGrid,
  tool: AsciiTool,
  from: Cell,
  to: Cell,
  ch: string,
): AsciiGrid {
  switch (tool) {
    case 'freehand':
      return g;
    case 'rect': {
      // 矩形=画布上已有的正交/斜线格按外接框补齐，走连通模型统一生成；
      // 在 applyTool 里只做「把四条边的格子登记成待生成集合」无法返回集合，
      // 所以矩形改在 useAsciiEditing 里单独处理。
      return g;
    }
    case 'eraser':
      return drawCells(g, from.x, from.y, to.x, to.y, EMPTY_CELL);
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
  /** 本笔是否已有轨迹在累积（画布用来显示预览高亮）。 */
  hasPending: boolean;
  /** 本笔轨迹覆盖的格子（坐标键），画布叠加高亮用；无进行中笔迹时为 null。 */
  pendingCells: { cols: number; keys: Set<number> } | null;
  /** 起笔：记录起笔快照。freehand/rect 只累积轨迹，收笔统一生成。 */
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
 *
 * 2026-10-30 改版：「先涂抹、后生成」。
 *   - freehand/rect 拖动过程只往 `pendingRef.cells` 里累积格子（配合画布的
 *     高亮预览层），不写任何字符——中途的 Bresenham 中间形态不再落到画布上，
 *     「符号跑偏」的根源消除；
 *   - 收笔（endStroke）按**完整轨迹**一次性重算连通掩码并落字（commitStrokes）；
 *   - 撤销栈改为**收笔时按结果比对**：轨迹没产生任何实际变化（比如单击一个
 *     空格子）就不入栈，按撤销永远能看到内容回退，不再出现「按了没反应」。
 */
export function useAsciiEditing(
  cols: number = DEFAULT_GRID_COLS,
  rows: number = DEFAULT_GRID_ROWS,
): AsciiEditing {
  const [draft, setDraft] = useState<AsciiDraft>(() => createDraft(cols, rows));
  const [undoStack, setUndoStack] = useState<AsciiDraft[]>([]);
  const [redoStack, setRedoStack] = useState<AsciiDraft[]>([]);
  /** 进行中笔迹的展示句柄（引用稳定：cells 原地累积，组件按 hasPending 分支）。 */
  const [pendingView, setPendingView] = useState<{
    cols: number;
    keys: Set<number>;
  } | null>(null);

  const draftRef = useRef<AsciiDraft>(draft);
  /** 本笔起笔快照：连通生成要以「画这笔之前」为基底，撤销比对也用它。 */
  const strokeStartRef = useRef<AsciiDraft | null>(null);
  const startRef = useRef<Cell | null>(null);
  /** 自由工具的上一个落笔格（画线到当前格，避免快速拖动时跳格）。 */
  const lastRef = useRef<Cell | null>(null);
  /** 本笔待生成格子集合（y × cols + x）。 */
  const pendingRef = useRef<Set<number>>(new Set());

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

  const beginStroke = useCallback(
    (cell: Cell, tool: AsciiTool, ch: string) => {
      const current = draftRef.current;
      startRef.current = cell;
      lastRef.current = cell;
      pendingRef.current = new Set();
      strokeStartRef.current = current;

      if (tool === 'freehand' || tool === 'rect') {
        // 只登记轨迹，不落字。起笔格也先进集合：单击一个空格收笔时
        // commitStrokes 会给它一个圆点 `·`。
        pendingRef.current.add(cell.y * current.grid.cols + cell.x);
        setPendingView({ cols: current.grid.cols, keys: pendingRef.current });
        return;
      }

      // 橡皮/文字：直填字符，起笔即生效。撤销步由 endStroke 按结果比对后统一入栈。
      const grid = applyTool(current.grid, tool, cell, cell, ch);
      if (grid !== current.grid) {
        commit({ grid, masks: rebuildMasksFromChars(grid) });
      }
    },
    [commit],
  );

  const moveStroke = useCallback(
    (cell: Cell, tool: AsciiTool, ch: string) => {
      const start = startRef.current;
      if (!start) return;

      if (tool === 'freehand' || tool === 'rect') {
        const last = lastRef.current ?? cell;
        if (last.x === cell.x && last.y === cell.y) return;
        const current = draftRef.current;
        if (tool === 'rect') {
          pendingRef.current = rectStrokeCells(start, cell, current.grid.cols, current.grid.rows);
        } else {
          pathStrokeCells(last, cell, current.grid.cols, current.grid.rows, pendingRef.current);
        }
        lastRef.current = cell;
        setPendingView({ cols: current.grid.cols, keys: pendingRef.current });
        return;
      }

      // 橡皮/文字：每次事件从起笔快照重算，实时预览。
      const startDraft = strokeStartRef.current ?? draftRef.current;
      const grid = applyTool(startDraft.grid, tool, start, cell, ch);
      if (grid === startDraft.grid) return;
      commit({ grid, masks: rebuildMasksFromChars(grid) });
    },
    [commit],
  );

  const endStroke = useCallback(
    (cell: Cell, tool: AsciiTool, ch: string) => {
      moveStroke(cell, tool, ch);
      const start = startRef.current;
      const startDraft = strokeStartRef.current;
      startRef.current = null;
      strokeStartRef.current = null;
      lastRef.current = null;
      if (!start || !startDraft) return;

      const current = draftRef.current;
      if (tool === 'freehand' || tool === 'rect') {
        const pending = pendingRef.current;
        pendingRef.current = new Set();
        setPendingView(null);
        const next = commitStrokes(current, {
          cells: pending,
          baseMasks: startDraft.masks,
        });
        // 无实际变化（轨迹全落在已相同字符的格子上）→ 不留撤销步。
        if (next.grid === startDraft.grid) return;
        pushHistory(startDraft);
        commit(next);
        return;
      }

      // 橡皮/文字：比对起笔快照，无实际变化不入栈。
      if (current.grid === startDraft.grid) return;
      pushHistory(startDraft);
      commit(current);
    },
    [commit, moveStroke, pushHistory],
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
      startRef.current = null;
      strokeStartRef.current = null;
      lastRef.current = null;
      pendingRef.current = new Set();
      setPendingView(null);
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
    hasPending: pendingView !== null,
    pendingCells: pendingView,
    beginStroke,
    moveStroke,
    endStroke,
    undo,
    redo,
    clearAll,
    resize,
  };
}
