/** Debounce state for coarse server snapshot refreshes. */
const REFRESH_DEBOUNCE_MS = 250;

let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function cancelRefreshDebounce(): void {
  if (refreshDebounceTimer) {
    clearTimeout(refreshDebounceTimer);
    refreshDebounceTimer = null;
  }
}

/** Coalesce a burst of `*.updated` realtime messages into a single snapshot reload. */
export function scheduleRefreshDebounce(run: () => void): void {
  if (refreshDebounceTimer) {
    clearTimeout(refreshDebounceTimer);
  }
  refreshDebounceTimer = setTimeout(() => {
    refreshDebounceTimer = null;
    run();
  }, REFRESH_DEBOUNCE_MS);
}
