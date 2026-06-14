const relativeMinutes = (value?: string) => {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized) return Number.POSITIVE_INFINITY;
  if (['now', 'just now'].includes(normalized)) return 0;

  const match = normalized.match(
    /(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)/,
  );

  if (match) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit.startsWith('m')) return amount;
    if (unit.startsWith('h')) return amount * 60;
    return amount * 24 * 60;
  }

  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    return Math.max(0, (Date.now() - parsed) / 60000);
  }

  return Number.POSITIVE_INFINITY;
};

export const newestFirst = (
  left?: string,
  right?: string,
) => relativeMinutes(left) - relativeMinutes(right);
