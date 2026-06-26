import {
  resolveSystemMode,
  isDaytime,
  DAY_START_HOUR,
  DAY_END_HOUR,
} from '../src/theme/systemTheme';

// Build a date at a given local hour/minute so the suite never depends on the
// real wall clock — the helper reads device-local time via getHours().
const at = (hour: number, minute = 0) => new Date(2026, 5, 15, hour, minute, 0);

describe('systemTheme (time-based day/night)', () => {
  it('treats 07:00–18:59 as daytime → light', () => {
    expect(resolveSystemMode(at(7, 0))).toBe('light');
    expect(resolveSystemMode(at(12, 30))).toBe('light');
    expect(resolveSystemMode(at(18, 59))).toBe('light');
  });

  it('switches to dark at 19:00 exactly', () => {
    expect(resolveSystemMode(at(19, 0))).toBe('dark');
    expect(resolveSystemMode(at(23, 30))).toBe('dark');
  });

  it('is dark before 07:00 (early morning and midnight)', () => {
    expect(resolveSystemMode(at(6, 59))).toBe('dark');
    expect(resolveSystemMode(at(0, 0))).toBe('dark');
    expect(resolveSystemMode(at(3, 15))).toBe('dark');
  });

  it('exposes the configured day window as constants', () => {
    expect(DAY_START_HOUR).toBe(7);
    expect(DAY_END_HOUR).toBe(19);
  });

  it('isDaytime agrees with resolveSystemMode', () => {
    expect(isDaytime(at(9))).toBe(true);
    expect(isDaytime(at(20))).toBe(false);
  });
});
