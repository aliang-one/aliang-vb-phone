import { approvalCountdown } from '../../src/utils/approvalCountdown';

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 3_600_000;

describe('approvalCountdown', () => {
  it('returns null when expiresAt is missing or invalid', () => {
    expect(approvalCountdown(undefined, NOW)).toBeNull();
    expect(approvalCountdown(NaN, NOW)).toBeNull();
    expect(approvalCountdown(Number.POSITIVE_INFINITY, NOW)).toBeNull();
  });

  it('returns null once expired (boundary inclusive)', () => {
    expect(approvalCountdown(NOW - 1, NOW)).toBeNull();
    expect(approvalCountdown(NOW, NOW)).toBeNull();
  });

  it('marks < 2min as expiring', () => {
    expect(approvalCountdown(NOW + 1, NOW)).toEqual({ tier: 'expiring' });
    expect(approvalCountdown(NOW + 2 * MIN - 1, NOW)).toEqual({
      tier: 'expiring',
    });
  });

  it('buckets 2min..1h as minutes (ceil)', () => {
    expect(approvalCountdown(NOW + 2 * MIN, NOW)).toEqual({
      tier: 'minutes',
      minutes: 2,
    });
    expect(approvalCountdown(NOW + 5 * MIN + 30_000, NOW)).toEqual({
      tier: 'minutes',
      minutes: 6,
    });
    expect(approvalCountdown(NOW + HOUR, NOW)).toEqual({
      tier: 'minutes',
      minutes: 60,
    });
  });

  it('buckets > 1h as hours (round)', () => {
    expect(approvalCountdown(NOW + HOUR + 1, NOW)).toEqual({
      tier: 'hours',
      hours: 1,
    });
    expect(approvalCountdown(NOW + 2 * HOUR + 40 * MIN, NOW)).toEqual({
      tier: 'hours',
      hours: 3,
    });
  });
});
