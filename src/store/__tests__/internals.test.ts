import type { VibeCodingRun } from '../../data/platformModels';
import {
  capEventDetailCache,
  demoteIdleSessions,
  demoteRunDetail,
  evictStaleSessionDetail,
  EVENT_DETAIL_CACHE_MAX,
  IDLE_DEMOTE_MS,
  mergeVibeRunSnapshot,
} from '../internals';

// Minimal run mock — only fields the helpers touch. Cast through unknown so we
// don't materialize the full VibeCodingRun literal.
const makeRun = (over: Partial<VibeCodingRun> & { id: string }): VibeCodingRun =>
  ({
    status: 'completed',
    transcript: [],
    events: [],
    structuredEvents: [],
    ...over,
  }) as unknown as VibeCodingRun;

describe('capEventDetailCache', () => {
  it('keeps the newest EVENT_DETAIL_CACHE_MAX entries (FIFO)', () => {
    const cache: Record<string, { text?: string }> = {};
    for (let i = 0; i < EVENT_DETAIL_CACHE_MAX + 5; i++) {
      cache[`e${i}`] = { text: `out ${i}` };
    }
    const capped = capEventDetailCache(cache);
    expect(Object.keys(capped)).toHaveLength(EVENT_DETAIL_CACHE_MAX);
    // Oldest dropped, newest retained.
    expect(capped.e0).toBeUndefined();
    expect(capped.e4).toBeUndefined();
    expect(capped.e5).toBeDefined();
    expect(capped[`e${EVENT_DETAIL_CACHE_MAX + 4}`]).toBeDefined();
  });

  it('returns the same reference when under the limit', () => {
    const cache = { e1: { text: 'a' } };
    expect(capEventDetailCache(cache)).toBe(cache);
  });
});

describe('demoteRunDetail', () => {
  it('clears resident detail but keeps list metadata', () => {
    const run = makeRun({
      id: 's1',
      title: 'My session',
      status: 'completed',
      lastActivityMs: 123,
      detailLoadedAt: '100',
      transcript: [{ id: 'm1' } as unknown as VibeCodingRun['transcript'][number]],
      events: [{ id: 'x' } as unknown as VibeCodingRun['events'][number]],
      structuredEvents: [
        { kind: 'command', eventId: 'e1' } as unknown as VibeCodingRun['structuredEvents'][number],
      ],
      eventDetailCache: { e1: { text: 'big' } },
    });
    const out = demoteRunDetail(run);
    expect(out.id).toBe('s1');
    expect(out.title).toBe('My session');
    expect(out.status).toBe('completed');
    expect(out.lastActivityMs).toBe(123);
    expect(out.transcript).toEqual([]);
    expect(out.events).toEqual([]);
    expect(out.structuredEvents).toEqual([]);
    expect(out.eventDetailCache).toBeUndefined();
    expect(out.detailLoadedAt).toBeUndefined();
  });
});

describe('demoteIdleSessions', () => {
  const now = 10_000_000;

  it('demotes an idle, not-viewed session past the threshold', () => {
    const idle = makeRun({
      id: 'idle',
      status: 'completed',
      lastViewedAt: now - IDLE_DEMOTE_MS - 1,
      structuredEvents: [
        { kind: 'command', eventId: 'e1' } as unknown as VibeCodingRun['structuredEvents'][number],
      ],
    });
    const out = demoteIdleSessions([idle], now);
    expect(out[0].structuredEvents).toEqual([]);
    expect(out[0].detailLoadedAt).toBeUndefined();
  });

  it('never demotes an active (streaming) session', () => {
    const active = makeRun({
      id: 'active',
      status: 'running',
      lastViewedAt: now - IDLE_DEMOTE_MS - 1,
      structuredEvents: [
        { kind: 'command', eventId: 'e1' } as unknown as VibeCodingRun['structuredEvents'][number],
      ],
    });
    const out = demoteIdleSessions([active], now);
    expect(out[0].structuredEvents).toHaveLength(1);
  });

  it('never demotes the currently-viewed session', () => {
    const viewed = makeRun({
      id: 'viewed',
      status: 'completed',
      lastViewedAt: now - IDLE_DEMOTE_MS - 1,
      structuredEvents: [
        { kind: 'command', eventId: 'e1' } as unknown as VibeCodingRun['structuredEvents'][number],
      ],
    });
    const out = demoteIdleSessions([viewed], now, 'viewed');
    expect(out[0].structuredEvents).toHaveLength(1);
  });

  it('does not demote a session within the idle threshold', () => {
    const fresh = makeRun({
      id: 'fresh',
      status: 'completed',
      lastViewedAt: now - 1000, // well within threshold
      structuredEvents: [
        { kind: 'command', eventId: 'e1' } as unknown as VibeCodingRun['structuredEvents'][number],
      ],
    });
    const out = demoteIdleSessions([fresh], now);
    expect(out[0].structuredEvents).toHaveLength(1);
  });

  it('does not demote a never-viewed session (no lastViewedAt)', () => {
    const never = makeRun({
      id: 'never',
      status: 'completed',
      structuredEvents: [
        { kind: 'command', eventId: 'e1' } as unknown as VibeCodingRun['structuredEvents'][number],
      ],
    });
    const out = demoteIdleSessions([never], now);
    expect(out[0].structuredEvents).toHaveLength(1);
  });

  it('returns the same array reference when nothing changes', () => {
    const active = makeRun({ id: 'a', status: 'running' });
    const runs = [active];
    expect(demoteIdleSessions(runs, now)).toBe(runs);
  });
});

describe('evictStaleSessionDetail clears structured activity too', () => {
  it('evicts oldest inactive detailed session AND clears its structuredEvents/detailCache', () => {
    // MAX_SESSION_DETAIL = 8: build 9 detailed inactive sessions.
    const runs = Array.from({ length: 9 }, (_, i) =>
      makeRun({
        id: `s${i}`,
        status: 'completed',
        detailLoadedAt: String(100 + i),
        lastActivityMs: 1000 + i, // s0 oldest
        structuredEvents: [
          { kind: 'command', eventId: `e${i}` } as unknown as VibeCodingRun['structuredEvents'][number],
        ],
        eventDetailCache: { [`e${i}`]: { text: 'x' } },
      }),
    );
    const out = evictStaleSessionDetail(runs);
    // Exactly one evicted (overflow = 1), the oldest (s0).
    const evicted = out.find(r => r.id === 's0')!;
    expect(evicted.structuredEvents).toEqual([]);
    expect(evicted.eventDetailCache).toBeUndefined();
    expect(evicted.detailLoadedAt).toBeUndefined();
    // Others retain their activity.
    const kept = out.find(r => r.id === 's8')!;
    expect(kept.structuredEvents).toHaveLength(1);
  });
});

describe('mergeVibeRunSnapshot preserves client-only lastViewedAt', () => {
  it('keeps existing lastViewedAt when the incoming snapshot lacks it', () => {
    const existing = makeRun({ id: 's1', lastViewedAt: 12345 });
    const incoming = makeRun({ id: 's1' }); // snapshot never carries lastViewedAt
    const out = mergeVibeRunSnapshot(existing, incoming);
    expect(out.lastViewedAt).toBe(12345);
  });
});
