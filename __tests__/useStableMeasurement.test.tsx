/**
 * Convergence guards for the `onLayout → setState` pattern.
 *
 * On the New Architecture (Fabric), `event.nativeEvent.layout.{width,height,x,y}`
 * is reported with sub-pixel precision. A handler that stores that raw float
 * straight into `useState` defeats React's `Object.is` bailout (`733.3333` !==
 * `733.3334`), so every layout pass re-renders, which re-lays-out, which fires
 * `onLayout` again → `Maximum update depth exceeded` crash. These tests pin the
 * rounding + tolerance behavior that breaks that loop.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  mergeMeasuredLayouts,
  shouldCommitMeasurement,
  useStableMeasurement,
} from '../src/hooks/useStableMeasurement';

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

describe('shouldCommitMeasurement', () => {
  test('commits the first real measurement away from the initial 0', () => {
    expect(shouldCommitMeasurement(0, 733)).toBe(true);
  });

  test('skips an identical value', () => {
    expect(shouldCommitMeasurement(733, 733)).toBe(false);
  });

  test('skips sub-pixel jitter that triggers the Fabric onLayout loop', () => {
    expect(shouldCommitMeasurement(733.3333, 733.3334)).toBe(false);
  });

  test('commits a real change at or beyond the tolerance', () => {
    expect(shouldCommitMeasurement(733, 734)).toBe(true);
    expect(shouldCommitMeasurement(733, 735)).toBe(true);
  });

  test('honors a custom tolerance', () => {
    expect(shouldCommitMeasurement(100, 103, 5)).toBe(false);
    expect(shouldCommitMeasurement(100, 106, 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface Probe {
  getValue: () => number;
  getCommit: () => (next: number) => void;
  getRenderCount: () => number;
  unmount: () => void;
}

/**
 * Render the hook through a throwaway component. The component writes the
 * latest `[value, commit]` into outer `let`s on every render — mirroring the
 * proven `probeRenders` pattern in stableVibeRuns.test.tsx (React 19 dev
 * double-invokes render, so capture-via-render is the reliable channel).
 */
function renderProbe(initial?: number, tolerance?: number): Probe {
  let value = initial ?? 0;
  let commit: (next: number) => void = () => {};
  let renderCount = 0;
  const Holder = () => {
    renderCount += 1;
    const tuple = useStableMeasurement(initial, tolerance);
    value = tuple[0];
    commit = tuple[1];
    return null;
  };
  // Mount inside act — React 19 won't flush a later setState on a component
  // that was mounted outside act, which is exactly the symptom these tests
  // target (settle at 0 forever).
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Holder />);
  });
  return {
    getValue: () => value,
    getCommit: () => commit,
    getRenderCount: () => renderCount,
    unmount: () => renderer.unmount(),
  };
}

describe('useStableMeasurement', () => {
  test('exposes the initial value before any layout event', () => {
    const probe = renderProbe(0);
    expect(probe.getValue()).toBe(0);
    probe.unmount();
  });

  test('commits the first measured value, rounded to an integer', () => {
    const probe = renderProbe(0);
    act(() => probe.getCommit()(733.4));
    expect(probe.getValue()).toBe(733);
    probe.unmount();
  });

  test('does NOT re-render on sub-pixel jitter around a settled integer', () => {
    // This is the exact regression: Fabric reports a fresh fractional layout
    // on every pass. Without rounding + tolerance, each one re-renders and the
    // view re-lays-out → infinite loop → crash.
    const probe = renderProbe(0);
    act(() => probe.getCommit()(733.4)); // settles to 733
    const rendersAfterSettle = probe.getRenderCount();

    act(() => probe.getCommit()(733.2));
    act(() => probe.getCommit()(733.49));
    act(() => probe.getCommit()(733.01));
    act(() => probe.getCommit()(733.4999));

    expect(probe.getValue()).toBe(733);
    expect(probe.getRenderCount()).toBe(rendersAfterSettle); // zero extra renders
    probe.unmount();
  });

  test('commits when the rounded integer actually changes', () => {
    const probe = renderProbe(0);
    act(() => probe.getCommit()(733.4));
    act(() => probe.getCommit()(735.6));
    expect(probe.getValue()).toBe(736);
    probe.unmount();
  });

  test('commit is stable across renders (no fresh closure churn)', () => {
    const probe = renderProbe(0);
    const firstCommit = probe.getCommit();
    act(() => probe.getCommit()(100.5)); // forces a re-render
    expect(probe.getCommit()).toBe(firstCommit);
    probe.unmount();
  });
});

// ---------------------------------------------------------------------------
// Per-item layout map merge (deferred flush convergence)
// ---------------------------------------------------------------------------

describe('mergeMeasuredLayouts', () => {
  test('returns the SAME reference when nothing is pending', () => {
    const current = { a: { top: 10, height: 50 } };
    expect(mergeMeasuredLayouts(current, [])).toBe(current);
  });

  test('returns the SAME reference when pending values equal committed (sub-pixel already rounded away)', () => {
    const current = { a: { top: 10, height: 50 } };
    // Same rounded values → no meaningful change → bail (no re-render).
    const result = mergeMeasuredLayouts(current, [
      ['a', { top: 10, height: 50 }],
    ]);
    expect(result).toBe(current);
  });

  test('returns a NEW map with the changed item when an axis moved >=1px', () => {
    const current = { a: { top: 10, height: 50 }, b: { top: 80, height: 20 } };
    const result = mergeMeasuredLayouts(current, [
      ['a', { top: 12, height: 50 }], // top moved 2px → commit
    ]);
    expect(result).not.toBe(current);
    expect(result.a).toEqual({ top: 12, height: 50 });
    expect(result.b).toBe(current.b); // unchanged item keeps its value
  });

  test('adds a brand-new item', () => {
    const current = { a: { top: 10, height: 50 } };
    const result = mergeMeasuredLayouts(current, [
      ['c', { top: 200, height: 30 }],
    ]);
    expect(result).not.toBe(current);
    expect(result.c).toEqual({ top: 200, height: 30 });
  });

  test('coalesces a burst: only changed items are written, in one new map', () => {
    const current = { a: { top: 10, height: 50 }, b: { top: 80, height: 20 } };
    const result = mergeMeasuredLayouts(current, [
      ['a', { top: 10, height: 50 }], // unchanged
      ['b', { top: 90, height: 20 }], // changed
      ['c', { top: 200, height: 30 }], // new
    ]);
    expect(result).not.toBe(current);
    expect(result.a).toEqual({ top: 10, height: 50 });
    expect(result.b).toEqual({ top: 90, height: 20 });
    expect(result.c).toEqual({ top: 200, height: 30 });
  });
});
