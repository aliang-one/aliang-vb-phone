import type {
  VibeCodingRun,
  Device,
  Project,
  AgentMessage,
} from '../../data/platformModels';
import {
  attachActiveSessionIds,
  attachDeviceRelations,
  attachProjectIds,
  capEventDetailCache,
  demoteIdleSessions,
  demoteRunDetail,
  evictStaleSessionDetail,
  EVENT_DETAIL_CACHE_MAX,
  IDLE_DEMOTE_MS,
  mergeAgentMessages,
  mergeVibeRunSnapshot,
  removeDeviceFromState,
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

  it('uses recent view time before activity time when choosing detail to evict', () => {
    const recentlyViewedOldActivity = makeRun({
      id: 'recently-viewed',
      status: 'completed',
      detailLoadedAt: '100',
      lastActivityMs: 1,
      lastViewedAt: 10_000,
      structuredEvents: [
        { kind: 'command', eventId: 'recent' } as unknown as VibeCodingRun['structuredEvents'][number],
      ],
    });
    const runs = [
      recentlyViewedOldActivity,
      ...Array.from({ length: 8 }, (_, i) =>
        makeRun({
          id: `older-view-${i}`,
          status: 'completed',
          detailLoadedAt: String(200 + i),
          lastActivityMs: 1_000 + i,
          lastViewedAt: 100 + i,
          structuredEvents: [
            { kind: 'command', eventId: `e${i}` } as unknown as VibeCodingRun['structuredEvents'][number],
          ],
        }),
      ),
    ];

    const out = evictStaleSessionDetail(runs);

    expect(out.find(r => r.id === 'recently-viewed')?.structuredEvents).toHaveLength(1);
    expect(out.find(r => r.id === 'older-view-0')?.structuredEvents).toEqual([]);
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

describe('mergeVibeRunSnapshot 双向 stale 守卫(事件驱动 status 的配套)', () => {
  // ai.done 把 status 翻 idle 并 bump lastActivityMs 后,一个滞后的 running 快照不能
  // 把它再翻回 running——否则回合结束会闪回进行中(就是当年要靠 8s 压的那种抖动)。
  // 真正的新回合(新发送 / 更新的活动)lastActivityMs 更新,不被拦截。
  it('不把已结算(idle)的会话被陈旧 running 快照重新激活', () => {
    const existing = makeRun({ id: 's1', status: 'idle', lastActivityMs: 100 });
    const incoming = makeRun({ id: 's1', status: 'running', lastActivityMs: 100 });
    expect(mergeVibeRunSnapshot(existing, incoming).status).toBe('idle');
  });

  it('更新的活动(newer lastActivityMs)的 running 快照可以重新激活(真新回合)', () => {
    const existing = makeRun({ id: 's1', status: 'idle', lastActivityMs: 100 });
    const incoming = makeRun({ id: 's1', status: 'running', lastActivityMs: 200 });
    expect(mergeVibeRunSnapshot(existing, incoming).status).toBe('running');
  });

  it('staleDemotion 仍然成立:活跃会话不被陈旧 idle 快照降级', () => {
    const existing = makeRun({ id: 's1', status: 'running', lastActivityMs: 200 });
    const incoming = makeRun({ id: 's1', status: 'idle', lastActivityMs: 100 });
    expect(mergeVibeRunSnapshot(existing, incoming).status).toBe('running');
  });
});

// Minimal device/project mocks — only fields the relation helpers touch. Cast
// through unknown so we don't materialize the full literal.
const makeDevice = (over: Partial<Device> & { id: string }): Device =>
  ({
    projectIds: [],
    activeSessionIds: [],
    ...over,
  }) as unknown as Device;

const makeProject = (over: Partial<Project> & { id: string }): Project =>
  over as unknown as Project;

describe('attachDeviceRelations referential stability', () => {
  it('returns the SAME array reference when nothing changed', () => {
    const devices = [makeDevice({ id: 'd1', projectIds: ['p1'] })];
    const projects = [makeProject({ id: 'p1', deviceId: 'd1' })];
    // Second call with identical inputs must hand back the same array.
    const first = attachDeviceRelations(devices, projects, []);
    const second = attachDeviceRelations(first, projects, []);
    expect(second).toBe(first);
  });

  it('returns the SAME array reference when activeSessionIds are unchanged', () => {
    const devices = [makeDevice({ id: 'd1', activeSessionIds: ['s1'] })];
    const runs = [makeRun({ id: 's1', deviceId: 'd1', status: 'running' })];
    const out = attachDeviceRelations(devices, [], runs);
    // The active set ['s1'] equals the existing one -> no rewrite.
    expect(out).toBe(devices);
  });

  it('keeps the SAME device object reference for an unchanged device', () => {
    const d1 = makeDevice({ id: 'd1', projectIds: ['p1'], activeSessionIds: [] });
    const d2 = makeDevice({ id: 'd2', projectIds: ['p2'], activeSessionIds: ['s9'] });
    const devices = [d1, d2];
    const projects = [
      makeProject({ id: 'p1', deviceId: 'd1' }),
      makeProject({ id: 'p2', deviceId: 'd2' }),
    ];
    const runs = [makeRun({ id: 's9', deviceId: 'd2', status: 'running' })];
    const out = attachDeviceRelations(devices, projects, runs);
    // Array is new (a re-derivation), but each unchanged device keeps its ref.
    expect(out[0]).toBe(d1);
    expect(out[1]).toBe(d2);
  });

  it('produces a NEW device object when its activeSessionIds change', () => {
    const d1 = makeDevice({ id: 'd1', activeSessionIds: [] });
    const runs = [makeRun({ id: 's1', deviceId: 'd1', status: 'running' })];
    const out = attachDeviceRelations([d1], [], runs);
    expect(out).not.toBe([d1]); // new array
    expect(out[0]).not.toBe(d1); // new device object
    expect(out[0].activeSessionIds).toEqual(['s1']);
  });

  it('produces a NEW device object when its projectIds change', () => {
    const d1 = makeDevice({ id: 'd1', projectIds: [] });
    const projects = [makeProject({ id: 'p1', deviceId: 'd1' })];
    const out = attachProjectIds([d1], projects);
    expect(out[0]).not.toBe(d1);
    expect(out[0].projectIds).toEqual(['p1']);
  });

  it('attachActiveSessionIds returns same ref when all devices unchanged', () => {
    const devices = [
      makeDevice({ id: 'd1', activeSessionIds: ['s1'] }),
      makeDevice({ id: 'd2', activeSessionIds: [] }),
    ];
    const runs = [makeRun({ id: 's1', deviceId: 'd1', status: 'running' })];
    expect(attachActiveSessionIds(devices, runs)).toBe(devices);
  });
});

describe('mergeAgentMessages', () => {
  // A failed-to-send user message lives only on the client (it never reached
  // the server, so it has no server id). Server-snapshot merges must not drop
  // it — otherwise the retryable bubble vanishes the next time the session
  // state is published.
  it('preserves a client-only failed user bubble across a server snapshot', () => {
    const failed: AgentMessage = {
      id: 'opt_1',
      role: 'user',
      content: '你好',
      timestamp: 't1',
      failed: true,
    };
    const existing: AgentMessage[] = [
      { id: 'srv_a', role: 'assistant', content: 'prior reply', timestamp: 't0' },
      failed,
    ];
    // Server snapshot lacks the failed optimistic message (it never reached
    // the server); it must survive the merge.
    const incoming: AgentMessage[] = [
      { id: 'srv_a', role: 'assistant', content: 'prior reply', timestamp: 't0' },
    ];
    const merged = mergeAgentMessages(existing, incoming);
    expect(merged.some(m => m.id === 'opt_1' && m.failed === true)).toBe(true);
  });

  it('keeps the failed flag on a failed user message when the server pushes unrelated updates', () => {
    const failed: AgentMessage = {
      id: 'opt_2',
      role: 'user',
      content: '在吗',
      timestamp: 't2',
      failed: true,
    };
    const merged = mergeAgentMessages([failed], [
      { id: 'srv_b', role: 'assistant', content: 'reply', timestamp: 't3' },
    ]);
    const kept = merged.find(m => m.id === 'opt_2');
    expect(kept).toBeDefined();
    expect(kept?.failed).toBe(true);
  });
});

describe('removeDeviceFromState', () => {
  it('removes the device, its projects and vibe runs, and emits an event', () => {
    const devices = [makeDevice({ id: 'd1' }), makeDevice({ id: 'd2' })];
    const projects = [makeProject({ id: 'p1', deviceId: 'd1' }), makeProject({ id: 'p2', deviceId: 'd2' })];
    const vibeRuns = [makeRun({ id: 'r1', deviceId: 'd1' })];
    const result = removeDeviceFromState(devices, projects, vibeRuns, [], 'd1', 'Dev One');
    expect(result.devices.map(d => d.id)).toEqual(['d2']);
    expect(result.projects.map(p => p.id)).toEqual(['p2']);
    expect(result.vibeRuns.map(r => r.id)).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Device removed');
    expect(result.events[0].detail).toBe('Dev One');
    expect(result.events[0].type).toBe('device.bound');
  });

  it('leaves unrelated devices/projects untouched when deviceId absent', () => {
    const devices = [makeDevice({ id: 'd2' })];
    const projects = [makeProject({ id: 'p2', deviceId: 'd2' })];
    const result = removeDeviceFromState(devices, projects, [], [], 'missing', 'X');
    expect(result.devices.map(d => d.id)).toEqual(['d2']);
    expect(result.projects.map(p => p.id)).toEqual(['p2']);
    expect(result.events).toHaveLength(1);
  });
});
