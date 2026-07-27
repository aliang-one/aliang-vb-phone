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
