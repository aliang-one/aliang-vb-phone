/**
 * Human-readable byte formatting, mirroring the desktop dashboard's
 * `format_bytes_display` so traffic usage looks the same on mobile.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes: number | null | undefined, fractionDigits = 2): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const i = Math.min(
    UNITS.length - 1,
    Math.floor(Math.log(value) / Math.log(1024)),
  );
  const scaled = value / Math.pow(1024, i);
  // Drop trailing decimals for the largest tidy unit when it is whole-ish.
  const digits = scaled >= 100 || i === 0 ? 0 : fractionDigits;
  return `${scaled.toFixed(digits)} ${UNITS[i]}`;
}

/** 0–100 percentage, guarded against divide-by-zero. */
export function ratioPercent(used: number, total: number): number {
  const u = Number(used ?? 0);
  const t = Number(total ?? 0);
  if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0) return 0;
  return Math.max(0, Math.min(100, (u / t) * 100));
}

/** Whole days from now until an ISO date string (clamped at 0). */
export function daysUntil(iso: string | null | undefined): number {
  if (!iso) return 0;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 0;
  const diff = then - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/** Short, locale-neutral date (YYYY-MM-DD) from an ISO/datetime string. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 10);
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
