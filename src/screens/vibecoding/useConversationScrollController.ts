/**
 * useConversationScrollController — owns the viewport/scroll/layout positioning
 * cluster extracted from VibeCodingSessionScreen (~11 refs + scroll math).
 *
 * Returns the scroll handlers + state the screen needs to wire into its
 * <ScrollView> and <ConversationScrubberLayer>. The screen no longer manages
 * these refs directly — it calls these callbacks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from 'react-native';

// Scroll follow threshold: if the user is within this many px of the bottom,
// we consider them "following the tail" and auto-scroll on new content.
const SCROLL_FOLLOW_THRESHOLD = 80;
// Throttle scroll→scrubber updates so we don't re-render the overlay every frame.
const SCROLL_THROTTLE_MS = 80;
// Debounce trailing scroll-to-end calls so multiple ai.delta flushes in rapid
// succession coalesce into one scroll.
const FOLLOW_TAIL_SCROLL_MS = 120;

export interface PreserveFocusTarget {
  id: string;
  distance: number;
  prevTop: number;
}

export interface ConversationScrollController {
  // Refs to wire into <ScrollView ref={...}>
  scrollViewRef: React.MutableRefObject<ScrollView | null>;
  // Scroll handler for <ScrollView onScroll={...}>
  handleScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  // Whether the user is following the conversation tail (near bottom).
  followTail: React.MutableRefObject<boolean>;
  // Debounced scroll-to-end (coalesces rapid calls).
  scheduleScrollToEnd: (animated?: boolean) => void;
  // Register/unregister the scrubber layer's scroll-Y subscriber.
  registerScrollY: (fn: (y: number) => void) => () => void;
  // Preserve-focus: pin viewport to a message while older history prepends.
  preserveFocusRef: React.MutableRefObject<PreserveFocusTarget | null>;
  // Message layout tracking (onLayout staging + deferred flush).
  messageLayouts: Record<string, { top: number; height: number }>;
  handleConversationItemLayout: (
    itemId: string,
    y: number,
    height: number,
  ) => void;
  // Capture the current topmost visible message for preserve-focus.
  capturePreserveFocus: (visibleTurns: { id: string }[]) => void;
  // Pending jump target (from scrubber commit).
  pendingJumpId: string | null;
  setPendingJumpId: (id: string | null) => void;
  // Reset all scroll state on session change.
  reset: () => void;
  // Cleanup timers on unmount.
  cleanup: () => void;
}

export function useConversationScrollController(): ConversationScrollController {
  const scrollViewRef = useRef<ScrollView | null>(null);
  const scrollYRef = useRef(0);
  const scrollYSubscriberRef = useRef<(y: number) => void>(() => {});
  const followTailRef = useRef(true);
  const pendingScrollToEndRef = useRef(false);
  const lastScrollSetRef = useRef(0);
  const trailingScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollToEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollToEndAtRef = useRef(0);
  const pendingScrollAnimatedRef = useRef(false);
  const preserveFocusRef = useRef<PreserveFocusTarget | null>(null);
  const pendingLayoutsRef = useRef<
    Map<string, { top: number; height: number }>
  >(new Map());
  const layoutFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [messageLayouts, setMessageLayouts] = useState<
    Record<string, { top: number; height: number }>
  >({});
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);

  const registerScrollY = useCallback((fn: (y: number) => void) => {
    scrollYSubscriberRef.current = fn;
    return () => {
      scrollYSubscriberRef.current = () => {};
    };
  }, []);

  const scheduleScrollToEnd = useCallback((animated = true) => {
    pendingScrollAnimatedRef.current =
      pendingScrollAnimatedRef.current || animated;
    if (scrollToEndTimer.current) return;
    const elapsed = Date.now() - lastScrollToEndAtRef.current;
    const delay = Math.max(0, FOLLOW_TAIL_SCROLL_MS - elapsed);
    scrollToEndTimer.current = setTimeout(() => {
      scrollToEndTimer.current = null;
      lastScrollToEndAtRef.current = Date.now();
      const shouldAnimate = pendingScrollAnimatedRef.current;
      pendingScrollAnimatedRef.current = false;
      scrollViewRef.current?.scrollToEnd({ animated: shouldAnimate });
    }, delay);
  }, []);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      const y = contentOffset.y;
      followTailRef.current =
        contentSize.height - (y + layoutMeasurement.height) <=
        SCROLL_FOLLOW_THRESHOLD;
      scrollYRef.current = y;
      const now = Date.now();
      if (now - lastScrollSetRef.current >= SCROLL_THROTTLE_MS) {
        lastScrollSetRef.current = now;
        if (trailingScrollTimer.current) {
          clearTimeout(trailingScrollTimer.current);
          trailingScrollTimer.current = null;
        }
        scrollYSubscriberRef.current(y);
      } else if (!trailingScrollTimer.current) {
        trailingScrollTimer.current = setTimeout(() => {
          trailingScrollTimer.current = null;
          lastScrollSetRef.current = Date.now();
          scrollYSubscriberRef.current(scrollYRef.current);
        }, SCROLL_THROTTLE_MS);
      }
    },
    [],
  );

  const handleConversationItemLayout = useCallback(
    (itemId: string, y: number, height: number) => {
      const existing = messageLayouts[itemId];
      if (
        existing &&
        Math.abs(existing.top - y) < 1 &&
        Math.abs(existing.height - height) < 1
      ) {
        return;
      }
      // Stage into pending map; flush in a deferred macrotask to avoid
      // synchronous setState during onLayout (Android Fabric jitter guard).
      pendingLayoutsRef.current.set(itemId, { top: y, height });
      if (layoutFlushTimerRef.current) return;
      layoutFlushTimerRef.current = setTimeout(() => {
        layoutFlushTimerRef.current = null;
        setMessageLayouts(current => {
          const next = { ...current };
          let changed = false;
          for (const [id, layout] of pendingLayoutsRef.current) {
            // Round to avoid sub-pixel jitter preventing convergence.
            const rounded = {
              top: Math.round(layout.top * 10) / 10,
              height: Math.round(layout.height * 10) / 10,
            };
            const prev = next[id];
            if (
              !prev ||
              Math.abs(prev.top - rounded.top) >= 1 ||
              Math.abs(prev.height - rounded.height) >= 1
            ) {
              next[id] = rounded;
              changed = true;
            }
          }
          pendingLayoutsRef.current.clear();
          return changed ? next : current;
        });
      }, 0);
    },
    [messageLayouts],
  );

  const capturePreserveFocus = useCallback(
    (visibleTurns: { id: string }[]) => {
      const focusId = visibleTurns[0]?.id;
      const focusLayout = focusId ? messageLayouts[focusId] : undefined;
      if (!focusId || !focusLayout) return;
      preserveFocusRef.current = {
        id: focusId,
        distance: 0,
        prevTop: focusLayout.top,
      };
    },
    [messageLayouts],
  );

  const cleanup = useCallback(() => {
    if (trailingScrollTimer.current) {
      clearTimeout(trailingScrollTimer.current);
    }
    if (scrollToEndTimer.current) {
      clearTimeout(scrollToEndTimer.current);
    }
    if (layoutFlushTimerRef.current) {
      clearTimeout(layoutFlushTimerRef.current);
    }
  }, []);

  const reset = useCallback(() => {
    scrollYRef.current = 0;
    scrollYSubscriberRef.current(0);
    followTailRef.current = true;
    pendingScrollToEndRef.current = false;
    preserveFocusRef.current = null;
    setMessageLayouts({});
    setPendingJumpId(null);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  return {
    scrollViewRef,
    handleScroll,
    followTail: followTailRef,
    scheduleScrollToEnd,
    registerScrollY,
    preserveFocusRef,
    messageLayouts,
    handleConversationItemLayout,
    capturePreserveFocus,
    pendingJumpId,
    setPendingJumpId,
    reset,
    cleanup,
  };
}
