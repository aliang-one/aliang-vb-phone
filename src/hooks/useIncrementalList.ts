import { useCallback, useEffect, useMemo, useState } from 'react';

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

  // Stable callbacks: the returned object is fresh every render, but consumers
  // destructure these into dependency arrays / memo boundaries (e.g. the
  // scrubber commit path), so per-render identities would defeat React.memo.
  const showMore = useCallback(
    () => setVisibleCount(current => current + step),
    [step],
  );
  // Mount every item at once. Used when a layout is needed for an arbitrary
  // off-screen element (e.g. jump-to-message from the conversation scrubber);
  // incremental showMore above would otherwise never reach the earliest items.
  const showAll = useCallback(
    () => setVisibleCount(items.length),
    [items.length],
  );
  // Widen the window just enough to cover a needed visible count (never
  // shrink). The scrubber commit path uses this to reveal a far-away turn
  // without paying showAll's full-list mount on long conversations.
  const revealThrough = useCallback(
    (neededVisibleCount: number) =>
      setVisibleCount(current => Math.max(current, neededVisibleCount)),
    [],
  );

  return {
    visibleItems,
    visibleCount: Math.min(visibleCount, items.length),
    totalCount: items.length,
    hasMore: visibleCount < items.length,
    showMore,
    showAll,
    revealThrough,
  };
};
