import {
  SCROLL_FAB_VISIBILITY_THRESHOLD,
  scrollDistanceFromBottom,
  shouldShowScrollToBottomFab,
} from '../conversationScroll';

describe('scrollDistanceFromBottom', () => {
  it('is 0 when the viewport bottom sits on the content bottom', () => {
    // content 1000, viewport 800 → bottom rests at offsetY 200.
    expect(scrollDistanceFromBottom(1000, 200, 800)).toBe(0);
  });

  it('clamps to 0 when content is shorter than the viewport', () => {
    expect(scrollDistanceFromBottom(500, 0, 800)).toBe(0);
  });

  it('measures the gap between viewport bottom and content bottom', () => {
    expect(scrollDistanceFromBottom(2000, 300, 800)).toBe(900);
  });
});

describe('shouldShowScrollToBottomFab', () => {
  const yForDistance = (
    contentHeight: number,
    viewport: number,
    distance: number,
  ) => contentHeight - viewport - distance;

  it('hides while resting at the bottom', () => {
    expect(shouldShowScrollToBottomFab(1000, 200, 800)).toBe(false);
  });

  it('hides while content is shorter than the viewport', () => {
    expect(shouldShowScrollToBottomFab(500, 0, 800)).toBe(false);
  });

  it('hides just inside the visibility threshold', () => {
    const y = yForDistance(1000, 800, SCROLL_FAB_VISIBILITY_THRESHOLD - 1);
    expect(shouldShowScrollToBottomFab(1000, y, 800)).toBe(false);
  });

  it('shows just beyond the visibility threshold', () => {
    const y = yForDistance(1000, 800, SCROLL_FAB_VISIBILITY_THRESHOLD + 1);
    expect(shouldShowScrollToBottomFab(1000, y, 800)).toBe(true);
  });
});
