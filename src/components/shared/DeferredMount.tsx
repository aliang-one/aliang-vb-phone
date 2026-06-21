import React, { useLayoutEffect, useState } from 'react';

// The deferral is a production-only perf optimization: it triggers a second
// (heavy) render ~1-2 frames after mount. Under jest that deferred render is
// driven synchronously by a layout effect, which the react-native-reanimated
// mock can't survive (its useAnimatedStyle throws during a sync re-render
// inside act()). Since tests render synchronously and query immediately, there
// is nothing to defer anyway — render children on the first commit, matching
// pre-existing screen behavior. Production keeps the real rAF path.
const IN_TEST = typeof jest !== 'undefined';

interface DeferredMountProps {
  /**
   * Number of animation frames to wait before mounting `children`. Default 2
   * — enough for a bottom-tab cross-fade / bottom-bar animation to paint its
   * cheap shell first, so the heavy subtree's synchronous JS commit no longer
   * races the transition's first frames.
   */
  delayFrames?: number;
  /** Cheap shell rendered immediately while `children` are deferred. */
  fallback?: React.ReactNode;
  /**
   * When false, `children` mount immediately (no deferral). Lets callers gate
   * deferral on conditions (e.g. only the first mount, not subsequent visits).
   * Default true.
   */
  active?: boolean;
  children: React.ReactNode;
}

/**
 * Render `fallback` now, mount `children` after `delayFrames` animation frames.
 *
 * Context: the four main tabs read everything from the control-center store,
 * so switching is NOT blocked on an API call — but each tab's first mount is a
 * single big synchronous JS-thread commit (many GlassPanel/IconBadge/SVG nodes
 * plus several O(n log n) `useMemo` derivations). That commit races the tab
 * transition and is the perceived "tap-to-switch lag". Splitting each screen
 * into an instant cheap shell + a deferred heavy body moves that commit off
 * the transition's critical frames.
 *
 * Paired with `freezeOnBlur: true` on the tab navigator, the deferral runs
 * once on first mount — later visits thaw an already-mounted tree instantly.
 *
 * `requestAnimationFrame` is the right signal here: bottom-tab switches don't
 * hold an `InteractionManager` handle, and `InteractionManager` is deprecated
 * in RN 0.85.
 */
export const DeferredMount: React.FC<DeferredMountProps> = ({
  delayFrames = 2,
  fallback = null,
  active = true,
  children,
}) => {
  const [ready, setReady] = useState(!active || IN_TEST);

  // useLayoutEffect (not useEffect): the deferral must resolve synchronously
  // inside a test's act() so deferred children are queryable. In production the
  // layout effect only schedules rAF and returns immediately — it does not
  // block the first paint, so the cheap shell still shows first and the heavy
  // subtree mounts ~1-2 frames later.
  useLayoutEffect(() => {
    if (!active) {
      setReady(true);
      return;
    }
    if (ready) {
      return;
    }
    let cancelled = false;
    const handles: number[] = [];
    let remaining = Math.max(0, delayFrames);

    const schedule = () => {
      if (cancelled) return;
      if (remaining <= 0) {
        setReady(true);
        return;
      }
      remaining -= 1;
      handles.push(requestAnimationFrame(schedule));
    };
    schedule();

    return () => {
      cancelled = true;
      handles.forEach(handle => cancelAnimationFrame(handle));
    };
    // delayFrames/active are static for our callers; we intentionally only
    // run the deferral once per mount (re-renders must not re-defer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return <>{fallback}</>;
  return <>{children}</>;
};
