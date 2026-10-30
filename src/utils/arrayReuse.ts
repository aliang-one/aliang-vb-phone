/**
 * reuseStablePrefix — 流式身份保留(C2)的复用原语。
 *
 * 流式期间每 200ms 全量重建的派生数组(转录条目/会话回合)里,除尾条外
 * 全部内容与上一轮逐字段相同——但全新对象身份会让下游每级 memo/依赖链
 * 失效,长会话下形成 O(n) 的分配与重渲染底噪。这里按 key 逐项比对,
 * 稳定前缀直接沿用上一轮的对象引用(零分配),从第一个变化项起才换用
 * 新对象。O(n) 只扫不分配,分配只落在真正变化的尾部。
 */
export const reuseStablePrefix = <T>(
  prev: readonly T[],
  next: readonly T[],
  keyOf: (item: T) => string,
): T[] => {
  const out: T[] = new Array(next.length);
  const stableCount = Math.min(prev.length, next.length);
  let i = 0;
  while (i < stableCount && keyOf(prev[i]) === keyOf(next[i])) {
    out[i] = prev[i];
    i += 1;
  }
  for (; i < next.length; i += 1) {
    out[i] = next[i];
  }
  return out;
};
