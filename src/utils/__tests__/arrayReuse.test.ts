import { reuseStablePrefix } from '../arrayReuse';

interface Item {
  id: string;
  rev: number;
}

const keyOf = (item: Item) => `${item.id}\u0000${item.rev}`;

describe('reuseStablePrefix — 稳定前缀复用(流式身份保留 C2)', () => {
  it('前缀未变 → 逐项复用上一轮对象引用', () => {
    const a: Item = { id: 'a', rev: 1 };
    const b: Item = { id: 'b', rev: 1 };
    const prev = [a, b];
    const next = [{ id: 'a', rev: 1 }, { id: 'b', rev: 1 }];
    const out = reuseStablePrefix(prev, next, keyOf);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });

  it('尾部变化 → 前缀复用旧引用,变化项起用新对象', () => {
    const a: Item = { id: 'a', rev: 1 };
    const b: Item = { id: 'b', rev: 1 };
    const prev = [a, b];
    const next = [{ id: 'a', rev: 1 }, { id: 'b', rev: 2 }];
    const out = reuseStablePrefix(prev, next, keyOf);
    expect(out[0]).toBe(a);
    expect(out[1]).not.toBe(b);
    expect(out[1]).toBe(next[1]);
  });

  it('next 更长(追加) → 复用全部旧项并追加新项', () => {
    const a: Item = { id: 'a', rev: 1 };
    const prev = [a];
    const next = [{ id: 'a', rev: 1 }, { id: 'b', rev: 1 }];
    const out = reuseStablePrefix(prev, next, keyOf);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(next[1]);
    expect(out).toHaveLength(2);
  });

  it('next 更短(收缩) → 复用交集前缀', () => {
    const a: Item = { id: 'a', rev: 1 };
    const b: Item = { id: 'b', rev: 1 };
    const next = [{ id: 'a', rev: 1 }];
    const out = reuseStablePrefix([a, b], next, keyOf);
    expect(out[0]).toBe(a);
    expect(out).toHaveLength(1);
  });

  it('prev 为空 / 全部变化 → 全用新对象', () => {
    const next = [{ id: 'x', rev: 1 }];
    expect(reuseStablePrefix([], next, keyOf)).toEqual(next);
    const out = reuseStablePrefix([{ id: 'x', rev: 0 }], next, keyOf);
    expect(out[0]).toBe(next[0]);
  });
});
