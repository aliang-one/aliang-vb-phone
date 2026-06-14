import { useEffect, useMemo, useState } from 'react';

interface IncrementalListOptions {
  initialCount?: number;
  step?: number;
  resetKey?: string | number | boolean;
  from?: 'start' | 'end';
}

export const useIncrementalList = <T,>(
  items: T[],
  {
    initialCount = 6,
    step = 10,
    resetKey,
    from = 'start',
  }: IncrementalListOptions = {},
) => {
  const [visibleCount, setVisibleCount] = useState(initialCount);

  useEffect(() => {
    setVisibleCount(initialCount);
  }, [initialCount, resetKey]);

  const visibleItems = useMemo(
    () =>
      from === 'end'
        ? items.slice(Math.max(0, items.length - visibleCount))
        : items.slice(0, visibleCount),
    [from, items, visibleCount],
  );

  return {
    visibleItems,
    visibleCount: Math.min(visibleCount, items.length),
    totalCount: items.length,
    hasMore: visibleCount < items.length,
    showMore: () =>
      setVisibleCount(current => Math.min(current + step, items.length)),
  };
};
