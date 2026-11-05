/**
 * 字符网格契约（Task 22 Step 1；2026-10-30「先涂抹后生成」改版）。
 *
 *   - lineCharFor：连通掩码 → 制表符；
 *   - commitStrokes：轨迹收笔后按完整连通生成（转角/交叉/孤立圆点）；
 *   - rectStrokeCells / pathStrokeCells：轨迹集合的形状正确性；
 *   - crop 四周空白全去、内部空白保留；
 *   - toText 行数与列数对齐（短行补空格）。
 */
import {
  CONN_D,
  CONN_L,
  CONN_NE,
  CONN_NW,
  CONN_R,
  CONN_U,
  commitStrokes,
  createDraft,
  createGrid,
  crop,
  pathStrokeCells,
  rectStrokeCells,
  resizeGrid,
  setCell,
  toText,
  lineCharFor,
  type AsciiGrid,
  type PendingStroke,
} from '../asciiGrid';

/** 取某一行拼接后的字符串，断言更直观。 */
const rowText = (g: AsciiGrid, y: number): string => g.cells[y].join('');

const cellAt = (g: AsciiGrid, x: number, y: number): string => g.cells[y][x];

/** 把格子集合（y×cols+x 编码）打包成 PendingStroke，基掩码取草稿当前值。 */
const pendingOf = (
  draft: ReturnType<typeof createDraft>,
  cells: Set<number>,
): PendingStroke => ({ cells, baseMasks: draft.masks });

describe('lineCharFor（连通掩码 → 字符）', () => {
  it('单方向：横/竖', () => {
    expect(lineCharFor(CONN_L)).toBe('─');
    expect(lineCharFor(CONN_R)).toBe('─');
    expect(lineCharFor(CONN_U)).toBe('│');
    expect(lineCharFor(CONN_D)).toBe('│');
  });
  it('直角四态', () => {
    expect(lineCharFor(CONN_R | CONN_D)).toBe('┌');
    expect(lineCharFor(CONN_L | CONN_D)).toBe('┐');
    expect(lineCharFor(CONN_R | CONN_U)).toBe('└');
    expect(lineCharFor(CONN_L | CONN_U)).toBe('┘');
  });
  it('T 型与十字', () => {
    expect(lineCharFor(CONN_L | CONN_R | CONN_D)).toBe('┬');
    expect(lineCharFor(CONN_L | CONN_R | CONN_U)).toBe('┴');
    expect(lineCharFor(CONN_U | CONN_D | CONN_R)).toBe('├');
    expect(lineCharFor(CONN_U | CONN_D | CONN_L)).toBe('┤');
    expect(
      lineCharFor(CONN_U | CONN_D | CONN_L | CONN_R),
    ).toBe('┼');
  });
  it('斜线单独成系；混入正交方向时以正交为准', () => {
    expect(lineCharFor(CONN_NE)).toBe('╱');
    expect(lineCharFor(CONN_NW)).toBe('╲');
    expect(lineCharFor(CONN_NE | CONN_L)).toBe('─');
  });
  it('空掩码回落圆点', () => {
    expect(lineCharFor(0)).toBe('·');
  });
});

describe('pathStrokeCells（Bresenham 轨迹集合）', () => {
  it('水平轨迹：整段包含，键位正确', () => {
    const cells = pathStrokeCells({ x: 2, y: 2 }, { x: 5, y: 2 }, 10, 5);
    expect(cells.size).toBe(4);
    for (let x = 2; x <= 5; x++) expect(cells.has(2 * 10 + x)).toBe(true);
  });

  it('垂直轨迹：整列包含', () => {
    const cells = pathStrokeCells({ x: 3, y: 1 }, { x: 3, y: 3 }, 10, 5);
    expect(cells.size).toBe(3);
    expect(cells.has(1 * 10 + 3)).toBe(true);
    expect(cells.has(2 * 10 + 3)).toBe(true);
    expect(cells.has(3 * 10 + 3)).toBe(true);
  });

  it('对角轨迹：逐格不跳格', () => {
    const cells = pathStrokeCells({ x: 2, y: 2 }, { x: 4, y: 4 }, 10, 10);
    expect(cells.size).toBe(3);
    expect(cells.has(2 * 10 + 2)).toBe(true);
    expect(cells.has(3 * 10 + 3)).toBe(true);
    expect(cells.has(4 * 10 + 4)).toBe(true);
  });

  it('同格轨迹：单格集合', () => {
    const cells = pathStrokeCells({ x: 3, y: 3 }, { x: 3, y: 3 }, 10, 5);
    expect(cells.size).toBe(1);
    expect(cells.has(3 * 10 + 3)).toBe(true);
  });

  it('跨笔累积：传入已有集合原地合并', () => {
    const cells = pathStrokeCells({ x: 1, y: 1 }, { x: 2, y: 1 }, 10, 5);
    pathStrokeCells({ x: 2, y: 1 }, { x: 2, y: 3 }, 10, 5, cells);
    expect(cells.size).toBe(4); // (1,1)(2,1)(2,2)(2,3)
  });

  it('越界端点夹到网格内', () => {
    const cells = pathStrokeCells({ x: -5, y: -5 }, { x: 99, y: 2 }, 10, 5);
    for (const key of cells) {
      const x = key % 10;
      const y = Math.floor(key / 10);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(10);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(5);
    }
  });
});

describe('rectStrokeCells（矩形轨迹集合）', () => {
  it('四条边全部登记，内部空白', () => {
    const cells = rectStrokeCells({ x: 1, y: 1 }, { x: 5, y: 3 }, 10, 6);
    // 周长 2×(5+3) − 4 个重复角 = 12。
    expect(cells.size).toBe(12);
    expect(cells.has(1 * 10 + 1)).toBe(true);
    expect(cells.has(1 * 10 + 5)).toBe(true);
    expect(cells.has(3 * 10 + 1)).toBe(true);
    expect(cells.has(3 * 10 + 5)).toBe(true);
    expect(cells.has(2 * 10 + 3)).toBe(false);
  });

  it('端点顺序随意（反向拖拽）', () => {
    const forward = rectStrokeCells({ x: 1, y: 1 }, { x: 5, y: 3 }, 10, 6);
    const backward = rectStrokeCells({ x: 5, y: 3 }, { x: 1, y: 1 }, 10, 6);
    expect(backward).toEqual(forward);
  });
});

describe('commitStrokes（收笔按完整轨迹生成）', () => {
  it('空画布水平一笔 → 整段 ─（端点也是 ─）', () => {
    const draft = createDraft(10, 5);
    const cells = pathStrokeCells({ x: 2, y: 2 }, { x: 5, y: 2 }, 10, 5);
    const next = commitStrokes(draft, pendingOf(draft, cells));
    expect(rowText(next.grid, 2)).toBe('  ────    ');
  });

  it('空画布垂直一笔 → 整列 │', () => {
    const draft = createDraft(10, 5);
    const cells = pathStrokeCells({ x: 3, y: 1 }, { x: 3, y: 3 }, 10, 5);
    const next = commitStrokes(draft, pendingOf(draft, cells));
    expect(cellAt(next.grid, 3, 1)).toBe('│');
    expect(cellAt(next.grid, 3, 2)).toBe('│');
    expect(cellAt(next.grid, 3, 3)).toBe('│');
  });

  it('一笔拖出 L 形 → 拐角自动 ┐（不再依赖笔顺）', () => {
    const draft = createDraft(10, 5);
    // 同一笔内先横后竖（轨迹连续），收笔一次生成。
    const cells = pathStrokeCells({ x: 2, y: 2 }, { x: 5, y: 2 }, 10, 5);
    pathStrokeCells({ x: 5, y: 2 }, { x: 5, y: 4 }, 10, 5, cells);
    const next = commitStrokes(draft, pendingOf(draft, cells));
    expect(cellAt(next.grid, 5, 2)).toBe('┐');
    expect(cellAt(next.grid, 4, 2)).toBe('─');
    expect(cellAt(next.grid, 5, 3)).toBe('│');
  });

  it('两笔交叉：后笔收笔时前笔同步长出 ┬', () => {
    let draft = createDraft(10, 5);
    const first = pathStrokeCells({ x: 2, y: 2 }, { x: 6, y: 2 }, 10, 5);
    draft = commitStrokes(draft, pendingOf(draft, first));
    const second = pathStrokeCells({ x: 4, y: 2 }, { x: 4, y: 4 }, 10, 5);
    draft = commitStrokes(draft, pendingOf(draft, second));
    expect(cellAt(draft.grid, 4, 2)).toBe('┬');
    expect(cellAt(draft.grid, 4, 3)).toBe('│');
  });

  it('十字交叉：┼', () => {
    let draft = createDraft(10, 5);
    const first = pathStrokeCells({ x: 2, y: 2 }, { x: 6, y: 2 }, 10, 5);
    draft = commitStrokes(draft, pendingOf(draft, first));
    const second = pathStrokeCells({ x: 4, y: 1 }, { x: 4, y: 3 }, 10, 5);
    draft = commitStrokes(draft, pendingOf(draft, second));
    expect(cellAt(draft.grid, 4, 2)).toBe('┼');
  });

  it('斜拖 → 逐格 ╲ ╱', () => {
    const draft = createDraft(10, 10);
    const cells = pathStrokeCells({ x: 2, y: 2 }, { x: 4, y: 4 }, 10, 10);
    const next = commitStrokes(draft, pendingOf(draft, cells));
    expect(cellAt(next.grid, 2, 2)).toBe('╲');
    expect(cellAt(next.grid, 3, 3)).toBe('╲');
    expect(cellAt(next.grid, 4, 4)).toBe('╲');
    const d2 = createDraft(10, 10);
    const cells2 = pathStrokeCells({ x: 4, y: 2 }, { x: 2, y: 4 }, 10, 10);
    const next2 = commitStrokes(d2, pendingOf(d2, cells2));
    expect(cellAt(next2.grid, 3, 3)).toBe('╱');
  });

  it('孤立单格 → 圆点 ·', () => {
    const draft = createDraft(10, 5);
    const cells = new Set<number>([3 * 10 + 3]);
    const next = commitStrokes(draft, pendingOf(draft, cells));
    expect(cellAt(next.grid, 3, 3)).toBe('·');
  });

  it('空轨迹返回原草稿', () => {
    const draft = createDraft(10, 5);
    expect(
      commitStrokes(draft, { cells: new Set(), baseMasks: draft.masks }),
    ).toBe(draft);
  });

  it('矩形：四边符号一次生成（角 ┌┐└┘、边 ─│）', () => {
    const draft = createDraft(8, 5);
    const cells = rectStrokeCells({ x: 1, y: 1 }, { x: 5, y: 3 }, 8, 5);
    const next = commitStrokes(draft, pendingOf(draft, cells));
    expect(rowText(next.grid, 1)).toBe(' ┌───┐  ');
    expect(rowText(next.grid, 2)).toBe(' │   │  ');
    expect(rowText(next.grid, 3)).toBe(' └───┘  ');
  });

  it('跨笔 T 交叉后原 ─ 格掩码被并集更新（后笔改变前笔端点字符）', () => {
    let draft = createDraft(10, 5);
    const first = pathStrokeCells({ x: 3, y: 1 }, { x: 3, y: 3 }, 10, 5);
    draft = commitStrokes(draft, pendingOf(draft, first));
    const second = pathStrokeCells({ x: 3, y: 3 }, { x: 6, y: 3 }, 10, 5);
    draft = commitStrokes(draft, pendingOf(draft, second));
    expect(cellAt(draft.grid, 3, 3)).toBe('└');
    expect(cellAt(draft.grid, 4, 3)).toBe('─');
  });

  it('轨迹穿过已有圆点 → 圆点被线取代', () => {
    let draft = createDraft(10, 5);
    const dot = new Set<number>([2 * 10 + 3]); // (x=3, y=2)
    draft = commitStrokes(draft, pendingOf(draft, dot));
    expect(cellAt(draft.grid, 3, 2)).toBe('·');
    const line = pathStrokeCells({ x: 3, y: 1 }, { x: 3, y: 3 }, 10, 5);
    draft = commitStrokes(draft, pendingOf(draft, line));
    expect(cellAt(draft.grid, 3, 2)).toBe('│');
  });
});

describe('crop', () => {
  it('四周空白全去', () => {
    const g = setCell(createGrid(20, 10), 7, 4, 'X');
    const c = crop(g);
    expect(c.cols).toBe(1);
    expect(c.rows).toBe(1);
    expect(toText(c)).toBe('X');
  });

  it('内部空白保留（只按外接矩形裁）', () => {
    let g = createGrid(20, 10);
    g = setCell(g, 2, 2, 'A');
    g = setCell(g, 6, 2, 'B');
    const c = crop(g);
    expect(c.cols).toBe(5);
    expect(c.rows).toBe(1);
    expect(toText(c)).toBe('A   B');
  });

  it('全空网格回落 1×1，导出不是空串', () => {
    const c = crop(createGrid(10, 5));
    expect(c.cols).toBe(1);
    expect(c.rows).toBe(1);
    expect(toText(c)).toBe(' ');
  });
});

describe('toText', () => {
  it('行数 = rows，每行长度 = cols', () => {
    const g = createGrid(12, 4);
    const text = toText(g);
    const lines = text.split('\n');
    expect(lines).toHaveLength(4);
    for (const line of lines) expect(line).toHaveLength(12);
  });

  it('短行补空格、长行截断', () => {
    const malformed: AsciiGrid = {
      cols: 5,
      rows: 2,
      cells: [['a', 'b'], ['1', '2', '3', '4', '5', '6', '7']],
    };
    const lines = toText(malformed).split('\n');
    expect(lines[0]).toBe('ab   ');
    expect(lines[1]).toBe('12345');
  });
});

describe('resizeGrid', () => {
  it('放大：保留原内容，新增区域补空格', () => {
    const g = setCell(createGrid(4, 3), 1, 1, 'X');
    const bigger = resizeGrid(g, 6, 5);
    expect(bigger.cols).toBe(6);
    expect(bigger.rows).toBe(5);
    expect(bigger.cells[1][1]).toBe('X');
    expect(bigger.cells[4].join('')).toBe('      ');
  });

  it('缩小：只保留重叠区域，超出的裁掉', () => {
    let g = createGrid(6, 5);
    g = setCell(g, 1, 1, 'A');
    g = setCell(g, 5, 4, 'B');
    const smaller = resizeGrid(g, 3, 3);
    expect(smaller.cells[1][1]).toBe('A');
    expect(toText(smaller).split('\n')).toHaveLength(3);
    expect(toText(smaller).split('\n')[0]).toHaveLength(3);
  });

  it('尺寸不变时返回原引用', () => {
    const g = createGrid(4, 3);
    expect(resizeGrid(g, 4, 3)).toBe(g);
  });
});

describe('setCell', () => {
  it('不可变：原 grid 不被修改', () => {
    const original = createGrid(4, 3);
    const next = setCell(original, 1, 1, 'X');
    expect(original.cells[1][1]).toBe(' ');
    expect(next.cells[1][1]).toBe('X');
    expect(next).not.toBe(original);
  });

  it('越界与无变化都返回原引用', () => {
    const g = createGrid(4, 3);
    expect(setCell(g, -1, 0, 'X')).toBe(g);
    expect(setCell(g, 4, 0, 'X')).toBe(g);
    expect(setCell(g, 0, 3, 'X')).toBe(g);
    expect(setCell(g, 0, 0, ' ')).toBe(g);
  });
});
