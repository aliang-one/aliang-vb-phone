import { isSessionSnapshotStale } from '../sessionSnapshotStale';

// All cases use a fixed `now` so the predicate stays pure/deterministic.
const NOW = 100_000;
const LIVE_WINDOW_MS = 8_000;
const AWAY_THRESHOLD_MS = 60_000;

describe('isSessionSnapshotStale', () => {
  it('is stale when away longer than the away threshold (demotion / missed events)', () => {
    expect(
      isSessionSnapshotStale({
        now: NOW,
        status: 'idle',
        lastActivityMs: NOW - 5_000, // activity fresh
        lastViewedAt: NOW - AWAY_THRESHOLD_MS, // but away >= threshold
        awayThresholdMs: AWAY_THRESHOLD_MS,
        liveWindowMs: LIVE_WINDOW_MS,
      }),
    ).toBe(true);
  });

  it('is NOT stale when freshly viewed and activity is current', () => {
    expect(
      isSessionSnapshotStale({
        now: NOW,
        status: 'running',
        lastActivityMs: NOW - 1_000,
        lastViewedAt: NOW - 2_000,
        awayThresholdMs: AWAY_THRESHOLD_MS,
        liveWindowMs: LIVE_WINDOW_MS,
      }),
    ).toBe(false);
  });

  it('is stale when claiming running but no local activity within the live window', () => {
    expect(
      isSessionSnapshotStale({
        now: NOW,
        status: 'running',
        lastActivityMs: NOW - LIVE_WINDOW_MS - 1, // beyond the window
        lastViewedAt: NOW - 1_000, // just focused
        awayThresholdMs: AWAY_THRESHOLD_MS,
        liveWindowMs: LIVE_WINDOW_MS,
      }),
    ).toBe(true);
  });

  it('does NOT treat a settled idle session as stale just because activity is old', () => {
    expect(
      isSessionSnapshotStale({
        now: NOW,
        status: 'idle',
        lastActivityMs: NOW - 10 * LIVE_WINDOW_MS, // old activity
        lastViewedAt: NOW - 1_000, // just focused, never left
        awayThresholdMs: AWAY_THRESHOLD_MS,
        liveWindowMs: LIVE_WINDOW_MS,
      }),
    ).toBe(false);
  });

  it('is stale for a running session with no lastViewedAt yet and stale activity', () => {
    expect(
      isSessionSnapshotStale({
        now: NOW,
        status: 'running',
        lastActivityMs: NOW - LIVE_WINDOW_MS - 1,
        lastViewedAt: undefined,
        awayThresholdMs: AWAY_THRESHOLD_MS,
        liveWindowMs: LIVE_WINDOW_MS,
      }),
    ).toBe(true);
  });

  it('is NOT stale for an idle session never viewed with fresh-ish activity', () => {
    expect(
      isSessionSnapshotStale({
        now: NOW,
        status: 'idle',
        lastActivityMs: NOW - 1_000,
        lastViewedAt: undefined,
        awayThresholdMs: AWAY_THRESHOLD_MS,
        liveWindowMs: LIVE_WINDOW_MS,
      }),
    ).toBe(false);
  });

  it('boundary: away exactly equal to threshold is stale (>=)', () => {
    expect(
      isSessionSnapshotStale({
        now: NOW,
        status: 'idle',
        lastActivityMs: NOW - 1_000,
        lastViewedAt: NOW - AWAY_THRESHOLD_MS,
        awayThresholdMs: AWAY_THRESHOLD_MS,
        liveWindowMs: LIVE_WINDOW_MS,
      }),
    ).toBe(true);
  });
});
