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
    showMore: () => setVisibleCount(current => current + step),
    // Mount every item at once. Used when a layout is needed for an arbitrary
    // off-screen element (e.g. jump-to-message from the conversation scrubber);
    // incremental showMore above would otherwise never reach the earliest items.
    showAll: () => setVisibleCount(items.length),
  };
};
