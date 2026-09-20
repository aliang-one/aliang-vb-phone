/**
 * Scroll-position math for the conversation screen's "jump to latest" affordance.
 * Pure functions — the scroll controller calls these from its throttled onScroll
 * and only flips UI state when the answer changes.
 */

// Show the scroll-to-bottom button once the user is at least this far above the
// content bottom. Sized to clear the composer + input padding so casual
// rubber-band overscroll or a single message's height never flashes it.
export const SCROLL_FAB_VISIBILITY_THRESHOLD = 240;

/** Gap (px) between the viewport bottom and the content bottom; clamps at 0
 *  so short conversations (content < viewport) read as "at the bottom". */
export const scrollDistanceFromBottom = (
  contentHeight: number,
  offsetY: number,
  viewportHeight: number,
): number => Math.max(0, contentHeight - (offsetY + viewportHeight));

/** Whether the floating scroll-to-bottom button should be visible. */
export const shouldShowScrollToBottomFab = (
  contentHeight: number,
  offsetY: number,
  viewportHeight: number,
  threshold: number = SCROLL_FAB_VISIBILITY_THRESHOLD,
): boolean =>
  scrollDistanceFromBottom(contentHeight, offsetY, viewportHeight) > threshold;
