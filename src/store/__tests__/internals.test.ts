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
  mergeEarlierAgentMessages,
  mergeVibeRunSnapshot,
  removeDeviceFromState,
  resolveRefreshAction,
  isConnectionFailed,
  serverAiSessionToVibeRun,
} from '../internals';
import type { PlatformAiSessionSnapshot } from '../../services/platformTransport';

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
      detailState: { kind: 'ready' },
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
    expect(out.detailState).toBeUndefined();
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
    expect(out[0].detailState).toBeUndefined();
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
        detailState: { kind: 'ready' },
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
    expect(evicted.detailState).toBeUndefined();
    // Others retain their activity.
    const kept = out.find(r => r.id === 's8')!;
    expect(kept.structuredEvents).toHaveLength(1);
  });

  it('uses recent view time before activity time when choosing detail to evict', () => {
    const recentlyViewedOldActivity = makeRun({
      id: 'recently-viewed',
      status: 'completed',
      detailState: { kind: 'ready' },
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
          detailState: { kind: 'ready' },
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
  // 服务端 soft-settle 广播把 status 翻 idle 并 bump lastActivityMs 后(ai.done 本身不再翻
  // idle——对齐服务端 soft-settle),一个滞后的 running 快照不能把它再翻回 running——否则回合
  // 结束会闪回进行中(就是当年要靠 8s 压的那种抖动)。真正的新回合(新发送 / 更新的活动)
  // lastActivityMs 更新,不被拦截。
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

describe('mergeVibeRunSnapshot protocol v2 revision authority', () => {
  it('lets the first versioned snapshot replace an unversioned optimistic state', () => {
    const existing = makeRun({
      id: 's1',
      status: 'running',
      phase: 'running',
      lastActivityMs: 86_400_000,
    });
    const incoming = makeRun({
      id: 's1',
      status: 'idle',
      phase: 'completed',
      runState: 'completed',
      runStateVersion: 1,
      lastActivityMs: 10,
    });
    expect(mergeVibeRunSnapshot(existing, incoming)).toMatchObject({
      status: 'idle',
      phase: 'completed',
      runState: 'completed',
      runStateVersion: 1,
    });
  });

  it('does not let an unversioned snapshot overwrite established v2 state', () => {
    const existing = makeRun({
      id: 's1',
      status: 'idle',
      phase: 'completed',
      runState: 'completed',
      runStateVersion: 4,
    });
    const incoming = makeRun({
      id: 's1',
      status: 'running',
      phase: 'running',
      lastActivityMs: 999_999,
    });
    expect(mergeVibeRunSnapshot(existing, incoming)).toMatchObject({
      status: 'idle',
      phase: 'completed',
      runState: 'completed',
      runStateVersion: 4,
    });
  });

  it('accepts a newer completed state even when the phone activity clock is ahead', () => {
    const existing = makeRun({
      id: 's1',
      status: 'running',
      phase: 'running',
      activeRunId: 'r1',
      runState: 'running',
      runStateVersion: 4,
      lastActivityMs: 86_400_000,
    });
    const incoming = makeRun({
      id: 's1',
      status: 'idle',
      phase: 'completed',
      latestRunId: 'r1',
      runState: 'completed',
      runStateVersion: 5,
      lastActivityMs: 10,
    });
    const merged = mergeVibeRunSnapshot(existing, incoming);
    expect(merged.status).toBe('idle');
    expect(merged.phase).toBe('completed');
    expect(merged.runState).toBe('completed');
    expect(merged.runStateVersion).toBe(5);
  });

  it('rejects an older running snapshot after completion', () => {
    const existing = makeRun({
      id: 's1',
      status: 'idle',
      phase: 'completed',
      latestRunId: 'r1',
      runState: 'completed',
      runStateVersion: 8,
    });
    const incoming = makeRun({
      id: 's1',
      status: 'running',
      phase: 'running',
      activeRunId: 'r1',
      runState: 'running',
      runStateVersion: 7,
      lastActivityMs: 999_999,
    });
    const merged = mergeVibeRunSnapshot(existing, incoming);
    expect(merged.status).toBe('idle');
    expect(merged.phase).toBe('completed');
    expect(merged.runStateVersion).toBe(8);
  });

  it('does not let a same-revision conflicting snapshot flip state', () => {
    const existing = makeRun({
      id: 's1',
      status: 'idle',
      phase: 'completed',
      runState: 'completed',
      runStateVersion: 3,
    });
    const incoming = makeRun({
      id: 's1',
      status: 'running',
      phase: 'running',
      runState: 'running',
      runStateVersion: 3,
    });
    expect(mergeVibeRunSnapshot(existing, incoming)).toMatchObject({
      status: 'idle',
      phase: 'completed',
      runState: 'completed',
      runStateVersion: 3,
    });
  });

  it('keeps an optimistic new run above snapshots from the previous revision', () => {
    const existing = makeRun({
      id: 's1',
      status: 'running',
      phase: 'running',
      optimisticRunPending: true,
      optimisticRunBaseVersion: 8,
    });
    const oldCompleted = makeRun({
      id: 's1',
      status: 'idle',
      phase: 'completed',
      latestRunId: 'old-run',
      runState: 'completed',
      runStateVersion: 8,
    });
    expect(mergeVibeRunSnapshot(existing, oldCompleted)).toMatchObject({
      status: 'running',
      phase: 'running',
      optimisticRunPending: true,
    });
  });

  it('lets the first newer run revision clear optimistic authority', () => {
    const existing = makeRun({
      id: 's1',
      status: 'running',
      phase: 'running',
      optimisticRunPending: true,
      optimisticRunBaseVersion: 8,
    });
    const nextRun = makeRun({
      id: 's1',
      status: 'running',
      phase: 'running',
      activeRunId: 'new-run',
      latestRunId: 'new-run',
      runState: 'queued',
      runStateVersion: 9,
    });
    expect(mergeVibeRunSnapshot(existing, nextRun)).toMatchObject({
      activeRunId: 'new-run',
      runStateVersion: 9,
      optimisticRunPending: false,
    });
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

describe('mergeEarlierAgentMessages — 引用复用(浏览历史卡顿修复)', () => {
  const msg = (id: string, content: string, index?: number): AgentMessage => ({
    id,
    role: 'assistant',
    content,
    timestamp: `t-${id}`,
    ...(index === undefined ? {} : { index }),
  });

  // 核心验收:agentTranscript 的 segmentCache 是 WeakMap<AgentMessage, ...>,
  // 按消息对象引用命中。加载更早一页若把"完全没变的旧消息"也重建对象,
  // 整个已加载历史的 markdown 解析缓存就会全量失效(每翻一页全量重解析)。
  it('keeps object identity of unchanged existing messages after loading an earlier page', () => {
    const old1 = msg('old_1', '较早回复一');
    const old2 = msg('old_2', '较早回复二');
    const newer = msg('new_1', '较新回复');
    const earlierPage = [msg('pre_1', '更早的一'), msg('pre_2', '更早的二')];

    const merged = mergeEarlierAgentMessages([old1, old2, newer], earlierPage);

    expect(merged.find(m => m.id === 'old_1')).toBe(old1);
    expect(merged.find(m => m.id === 'old_2')).toBe(old2);
    expect(merged.find(m => m.id === 'new_1')).toBe(newer);
  });

  it('keeps identity of earlier-page messages too (no pointless copies)', () => {
    const pre1 = msg('pre_1', '更早的一');
    const merged = mergeEarlierAgentMessages([msg('old_1', '旧')], [pre1]);
    expect(merged.find(m => m.id === 'pre_1')).toBe(pre1);
  });

  it('preserves value semantics when an id exists on both sides (existing fields win)', () => {
    const earlierCopy: AgentMessage = {
      id: 'dup',
      role: 'assistant',
      content: '旧内容',
      timestamp: 't-old',
      mode: 'text',
    };
    const existingCopy: AgentMessage = {
      id: 'dup',
      role: 'assistant',
      content: '新内容(可能被流式补全过)',
      timestamp: 't-new',
    };
    const merged = mergeEarlierAgentMessages([existingCopy], [earlierCopy]);
    const kept = merged.find(m => m.id === 'dup');
    // existing 的字段覆盖 earlier;earlier 独有键(mode)保留 —— 与旧
    // {...earlier, ...existing} 展开语义逐值一致。
    expect(kept?.content).toBe(existingCopy.content);
    expect(kept?.timestamp).toBe(existingCopy.timestamp);
    expect(kept?.mode).toBe('text');
    // 值被合并修改时必须产生新对象,不能就地改动任何一侧输入。
    expect(kept).not.toBe(earlierCopy);
    expect(kept).not.toBe(existingCopy);
    expect(earlierCopy.content).toBe('旧内容');
    expect(existingCopy.mode).toBeUndefined();
  });

  it('sorts by index when every merged message has one, otherwise keeps first-seen order', () => {
    const withIndexes = mergeEarlierAgentMessages(
      [msg('b', '二', 2), msg('a', '一', 1)],
      [msg('c', '三', 3)],
    );
    expect(withIndexes.map(m => m.id)).toEqual(['a', 'b', 'c']);

    const noIndexes = mergeEarlierAgentMessages(
      [msg('z', '现有末尾')],
      [msg('y', '更早一'), msg('x', '更早二')],
    );
    // 首现顺序:earlier 页先入,再接 existing 独有 —— 与旧实现一致。
    expect(noIndexes.map(m => m.id)).toEqual(['y', 'x', 'z']);
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

describe('resolveRefreshAction (断线/初始化失败自愈判定)', () => {
  // 用户报告的 bug:覆盖重装后冷启动 initializeFromServer 失败一次 → serverMode=false
  // → refreshFromServer 所有恢复路径(前台心跳/下拉刷新)因 !serverMode 直接 no-op,
  // 卡死成「Me 显登录但拉不到数据」,只有杀进程或重登才能解套。修复=!serverMode
  // 但仍持 token 时,refresh 改为重新跑 initializeFromServer(自愈),而非 no-op。
  it('serverMode + 有/无 token → 正常 refresh', () => {
    expect(resolveRefreshAction(true, true)).toBe('refresh');
    expect(resolveRefreshAction(true, false)).toBe('refresh');
  });

  it('!serverMode + 持 token → reinitialize(自愈,THE FIX)[BUG]', () => {
    expect(resolveRefreshAction(false, true)).toBe('reinitialize');
  });

  it('!serverMode + 无 token(已登出)→ noop(不空跑)', () => {
    expect(resolveRefreshAction(false, false)).toBe('noop');
  });
});

describe('isConnectionFailed (从未连上 → 显连接失败卡)', () => {
  // 用户报告:home/vibe/device 全空白、下拉无反应。根因=停在「init 失败」状态。
  // 三者全满足才显卡:!serverMode + 从未同步 + 确有失败原因(lastConnectError)。
  // lastConnectError 这一条排除「冷启动加载中」窗口,避免正常开 app 闪假告警。
  it('init 失败(未连上 + 从未同步 + 有错误)→ true [BUG 现场]', () => {
    expect(isConnectionFailed(false, null, 'HTTP 502')).toBe(true);
  });

  it('冷启动加载中(未连上 + 从未同步 + 还没失败)→ false(不闪假告警)', () => {
    expect(isConnectionFailed(false, null, null)).toBe(false);
  });

  it('连上了(serverMode=true)→ false,即便尚未同步', () => {
    expect(isConnectionFailed(true, null, null)).toBe(false);
  });

  it('曾同步过(lastSyncedAt 有值)后断线 → false(算 stale 暂态,不显失败卡)', () => {
    expect(isConnectionFailed(false, Date.now(), 'network')).toBe(false);
  });

  it('正常连上且有数据 → false', () => {
    expect(isConnectionFailed(true, Date.now(), null)).toBe(false);
  });
});

// --- Characterization tests: pin current behavior BEFORE the session-detail
// state-machine / DetailState refactor (#2/#3). These are NOT "desired behavior"
// specs — they document what the code does today so the refactor can prove it
// preserves every invariant. If any of these flips during the migration, that's
// a behavior change to investigate, not a test to update.
describe('mergeVibeRunSnapshot — characterization (refactor safety net)', () => {
  const detailedRun = (over: Partial<VibeCodingRun> & { id: string }): VibeCodingRun =>
    makeRun({
      status: 'completed',
      detailState: { kind: 'ready' },
      lastActivityMs: 1000,
      lastViewedAt: 5000,
      transcript: [
        { id: 'keep-1', role: 'user', content: 'old', timestamp: 't1' } as unknown as VibeCodingRun['transcript'][number],
      ],
      events: [
        { id: 'evt-1', type: 'status', title: 'old', detail: '', status: 'done', timestamp: 't1' } as unknown as VibeCodingRun['events'][number],
      ],
      ...over,
    });

  it('existing 缺省 → 原样返回 incoming', () => {
    const incoming = detailedRun({ id: 'x' });
    expect(mergeVibeRunSnapshot(undefined, incoming)).toBe(incoming);
  });

  it('incoming 无 detail(列表快照)→ 保留 existing 的 transcript/events(不擦)', () => {
    const existing = detailedRun({ id: 's1' });
    // A list snapshot: no transcript, no detailState.
    const snapshot = makeRun({
      id: 's1',
      status: 'completed',
      detailState: undefined,
      transcript: [],
      events: [],
      lastActivityMs: 2000,
    });
    const merged = mergeVibeRunSnapshot(existing, snapshot);
    expect(merged.transcript.map(m => m.id)).toEqual(['keep-1']);
    expect(merged.events.map(e => e.id)).toEqual(['evt-1']);
  });

  it('incoming 有 detail → 合并 transcript(incoming 内容进合并集,不丢)', () => {
    const existing = detailedRun({ id: 's1' });
    const incoming = detailedRun({
      id: 's1',
      transcript: [
        { id: 'keep-1', role: 'user', content: 'old', timestamp: 't1' } as unknown as VibeCodingRun['transcript'][number],
        { id: 'new-2', role: 'assistant', content: 'fresh', timestamp: 't2' } as unknown as VibeCodingRun['transcript'][number],
      ],
    });
    const merged = mergeVibeRunSnapshot(existing, incoming);
    expect(merged.transcript.map(m => m.id).sort()).toEqual(['keep-1', 'new-2']);
  });

  it('detailState: 权威 incoming(ready/empty)覆盖 existing;非权威 incoming 保留 existing', () => {
    // incoming authoritative wins over existing authoritative
    expect(
      mergeVibeRunSnapshot(
        detailedRun({ id: 's', detailState: { kind: 'ready' } }),
        detailedRun({ id: 's', detailState: { kind: 'empty' } }),
      ).detailState,
    ).toEqual({ kind: 'empty' });
    // existing retained when incoming is non-authoritative (recoverable_empty)
    expect(
      mergeVibeRunSnapshot(
        detailedRun({ id: 's', detailState: { kind: 'ready' } }),
        detailedRun({ id: 's', detailState: { kind: 'recoverable_empty' } }),
      ).detailState,
    ).toEqual({ kind: 'ready' });
    // existing retained when incoming is a list snapshot (undefined)
    expect(
      mergeVibeRunSnapshot(
        detailedRun({ id: 's', detailState: { kind: 'ready' } }),
        detailedRun({ id: 's', detailState: undefined }),
      ).detailState,
    ).toEqual({ kind: 'ready' });
    // both undefined → undefined
    expect(
      mergeVibeRunSnapshot(
        detailedRun({ id: 's', detailState: undefined }),
        detailedRun({ id: 's', detailState: undefined }),
      ).detailState,
    ).toBeUndefined();
  });

  it('lastViewedAt 永远取 existing(快照不带,不能擦)', () => {
    const existing = detailedRun({ id: 's', lastViewedAt: 5000 });
    const snapshot = detailedRun({ id: 's', lastViewedAt: undefined });
    expect(mergeVibeRunSnapshot(existing, snapshot).lastViewedAt).toBe(5000);
  });

  it('lastActivityMs 取 max(existing, incoming)', () => {
    const merged = mergeVibeRunSnapshot(
      detailedRun({ id: 's', lastActivityMs: 1000 }),
      detailedRun({ id: 's', lastActivityMs: 3000 }),
    );
    expect(merged.lastActivityMs).toBe(3000);
  });

  it('stale guard: 旧 runStateVersion 不能把活跃会话降级(状态/相位保留 existing)', () => {
    const existing = detailedRun({ id: 's', status: 'running', runStateVersion: 5 });
    const incoming = detailedRun({
      id: 's',
      status: 'completed',
      runStateVersion: 4, // older
      lastActivityMs: 500, // also older — must not demote
    });
    const merged = mergeVibeRunSnapshot(existing, incoming);
    expect(merged.status).toBe('running');
    expect(merged.runStateVersion).toBe(5);
  });

  it('stale reactivation: 已结算会话不被活动不更新的活跃快照重新激活', () => {
    const existing = detailedRun({ id: 's', status: 'completed', lastActivityMs: 1000 });
    const incoming = detailedRun({
      id: 's',
      status: 'running',
      lastActivityMs: 1000, // not newer
    });
    expect(mergeVibeRunSnapshot(existing, incoming).status).toBe('completed');
  });
});

describe('evictStaleSessionDetail — characterization (boundary)', () => {
  it('恰好等于 MAX_SESSION_DETAIL → 不驱逐(返回同一引用)', () => {
    const runs = Array.from({ length: 8 }, (_, i) =>
      makeRun({
        id: `s${i}`,
        status: 'completed',
        detailState: { kind: 'ready' },
        lastActivityMs: 1000 + i,
      }),
    );
    expect(evictStaleSessionDetail(runs)).toBe(runs);
  });

  it('active(running)会话即使最老也不被驱逐', () => {
    const active = makeRun({
      id: 'active',
      status: 'running', // protected
      detailState: { kind: 'ready' },
      lastActivityMs: 1, // oldest
    });
    const inactive = Array.from({ length: 8 }, (_, i) =>
      makeRun({
        id: `c${i}`,
        status: 'completed',
        detailState: { kind: 'ready' },
        lastActivityMs: 1000 + i,
      }),
    );
    const out = evictStaleSessionDetail([active, ...inactive]);
    // active kept its detail; one inactive run got demoted instead.
    expect(out.find(r => r.id === 'active')?.detailState).toEqual({ kind: 'ready' });
    expect(out.some(r => r.id !== 'active' && r.detailState === undefined)).toBe(true);
  });
});

describe('mergeVibeRunSnapshot — empty 失效(#1:历史矛盾须重拉,非永久事实)', () => {
  const emptyRun = (over: Partial<VibeCodingRun> & { id: string }): VibeCodingRun =>
    makeRun({
      status: 'completed',
      detailState: { kind: 'empty' },
      transcript: [],
      transcriptCount: 0,
      lastActivityMs: 1000,
      ...over,
    });

  it('existing empty + 快照 transcriptCount>0(无 transcript)→ recoverable_empty(屏重拉)', () => {
    // 另一客户端产消息, 手机收到轻量快照(transcriptCount=5, 无 transcript)。
    // 旧的 empty 须失效, 否则 hasDetail=true 卡住"明明有历史却显空"。
    const existing = emptyRun({ id: 's' });
    const snapshot = makeRun({
      id: 's',
      status: 'completed',
      detailState: undefined, // 快照不带 detailState
      transcript: [],
      transcriptCount: 5,
      lastActivityMs: 2000,
    });
    const merged = mergeVibeRunSnapshot(existing, snapshot);
    expect(merged.detailState).toEqual({ kind: 'recoverable_empty' });
    expect(merged.transcriptCount).toBe(5);
  });

  it('existing empty + 快照 transcriptCount=0(无变化)→ 保持 empty', () => {
    const existing = emptyRun({ id: 's' });
    const snapshot = makeRun({
      id: 's',
      detailState: undefined,
      transcriptCount: 0,
      lastActivityMs: 2000,
    });
    expect(mergeVibeRunSnapshot(existing, snapshot).detailState).toEqual({ kind: 'empty' });
  });

  it('existing empty + 快照带新 transcript 内容 → ready(内容快照经映射带 detailState=ready)', () => {
    const existing = emptyRun({ id: 's' });
    const snapshot = makeRun({
      id: 's',
      // serverAiSessionToVibeRun 对带 transcript 的快照映射为 detailState=ready
      detailState: { kind: 'ready' },
      transcript: [
        { id: 'm1', role: 'user', content: 'new', timestamp: 't1' } as unknown as VibeCodingRun['transcript'][number],
      ],
      transcriptCount: 1,
      lastActivityMs: 2000,
    });
    const merged = mergeVibeRunSnapshot(existing, snapshot);
    expect(merged.detailState).toEqual({ kind: 'ready' });
  });
});

describe('mergeVibeRunSnapshot — snapshot 的 detailRefreshStatus 重 resolve detailState(#2:UI 只读 kind)', () => {
  // detailState 只在 fetch 时 resolve; snapshot 只更新 detailRefreshStatus。
  // 要让 UI 只读 detailState.kind, snapshot 带 detailRefreshStatus 时须重 resolve,
  // 否则 hook 读不到 snapshot 推来的 failed/offline(recoverable 自愈回归)。
  it('existing empty + snapshot detailRefreshStatus=failed → detailState=failed(重 resolve)', () => {
    const existing = makeRun({ id: 's', detailState: { kind: 'empty' }, transcript: [], transcriptCount: 0 });
    const snap = makeRun({ id: 's', detailState: undefined, detailRefreshStatus: 'failed', transcript: [], transcriptCount: 0, lastActivityMs: 2000 });
    expect(mergeVibeRunSnapshot(existing, snap).detailState).toEqual({ kind: 'failed' });
  });
  it('existing empty + snapshot detailRefreshStatus=skipped_offline → offline', () => {
    const existing = makeRun({ id: 's', detailState: { kind: 'empty' }, transcript: [] });
    const snap = makeRun({ id: 's', detailRefreshStatus: 'skipped_offline', transcript: [], lastActivityMs: 2000 });
    expect(mergeVibeRunSnapshot(existing, snap).detailState).toEqual({ kind: 'offline' });
  });
  it('existing ready(有内容) + snapshot detailRefreshStatus=failed → 保持 ready(内容权威,不被 status 翻)', () => {
    const existing = makeRun({
      id: 's', detailState: { kind: 'ready' },
      transcript: [{ id: 'm1', role: 'user', content: 'x', timestamp: 't' } as unknown as VibeCodingRun['transcript'][number]],
    });
    const snap = makeRun({ id: 's', detailRefreshStatus: 'failed', transcript: [], lastActivityMs: 2000 });
    expect(mergeVibeRunSnapshot(existing, snap).detailState).toEqual({ kind: 'ready' });
  });
  it('snapshot 不带 detailRefreshStatus(list 快照)→ 不重 resolve, 保持 existing detailState', () => {
    const existing = makeRun({ id: 's', detailState: { kind: 'empty' }, transcript: [], transcriptCount: 0 });
    const snap = makeRun({ id: 's', detailRefreshStatus: undefined, transcript: [], transcriptCount: 0, lastActivityMs: 2000 });
    expect(mergeVibeRunSnapshot(existing, snap).detailState).toEqual({ kind: 'empty' });
  });
});

describe('serverAiSessionToVibeRun — 最新提问跳过 CC meta 行', () => {
  const makeSnapshot = (transcript: unknown[]) =>
    ({
      session_id: 's1',
      kind: 'ai',
      user_id: 'u1',
      device_id: 'dev1',
      status: 'idle',
      mode: 'vibe',
      provider: 'claude',
      transcript,
    }) as unknown as PlatformAiSessionSnapshot;

  it('transcript 尾部是 skill 注入行 → lastUserMessage 回退到真实提问', () => {
    const run = serverAiSessionToVibeRun(
      makeSnapshot([
        { id: 'm1', role: 'user', content: '真实提问', timestamp: '2026-10-07T00:00:00Z' },
        { id: 'm2', role: 'assistant', content: '回答', timestamp: '2026-10-07T00:01:00Z' },
        {
          id: 'm3',
          role: 'user',
          content: 'Base directory for this skill: /x/skills/y\n\n正文',
          timestamp: '2026-10-07T00:02:00Z',
        },
      ]),
      [],
      [],
    );
    expect(run.lastUserMessage?.content).toBe('真实提问');
  });

  it('没有真实提问时 → lastUserMessage 为 undefined(不再让 skill 正文冒充)', () => {
    const run = serverAiSessionToVibeRun(
      makeSnapshot([
        { id: 'm1', role: 'user', content: '<local-command-stdout>Set effort level to max</local-command-stdout>', timestamp: '2026-10-07T00:00:00Z' },
      ]),
      [],
      [],
    );
    expect(run.lastUserMessage).toBeUndefined();
  });
});

describe('serverAiSessionToVibeRun — 活跃时间诚实化(2026-10-15 事故)', () => {
  // 事故链:wire 载荷缺/坏 last_active_at 时,旧代码 `Date.parse(...) ||
  // activityNowMs()` 凭空造"现在",再被 mergeVibeRunSnapshot 的 Math.max 棘轮
  // 钉死到进程退出 —— 死会话卡片顶着 "just now" 沉不下去。诚实化:解析不出
  // 就置 0(unknown 标签),由合并层保留存量,永不凭空造时。
  const baseSession = (over: Record<string, unknown>) =>
    ({ session_id: 'ai_test', status: 'idle', mode: 'vibe', ...over }) as never;

  it('maps a missing last_active_at to 0 instead of fabricating now()', () => {
    const run = serverAiSessionToVibeRun(baseSession({}), [], []);
    expect(run.lastActivityMs).toBe(0);
  });

  it('maps an unparseable last_active_at to 0', () => {
    const run = serverAiSessionToVibeRun(
      baseSession({ last_active_at: 'not-a-date' }),
      [],
      [],
    );
    expect(run.lastActivityMs).toBe(0);
  });

  it('parses an honest last_active_at through', () => {
    const run = serverAiSessionToVibeRun(
      baseSession({ last_active_at: '2026-08-05T02:55:11.234Z' }),
      [],
      [],
    );
    expect(run.lastActivityMs).toBe(Date.parse('2026-08-05T02:55:11.234Z'));
  });
});

describe('mergeVibeRunSnapshot — 双轨活跃时钟(服务端权威/本地乐观)', () => {
  // 旧实现 Math.max = 单向棘轮:任何一个本地造假值(或被事件处理器顶高的值)
  // 永久覆盖之后所有诚实快照。双轨:双方均非 live 时,携带诚实时间的 incoming
  // 直接覆盖(可下修);任一方 live 时保持 max(本地流式乐观不被旧快照拉回);
  // incoming 无诚实时间(0)时保留存量。
  const FABRICATED = Date.parse('2026-10-16T10:00:00.000Z');
  const HONEST = Date.parse('2026-10-15T05:15:34.000Z');

  it('non-live: honest incoming overrides a fabricated local value (ratchet removed)', () => {
    const existing = makeRun({
      id: 's1',
      status: 'idle',
      lastActivityMs: FABRICATED,
    });
    const incoming = makeRun({
      id: 's1',
      status: 'idle',
      lastActivityMs: HONEST,
    });
    expect(mergeVibeRunSnapshot(existing, incoming).lastActivityMs).toBe(HONEST);
  });

  it('live: newer local streaming time is preserved over an older server stamp', () => {
    const existing = makeRun({
      id: 's1',
      status: 'running',
      lastActivityMs: FABRICATED,
    });
    const incoming = makeRun({
      id: 's1',
      status: 'running',
      lastActivityMs: HONEST,
    });
    expect(mergeVibeRunSnapshot(existing, incoming).lastActivityMs).toBe(
      FABRICATED,
    );
  });

  it('incoming without honest activity keeps the existing value', () => {
    const existing = makeRun({
      id: 's1',
      status: 'idle',
      lastActivityMs: HONEST,
    });
    const incoming = makeRun({ id: 's1', status: 'idle', lastActivityMs: 0 });
    expect(mergeVibeRunSnapshot(existing, incoming).lastActivityMs).toBe(HONEST);
  });
});

describe('mergeVibeRunSnapshot — activityGuardMs 守卫基线(评审 P2)', () => {
  // 双轨允许展示值下修;守卫基线只增不减。多实例 Redis 镜像延迟下:
  // settle(T_SETTLE)→ 滞后快照(T_SETTLE-60s,合法但旧)下修展示值 →
  // 更迟到的 pre-settle running 事件(T_SETTLE-30s)不得借下修后的基线
  // 击穿 staleReactivation 让已结算会话闪回"进行中"。
  const T_SETTLE = Date.parse('2026-10-16T10:00:00.000Z');

  it('a late stale running snapshot cannot re-activate a settled session after a down-shift', () => {
    const settled = makeRun({
      id: 's1',
      status: 'idle',
      lastActivityMs: T_SETTLE,
    });
    const lagged = makeRun({
      id: 's1',
      status: 'idle',
      lastActivityMs: T_SETTLE - 60_000,
    });
    const afterDownShift = mergeVibeRunSnapshot(settled, lagged);
    expect(afterDownShift.lastActivityMs).toBe(T_SETTLE - 60_000);

    const lateRunning = makeRun({
      id: 's1',
      status: 'running',
      lastActivityMs: T_SETTLE - 30_000,
    });
    const guarded = mergeVibeRunSnapshot(afterDownShift, lateRunning);
    expect(guarded.status).toBe('idle');
    expect(guarded.activityGuardMs).toBe(T_SETTLE);
  });
});

describe('mergeVibeRunSnapshot structuredEvents 守卫(C0:状态类快照清空活动墙)', () => {
  const wall = (ids: string[]) =>
    ids.map(id => ({
      kind: 'command' as const,
      eventId: id,
      status: 'running' as const,
    })) as unknown as VibeCodingRun['structuredEvents'];

  it('incoming 不带 structured_events(映射为 [])时保留存量活动墙 —— 列表/全局快照/重命名/打断响应路径', () => {
    const existing = makeRun({
      id: 's1',
      structuredEvents: wall(['e1', 'e2']),
    });
    const incoming = makeRun({
      id: 's1',
      structuredEvents: [],
    });
    const merged = mergeVibeRunSnapshot(existing, incoming);
    expect(merged.structuredEvents.map(e => e.eventId)).toEqual(['e1', 'e2']);
  });

  it('incoming 带事件(detail GET / agent-detail WS 发布)时并集合并,冲突以快照为准', () => {
    const existing = makeRun({
      id: 's1',
      structuredEvents: [
        { kind: 'command', eventId: 'e1', status: 'running', command: 'local' },
        { kind: 'thinking', eventId: 'e2', active: false, chars: 3 },
      ] as unknown as VibeCodingRun['structuredEvents'],
    });
    const incoming = makeRun({
      id: 's1',
      structuredEvents: [
        { kind: 'command', eventId: 'e1', status: 'completed', exitCode: 0 },
        { kind: 'usage', eventId: 'e3', inputTokens: 5 },
      ] as unknown as VibeCodingRun['structuredEvents'],
    });
    const merged = mergeVibeRunSnapshot(existing, incoming);
    const ids = merged.structuredEvents.map(e => e.eventId).sort();
    expect(ids).toEqual(['e1', 'e2', 'e3']);
    const e1 = merged.structuredEvents.find(e => e.eventId === 'e1');
    if (!e1 || e1.kind !== 'command') throw new Error('expected command');
    expect(e1.status).toBe('completed');
  });

  it('首次合并(existing === undefined)原样返回 incoming,不受守卫影响', () => {
    const incoming = makeRun({
      id: 's1',
      structuredEvents: wall(['e9']),
    });
    expect(mergeVibeRunSnapshot(undefined, incoming)).toBe(incoming);
  });
});

describe('serverAiSessionToVibeRun detailRefreshStatus 映射(C4:粘性诊断不冒充本次结果)', () => {
  const makeSnapshot = (over: Record<string, unknown>) =>
    ({
      kind: 'ai',
      user_id: 'u1',
      device_id: 'd1',
      status: 'running',
      mode: 'chat',
      session_id: 's1',
      created_at: '2026-01-01T00:00:00Z',
      last_active_at: '2026-01-01T00:00:00Z',
      ...over,
    }) as unknown as Parameters<typeof serverAiSessionToVibeRun>[0];

  it('列表/WS 快照只带粘性 last_detail_fetch_status 时映射为 undefined(不触发 re-resolve)', () => {
    const run = serverAiSessionToVibeRun(
      makeSnapshot({ last_detail_fetch_status: 'failed' }),
      [],
      [],
    );
    expect(run.detailRefreshStatus).toBeUndefined();
  });

  it('detail GET 响应带 detail_refresh 时照常映射(本次抓取结果)', () => {
    const run = serverAiSessionToVibeRun(
      makeSnapshot({
        detail_refresh: { status: 'skipped_offline' },
        last_detail_fetch_status: 'failed',
      }),
      [],
      [],
    );
    expect(run.detailRefreshStatus).toBe('skipped_offline');
  });

  it('粘性失败不再经 mergeVibeRunSnapshot 的 re-resolve 把 detailState 污染成 failed', () => {
    // 本地空会话(从未加载)收到一次带 last_detail_fetch_status='failed' 的
    // 列表快照:修复前映射进 detailRefreshStatus → re-resolve →
    // detailState='failed' → 挂载首载被 isDetailFetchUnavailable 短路。
    const existing = makeRun({ id: 's1', transcript: [] });
    const incoming = serverAiSessionToVibeRun(
      makeSnapshot({ last_detail_fetch_status: 'failed' }),
      [],
      [],
    );
    const merged = mergeVibeRunSnapshot(existing, incoming);
    expect(merged.detailState).toBeUndefined();
  });
});
