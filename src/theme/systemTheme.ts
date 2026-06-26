/**
 * Time-based resolution for the "system" theme mode.
 *
 * Unlike a classic "follow OS appearance" setting, this app's "system" mode
 * follows the device's local wall-clock: daytime → light, otherwise → dark.
 * Kept as pure functions (no React) so the day/night boundary is unit-testable
 * without touching the wall clock.
 */

/** Inclusive start of the daytime window (07:00 local). */
export const DAY_START_HOUR = 7;

/** Exclusive end of the daytime window (19:00 local → dark from here). */
export const DAY_END_HOUR = 19;

/** True when the given (device-local) moment falls inside the daytime window. */
export function isDaytime(date: Date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
}

/** Resolves the effective palette for "system" mode from the local time of day. */
export function resolveSystemMode(date: Date = new Date()): 'light' | 'dark' {
  return isDaytime(date) ? 'light' : 'dark';
}
