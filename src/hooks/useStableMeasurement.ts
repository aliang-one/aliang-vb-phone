import { useCallback, useRef, useState } from 'react';

/**
 * Default convergence tolerance (in pixels). Layout values that move by less
 * than this between passes are treated as noise and do NOT trigger a re-render.
 *
 * 1px matches what `handleConversationItemLayout` already uses elsewhere in the
 * app and is well below the threshold a user can perceive.
 */
export const DEFAULT_MEASUREMENT_TOLERANCE = 1;

/**
 * Decide whether a freshly measured value differs enough from the last
 * committed one to be worth storing.
 *
 * Pure so it is unit-testable in isolation and reusable by any caller — not
 * just the hook below.
 *
 * @param prev     The last value that was committed (already rounded).
 * @param next     The raw new value straight from `onLayout`.
 * @param tolerance Minimum change, in px, that counts as a real update.
 */
export function shouldCommitMeasurement(
  prev: number,
  next: number,
  tolerance: number = DEFAULT_MEASUREMENT_TOLERANCE,
): boolean {
  return Math.abs(prev - next) >= tolerance;
}

/**
 * `useState` for a single layout dimension (width / height / x / y) that
 * survives the New-Architecture `onLayout` infinite loop.
 *
 * Problem this solves: Fabric reports layout with sub-pixel precision, so a
 * handler like `onLayout={e => setH(e.nativeEvent.layout.height)}` is called
 * with `733.3333` on one pass and `733.3334` on the next. `useState` only bails
 * on `Object.is` equality, so the fractional difference triggers a re-render,
 * which re-lays-out the view, which fires `onLayout` again — until React trips
 * `Maximum update depth exceeded` and crashes the app.
 *
 * Defense:
 *   1. Round to an integer — kills sub-pixel noise at the source and gives
 *      downstream styles clean whole-pixel values.
 *   2. Tolerance bail — skip the `setState` entirely when the rounded value
 *      hasn't moved by at least `tolerance` px, so React never re-renders and
 *      the layout can't feed back into itself.
 *   3. Ref-tracked last value — avoids stale-closure drift without putting the
 *      previous measurement in the dependency array.
 *
 * @param initial   Starting value (usually 0).
 * @param tolerance Minimum px change that triggers a commit.
 * @returns `[value, commit]` where `commit(rawFromOnLayout)` is the setter.
 */
export function useStableMeasurement(
  initial: number = 0,
  tolerance: number = DEFAULT_MEASUREMENT_TOLERANCE,
): readonly [number, (rawNext: number) => void] {
  const [value, setValue] = useState(initial);
  const lastRef = useRef(initial);

  const commit = useCallback(
    (rawNext: number) => {
      const next = Math.round(rawNext);
      if (!shouldCommitMeasurement(lastRef.current, next, tolerance)) return;
      lastRef.current = next;
      setValue(next);
    },
    [tolerance],
  );

  return [value, commit] as const;
}

/**
 * Fold a batch of freshly measured (already-rounded) per-item layouts into the
 * committed map, returning the SAME object reference when nothing meaningfully
 * changed so React bails out of the re-render.
 *
 * "Meaningfully changed" = the item is new, OR its `top`/`height` moved by at
 * least `tolerance` (default 1px) on either axis. This convergence is what lets
 * a deferred layout flush settle: once a rounded measurement is committed,
 * repeated `onLayout` passes reporting the same rounded value are a no-op.
 *
 * Pure so it is unit-testable; the conversation screen's deferred flush calls it
 * inside a `setMessageLayouts` updater.
 *
 * @param current   The committed layout map (each value already rounded).
 * @param pending   Items staged by `onLayout` since the last flush (values
 *                  already rounded). An iterable of `[id, {top, height}]`.
 * @param tolerance Minimum px change on either axis that counts as a real update.
 * @returns The next map, or the SAME `current` reference if no item changed.
 */
export function mergeMeasuredLayouts(
  current: Record<string, { top: number; height: number }>,
  pending: Iterable<readonly [string, { top: number; height: number }]>,
  tolerance: number = DEFAULT_MEASUREMENT_TOLERANCE,
): Record<string, { top: number; height: number }> {
  let next: Record<string, { top: number; height: number }> | null = null;
  for (const [id, value] of pending) {
    const existing = current[id];
    if (
      !existing ||
      shouldCommitMeasurement(existing.top, value.top, tolerance) ||
      shouldCommitMeasurement(existing.height, value.height, tolerance)
    ) {
      if (next === null) {
        next = { ...current };
      }
      next[id] = value;
    }
  }
  return next ?? current;
}
