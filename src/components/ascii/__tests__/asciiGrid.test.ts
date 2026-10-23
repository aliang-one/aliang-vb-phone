/**
 * 字符网格契约（Task 22 Step 1）。
 *
 *   - drawLine 水平/垂直/45° 三种；
 *   - drawRect 四角四边正确；
 *   - crop 四周空白全去、内部空白保留；
 *   - toText 行数与列数对齐（短行补空格）。
 */
import {
  applyTool,
  createGrid,
  crop,
  drawLine,
  drawRect,
  erase,
  pickDirectionChar,
  resizeGrid,
  setCell,
  toText,
  type AsciiGrid,
} from '../asciiGrid';

/** 取某一行拼接后的字符串，断言更直观。 */
const rowText = (g: AsciiGrid, y: number): string => g.cells[y].join('');

const cellAt = (g: AsciiGrid, x: number, y: number): string => g.cells[y][x];

describe('pickDirectionChar', () => {
  it('同格 → 圆点', () => {
    expect(pickDirectionChar({ x: 3, y: 3 }, { x: 3, y: 3 })).toBe('·');
  });
  it('水平（向右/向左）→ 横线', () => {
    expect(pickDirectionChar({ x: 1, y: 2 }, { x: 2, y: 2 })).toBe('─');
    expect(pickDirectionChar({ x: 2, y: 2 }, { x: 1, y: 2 })).toBe('─');
  });
  it('垂直（向下/向上）→ 竖线', () => {
    expect(pickDirectionChar({ x: 2, y: 1 }, { x: 2, y: 2 })).toBe('│');
    expect(pickDirectionChar({ x: 2, y: 2 }, { x: 2, y: 1 })).toBe('│');
  });
  it('右下/左上 → 反斜线', () => {
    expect(pickDirectionChar({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe('╲');
    expect(pickDirectionChar({ x: 2, y: 2 }, { x: 1, y: 1 })).toBe('╲');
  });
  it('右上/左下 → 正斜线', () => {
    expect(pickDirectionChar({ x: 1, y: 2 }, { x: 2, y: 1 })).toBe('╱');
    expect(pickDirectionChar({ x: 2, y: 1 }, { x: 1, y: 2 })).toBe('╱');
  });
});

describe("applyTool 'auto'", () => {
  it('水平拖动 → 整段 ─（起点也跟随方向，不留点）', () => {
    const g = applyTool(createGrid(10, 5), 'auto', { x: 2, y: 2 }, { x: 5, y: 2 }, '?');
    expect(rowText(g, 2)).toBe('  ────    ');
  });
  it('垂直拖动 → 整列 │', () => {
    const g = applyTool(createGrid(10, 5), 'auto', { x: 3, y: 1 }, { x: 3, y: 3 }, '?');
    expect(cellAt(g, 3, 1)).toBe('│');
    expect(cellAt(g, 3, 2)).toBe('│');
    expect(cellAt(g, 3, 3)).toBe('│');
  });
  it('右下斜拖 → 逐格 ╲，不跳格', () => {
    const g = applyTool(createGrid(10, 10), 'auto', { x: 2, y: 2 }, { x: 4, y: 4 }, '?');
    expect(cellAt(g, 2, 2)).toBe('╲');
    expect(cellAt(g, 3, 3)).toBe('╲');
    expect(cellAt(g, 4, 4)).toBe('╲');
    expect(cellAt(g, 4, 2)).toBe(' ');
  });
  it('左下斜拖 → 逐格 ╱（方向相反取镜像斜线）', () => {
    const g = applyTool(createGrid(10, 10), 'auto', { x: 4, y: 2 }, { x: 2, y: 4 }, '?');
    expect(cellAt(g, 4, 2)).toBe('╱');
    expect(cellAt(g, 3, 3)).toBe('╱');
    expect(cellAt(g, 2, 4)).toBe('╱');
  });
  it('同格一笔 → 圆点', () => {
    const g = applyTool(createGrid(10, 5), 'auto', { x: 3, y: 3 }, { x: 3, y: 3 }, '?');
    expect(cellAt(g, 3, 3)).toBe('·');
  });
  it('横折竖两笔：拐角被第二笔覆盖成 │', () => {
    let g = applyTool(createGrid(10, 5), 'auto', { x: 2, y: 2 }, { x: 5, y: 2 }, '?');
    g = applyTool(g, 'auto', { x: 5, y: 2 }, { x: 5, y: 4 }, '?');
    expect(cellAt(g, 5, 2)).toBe('│');
    expect(cellAt(g, 4, 2)).toBe('─');
    expect(cellAt(g, 5, 3)).toBe('│');
  });
  it('传入的 ch 被忽略（auto 语义就是按方向选字）', () => {
    const g = applyTool(createGrid(10, 5), 'auto', { x: 2, y: 2 }, { x: 4, y: 2 }, 'A');
    expect(rowText(g, 2)).toBe('  ───     ');
  });
});

describe('drawLine', () => {
  it('水平线：整段填充，两端包含', () => {
    const g = drawLine(createGrid(10, 5), 2, 3, 6, 3, '─');
    expect(rowText(g, 3)).toBe('  ─────   ');
    expect(rowText(g, 2)).toBe('          ');
  });

  it('垂直线：整列填充', () => {
    const g = drawLine(createGrid(10, 5), 4, 1, 4, 3, '│');
    expect(g.cells.map(row => row[4]).join('')).toBe(' │││ ');
  });

  it('45° 斜线：对角逐格', () => {
    const g = drawLine(createGrid(6, 6), 0, 0, 3, 3, '╲');
    expect(rowText(g, 0).slice(0, 4)).toBe('╲   ');
    expect(rowText(g, 1).slice(0, 4)).toBe(' ╲  ');
    expect(rowText(g, 2).slice(0, 4)).toBe('  ╲ ');
    expect(rowText(g, 3).slice(0, 4)).toBe('   ╲');
  });

  it('反向斜线同样逐格（不跳格）', () => {
    const g = drawLine(createGrid(6, 6), 4, 0, 1, 3, '╱');
    expect(rowText(g, 0)[4]).toBe('╱');
    expect(rowText(g, 1)[3]).toBe('╱');
    expect(rowText(g, 2)[2]).toBe('╱');
    expect(rowText(g, 3)[1]).toBe('╱');
  });
});

describe('drawRect', () => {
  it('四角四边正确，内部保持空白', () => {
    const g = drawRect(createGrid(8, 5), 1, 1, 5, 3);
    expect(rowText(g, 1)).toBe(' ┌───┐  ');
    expect(rowText(g, 2)).toBe(' │   │  ');
    expect(rowText(g, 3)).toBe(' └───┘  ');
  });

  it('端点顺序随意（反向拖拽）', () => {
    const forward = drawRect(createGrid(8, 5), 1, 1, 5, 3);
    const backward = drawRect(createGrid(8, 5), 5, 3, 1, 1);
    expect(backward.cells).toEqual(forward.cells);
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

describe('setCell / erase', () => {
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

  it('erase 把矩形区域清空，越界部分自动夹紧', () => {
    const drawn = drawRect(createGrid(8, 5), 1, 1, 5, 3);
    const cleared = erase(drawn, -3, 0, 99, 99);
    expect(toText(cleared)).toBe(
      Array.from({ length: 5 }, () => '        ').join('\n'),
    );
  });
});
