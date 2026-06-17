import { useEffect, useState } from 'react';

// Relative-time labels ("刚刚" / "5 分钟前") are derived from an activity
// timestamp, but unless something forces a re-render they freeze at the value
// computed when the activity happened — a session idle for an hour would keep
// showing "刚刚". This hook drives a re-render on a shared cadence so those
// labels stay fresh.
//
// It uses ONE module-level interval ref-counted across all subscribers, so a
// list of N cards does not spin up N timers — the interval runs only while at
// least one subscriber is mounted, and stops when the last one unmounts.

const TICK_MS = 30_000;

const subscribers = new Set<(ts: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let lastTick = Date.now();

function ensureTicking() {
  if (timer) return;
  lastTick = Date.now();
  timer = setInterval(() => {
    lastTick = Date.now();
    for (const handler of subscribers) handler(lastTick);
  }, TICK_MS);
  // A node-style unref would let the timer keep the JS thread alive; React
  // Native's setInterval has no unref, but the interval is short and shared.
}

function stopIfIdle() {
  if (subscribers.size > 0 || !timer) return;
  clearInterval(timer);
  timer = null;
}

/**
 * Re-render the caller roughly every 30s. Returns the latest tick epoch ms so
 * callers can also key derived values off it. Use it wherever a relative-time
 * label is rendered from a stored timestamp.
 */
export function useNowTick(): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    lastTick = Date.now();
    setTick(lastTick);
    const handler = (nextTick: number) => setTick(nextTick);
    subscribers.add(handler);
    ensureTicking();
    return () => {
      subscribers.delete(handler);
      stopIfIdle();
    };
  }, []);
  return tick;
}
