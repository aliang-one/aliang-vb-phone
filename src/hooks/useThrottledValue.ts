import { useEffect, useRef, useState } from 'react';

export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [published, setPublished] = useState(value);
  const latestRef = useRef(value);
  const lastPublishedAtRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  latestRef.current = value;

  useEffect(() => {
    const clearTimer = () => {
      if (!timerRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    if (intervalMs <= 0) {
      clearTimer();
      lastPublishedAtRef.current = Date.now();
      setPublished(value);
      return;
    }

    const elapsed = Date.now() - lastPublishedAtRef.current;
    if (elapsed >= intervalMs) {
      clearTimer();
      lastPublishedAtRef.current = Date.now();
      setPublished(value);
      return;
    }
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastPublishedAtRef.current = Date.now();
      setPublished(latestRef.current);
    }, intervalMs - elapsed);
  }, [intervalMs, value]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return published;
}
