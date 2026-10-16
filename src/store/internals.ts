import type {
  AgentCommandScope,
  AgentEvent,
  AgentTranscriptPage,
  Device,
  GoalSummary,
  PreviewLink,
  Project,
  StructuredActivityEvent,
  VibeCodingRun,
  VibeStatus,
} from '../data/platformModels';
import { envelopeToActivity } from '../data/platformModels';
import i18n from '../i18n';
import { normalizeProvider, providerLabel } from '../utils/modelIntensity';
import { sameRemotePath } from '../utils/remotePath';
import { normalizeFileStatus } from '../utils/fileStatus';
import { isClaudeCodeMetaUserContent } from '../utils/agentTranscript';
import { countServerConfirmedMessages } from '../utils/sessionCatchUp';
import { decodeTerminalData } from '../utils/terminalOutput';
import {
  platformTransport,
  type PlatformAiSessionSnapshot,
  type PlatformApprovalSnapshot,
  type PlatformDeviceSnapshot,
  type PlatformNotificationSnapshot,
  type PlatformPreviewSnapshot,
  type PlatformProjectFileContentSnapshot,
  type PlatformProjectFileListSnapshot,
  type PlatformProjectSnapshot,
  type PlatformRealtimeEventSnapshot,
  type PlatformTerminalSessionSnapshot,
} from '../services/platformTransport';
import { clearPendingTerminalOutput } from '../services/terminalOutputRegistry';
import { serverAiMessageToAgent } from '../api/sessions';
import type { ServerAiTranscriptPage } from '../api/sessions';
import {
  isAuthoritativeDetail,
  mergeDetailState,
  invalidateStaleEmptyDetail,
  resolveDetailState,
} from './sessionDetail';
import type {
  ApprovalKind,
  ApprovalRequest,
  ProjectFileEntry,
  ProjectScanResult,
  PushNotificationItem,
  TerminalCommandHistoryItem,
  TerminalLine,
  TerminalLineKind,
  TerminalSession,
  TerminalSessionStatus,
  UnifiedEvent,
  UnifiedEventStatus,
  UnifiedEventType,
} from './types';
import { mergeCommandHistory } from './slices/terminalSlice';

// --- Helpers ---

export const nowTime = () =>
  new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

// Monotonic clock for activity recency. `Date.now()` is fine here — this runs in
// the React Native app, not the deterministic workflow sandbox.
export const activityNowMs = () => Date.now();

/**
 * 严格解析 wire 活跃时间:解析不出(缺失/空/坏值)返回 0,由调用方保留存量。
 * 2026-10-15 事故:旧代码 `Date.parse(...) || activityNowMs()` 在载荷缺
 * last_active_at 时凭空造"现在",再被合并棘轮钉死 —— 死会话卡片顶着
 * "just now" 沉不下去。宁可不更新,不可凭空造时。
 */
export const parseActivityMs = (value: string | undefined | null): number => {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
};

/**
 * 服务端事件钟:realtime broker 给每个 WS 事件信封盖 created_at(见服务端
 * realtime-broker),事件解析层把它原样放进 `raw`。远端事件驱动的时间戳一律
 * 消费它,而不是本地 Date.now() —— "收到事件"不等于"会话此刻活跃",事件
 * 迟到/重放时本地钟会把死会话顶成 just now(2026-10-15 事故同族)。
 * 解析失败返回 undefined,调用方维持原值。
 */
export const wireEventMs = (raw: unknown): number | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = (raw as Record<string, unknown>).created_at;
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
};

// Render a stable, human-friendly label for a session's last-activity timestamp.
// Used for the `updatedAt` display string; sorting uses `lastActivityMs` instead.
export const formatActivityLabel = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return i18n.t('common:time.unknown');
  const diffSec = Math.max(0, (Date.now() - ms) / 1000);
  if (diffSec < 45) return i18n.t('common:time.justNow');
  if (diffSec < 90) return i18n.t('common:time.minutesAgo', { count: 1 });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return i18n.t('common:time.minutesAgo', { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return i18n.t('common:time.hoursAgo', { count: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return i18n.t('common:time.daysAgo', { count: diffDay });
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
};

export const shortTime = () =>
  new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

export const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// --- Bounded-memory guards (continuous-operation safety) ---
// The store is the single resident copy of realtime data. Long-running
// sessions/terminals stream unbounded output (a `tail -f` or a multi-hour AI
// run can produce hundreds of thousands of lines/messages) and would otherwise
// grow the JS heap until the app janks or OOMs. These caps keep the resident
// working set bounded; older data still lives on the server and is reloaded on
// demand (loadAgentSessionDetail / loadEarlierAiMessages). tail() keeps the
// NEWEST entries (ring-buffer semantics) since that's what the UI shows.
export const MAX_TERMINAL_LINES = 2000; // per terminal session, ring buffer
// Per-terminal scrollback replay budget (bytes of UTF-8 across all buffered
// `terminal.replay` chunks). Independent of session.lines: replay chunks are
// raw terminal bytes destined for the xterm emulator, which must not pass
// through the lossy (fragmented + ANSI-stripped) lines path.
export const MAX_REPLAY_CHUNKS_BYTES = 512 * 1024;
export const MAX_RUN_EVENTS = 200; // per AI session lifecycle events
export const MAX_SESSION_DETAIL = 8; // LRU: full transcripts held for at most this many sessions
export const MAX_VIBE_RUNS = 50; // Maximum number of AI sessions kept in memory
export const MAX_TRANSCRIPT_LENGTH = 500; // Maximum messages per session transcript (hot window)
// 已加载历史(用户主动「加载更早」翻进来的头部)的硬上限。水位地板生效期间
// tail-500 停止裁剪,窗口靠这个上限兜底;触顶按真值截断并同步窗口元数据。
export const MAX_LOADED_TRANSCRIPT_LENGTH = 2000;
export const MAX_EVENTS = 120; // Global event log limit
export const MAX_NOTIFICATIONS = 120; // Notification list limit
export const MAX_APPROVALS = 50; // Pending/resolved approvals limit
// --- Bounded memory for AI session structured activity (see bounded-memory spec) ---
export const STRUCTURED_EVENTS_CAP = 200; // per session: keep newest N structured activity events
export const EVENT_DETAIL_CACHE_MAX = 30; // per session: keep newest N fetched heavy details (FIFO)
export const IDLE_DEMOTE_MS = 30 * 60 * 1000; // inactive viewed sessions demote only after a quiet window
export const IDLE_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // coarse fallback sweeper cadence
export const tail = <T>(list: T[], limit: number): T[] =>
  list.length <= limit ? list : list.slice(list.length - limit);

// FIFO-cap a session's eventDetailCache by insertion order (oldest key dropped).
// Object key order is insertion order in JS, so slice the keys array. Details
// are heavy (output/diff/thinking text up to 32KB), so this bounds resident RAM.
export function capEventDetailCache(
  cache: Record<string, { text?: string; truncated?: boolean }>,
  limit = EVENT_DETAIL_CACHE_MAX,
): Record<string, { text?: string; truncated?: boolean }> {
  const keys = Object.keys(cache);
  if (keys.length <= limit) return cache;
  const keep = keys.slice(keys.length - limit); // newest N
  const next: Record<string, { text?: string; truncated?: boolean }> = {};
  for (const k of keep) next[k] = cache[k];
  return next;
}

// Sessions whose transcript must stay resident — evicting a live one would
// drop the buffer the streaming reducer appends to.
export const ACTIVE_RUN_STATUS = new Set<VibeStatus>([
  'running',
  'waiting_user',
  'waiting_approval',
  'testing',
  'preview_ready',
  'paused',
]);

/**
 * Bound resident transcript memory. At most MAX_SESSION_DETAIL sessions keep
 * their full transcript/events loaded; the oldest inactive detailed sessions
 * have their transcript/events cleared (metadata + lastMessage retained for the
 * list). Re-opening an evicted session calls loadAgentSessionDetail again.
 * Active (streaming/resumable) sessions are never evicted.
 */
export function evictStaleSessionDetail(
  runs: VibeCodingRun[],
): VibeCodingRun[] {
  const detailed = runs.filter(run => isAuthoritativeDetail(run.detailState));
  if (detailed.length <= MAX_SESSION_DETAIL) return runs;
  const overflow = detailed.length - MAX_SESSION_DETAIL;
  const toEvict = new Set(
    detailed
      .filter(run => !ACTIVE_RUN_STATUS.has(run.status))
      .sort(
        (a, b) =>
          (a.lastViewedAt ?? a.lastActivityMs ?? 0) -
          (b.lastViewedAt ?? b.lastActivityMs ?? 0),
      )
      .slice(0, overflow)
      .map(run => run.id),
  );
  if (!toEvict.size) return runs;
  return runs.map(run =>
    toEvict.has(run.id) ? demoteRunDetail(run) : run,
  );
}

/**
 * Drop a session's resident detail to bound memory: clear transcript, lifecycle
 * events, structured activity events, and the on-demand detail cache, and mark
 * it as not-detail-loaded so re-opening re-fetches. Metadata (id, title,
 * status, lastActivityMs, lastMessage) is retained so the session list still
 * renders. Shared by count-based eviction (evictStaleSessionDetail) and
 * time-based idle demotion (demoteIdleSessions).
 */
export function demoteRunDetail(run: VibeCodingRun): VibeCodingRun {
  return {
    ...run,
    transcript: [],
    events: [],
    structuredEvents: [],
    eventDetailCache: undefined,
    detailState: undefined,
  };
}

/**
 * Demote sessions the user is no longer paying attention to. A run is demoted
 * when ALL of: not currently viewed (currentlyViewedSessionId), not active
 * (streaming/resumable — keep the streaming buffer), has been viewed before
 * (lastViewedAt set), and not viewed within IDLE_DEMOTE_MS. Never-viewed
 * sessions are left alone (they only hold a light snapshot; the hard-floor
 * caps bound any live-accumulated activity). `now` is injected for testability.
 */
export function demoteIdleSessions(
  runs: VibeCodingRun[],
  now: number,
  currentlyViewedSessionId?: string,
): VibeCodingRun[] {
  let changed = false;
  const next = runs.map(run => {
    if (run.id === currentlyViewedSessionId) return run;
    if (ACTIVE_RUN_STATUS.has(run.status)) return run;
    if (run.lastViewedAt == null) return run;
    if (now - run.lastViewedAt <= IDLE_DEMOTE_MS) return run;
    changed = true;
    return demoteRunDetail(run);
  });
  return changed ? next : runs;
}

/**
 * Bound the total number of AI sessions in memory. When the list exceeds
 * MAX_VIBE_RUNS, the oldest inactive sessions are dropped entirely (they can
 * be re-fetched from the server if the user navigates back). Active sessions
 * are always retained.
 */
export function evictOverflowVibeRuns(runs: VibeCodingRun[]): VibeCodingRun[] {
  if (runs.length <= MAX_VIBE_RUNS) return runs;
  // Separate active (must keep) from inactive (can evict)
  const active = runs.filter(run => ACTIVE_RUN_STATUS.has(run.status));
  const inactive = runs.filter(run => !ACTIVE_RUN_STATUS.has(run.status));
  // Sort inactive by lastActivityMs descending, keep most recent
  const keptInactive = inactive
    .sort((a, b) => (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0))
    .slice(0, MAX_VIBE_RUNS - active.length);
  // Re-merge preserving original order hint (active first for relevance)
  const kept = new Set([...active, ...keptInactive].map(r => r.id));
  return runs.filter(r => kept.has(r.id));
}

/**
 * Bound a single session's transcript length. When it exceeds
 * MAX_TRANSCRIPT_LENGTH, the oldest messages are dropped (the server still
 * holds the full history and loadEarlierAiMessages can fetch them).
 */
export function trimTranscript(transcript: VibeCodingRun['transcript']): VibeCodingRun['transcript'] {
  return tail(transcript, MAX_TRANSCRIPT_LENGTH);
}

/**
 * 本地窗口是否还有更早历史可加载(「加载更早」的闸门真值)。
 *
 * 真值来源是服务端 total_count 与本地窗口长度的差,而不是服务端下发的
 * has_more:
 * - catch-up 走 after 模式,它的 has_more 语义是"更新方向还有更多"(与
 *   before 相反),混用会把能翻页的会话误判为到头;
 * - trim 之后本地窗口变短,而服务端热窗快照的 has_more 描述的是服务端自己的
 *   窗口——审计问题6的复现场景(hasMore=false + catch-up 大量新增 + trim)
 *   就是因为只看 has_more 才把仍可翻页的会话永久判死。
 * total 未知(老快照/纯本地)时才退回 hasMore,页都不存在时保守返回 false
 * (与旧行为等价:没有游标也没有理由认为有更早历史)。
 */
export function hasEarlierForRun(run: {
  transcript: VibeCodingRun['transcript'];
  transcriptPage?: AgentTranscriptPage;
  transcriptCount?: number;
}): boolean {
  // total 数的是服务端确认过的消息;本地未确认的乐观气泡(pending/failed)不
  // 在其中,参与比较会让 hasEarlier 在流式期间闪断。口径单一来源:
  // countServerConfirmedMessages(与 transcriptCount 写入同口径)。
  const confirmedLocal = countServerConfirmedMessages(run.transcript);
  const totals = [
    run.transcriptPage?.totalCount,
    typeof run.transcriptCount === 'number' && run.transcriptCount > 0
      ? run.transcriptCount
      : undefined,
  ].filter((value): value is number => typeof value === 'number');
  if (totals.length) {
    return Math.max(...totals) > confirmedLocal;
  }
  return run.transcriptPage ? run.transcriptPage.hasMore !== false : false;
}

/**
 * 统一的 transcript 裁剪收口:tail-500 语义不变,但用户通过「加载更早」拉进
 * 来的已加载历史(oldestLoadedId 标记的窗口头部)受水位地板保护——否则活跃
 * 会话的排水提交每 2 页 trim 一次,刚翻到的头部历史下一轮就被裁掉,分页成
 * 跑步机(每加载 40 条同时被裁 40 条,永远回不到 index 0)。
 *
 * 地板生效期间窗口可以超过 500,由 MAX_LOADED_TRANSCRIPT_LENGTH 兜底;触顶
 * 时按真值截断(最老的已加载页开始让位,窗口元数据同步重算,用户仍能继续
 * 向前翻,只是不再净前进——这是有界内存与可达性的换手点)。
 *
 * 返回的 pageDelta 非空表示头部被裁(或首次盖戳),调用方必须把它原子合并进
 * 同一个 set 里(窗口事实与 transcript 永远同帧更新)。
 */
export function trimTranscriptWithWindow(
  transcript: VibeCodingRun['transcript'],
  page: AgentTranscriptPage | undefined,
): {
  transcript: VibeCodingRun['transcript'];
  pageDelta?: Pick<AgentTranscriptPage, 'oldestLoadedId' | 'oldestLoadedTimestamp'>;
} {
  if (transcript.length <= MAX_TRANSCRIPT_LENGTH) {
    return { transcript };
  }
  // 地板保护只在"用户确实加载过更早历史、且它仍是窗口头部"时生效。
  const floorActive =
    !!page?.oldestLoadedId && transcript[0]?.id === page.oldestLoadedId;
  if (!floorActive) {
    const trimmed = tail(transcript, MAX_TRANSCRIPT_LENGTH);
    if (trimmed === transcript) return { transcript };
    return {
      transcript: trimmed,
      // 只有地板身份本已存在(但已不是窗口头部——被其它路径裁掉/水合错位)才
      // 刷新盖戳。绝不能凭空盖戳:纯热窗会话一旦被盖戳,下一次 trim 就会误判
      // "有地板"而停摆,500 上限形同虚设。地板身份只由「加载更早」建立。
      pageDelta: page?.oldestLoadedId
        ? {
            oldestLoadedId: trimmed[0]?.id,
            oldestLoadedTimestamp: trimmed[0]?.timestamp,
          }
        : undefined,
    };
  }
  if (transcript.length <= MAX_LOADED_TRANSCRIPT_LENGTH) {
    return { transcript };
  }
  const trimmed = tail(transcript, MAX_LOADED_TRANSCRIPT_LENGTH);
  return {
    transcript: trimmed,
    pageDelta: {
      oldestLoadedId: trimmed[0]?.id,
      oldestLoadedTimestamp: trimmed[0]?.timestamp,
    },
  };
}

/**
 * 服务端下发的 transcript_page 的位置感知合并(mergeVibeRunSnapshot 的
 * `incoming ?? existing` 整体覆写是审计问题6自愈路径上的反噬:WS 快照会把
 * 客户端已翻历史的游标整体顶回服务端热窗起点,下一次「加载更早」就重翻已
 * 加载区域)。
 *
 * 规则:服务端页的 before 游标目标若落在本地窗口 index>0 处,说明本地已经
 * 加载了比它更早的历史——这页比本地浅,拒绝,保留本地;其余(目标不在本地
 * 窗口里/正是本地头部/本地没有页)收下服务端(它更新鲜)。oldestLoadedId
 * 是本地事实,无论谁赢都保留;服务端页收下时以服务端字段为准、本地窗口
 * 事实回填。
 */
export function acceptServerTranscriptPage(
  existing: AgentTranscriptPage | undefined,
  incoming: AgentTranscriptPage | undefined,
  localTranscript: VibeCodingRun['transcript'],
): AgentTranscriptPage | undefined {
  if (!incoming) return existing;
  if (!existing) return { ...incoming };
  const incomingAnchorId =
    incoming.nextBeforeMessageId ?? decodeCursorId(incoming.nextBeforeCursor);
  if (incomingAnchorId) {
    const anchorIndex = localTranscript.findIndex(
      message => message.id === incomingAnchorId,
    );
    // index 0 = 恰是本地头部(等价边界);>0 = 本地已越过它(服务端页过浅)。
    if (anchorIndex > 0) return existing;
  }
  // 只透传本地已有地板,绝不凭空盖戳:oldestLoadedId 的唯一建立者是
  // 「加载更早」;服务端快照若给纯热窗会话盖戳,水位地板会被误钉,
  // tail-500 停摆到 2000 硬上限才一次性截断。
  return {
    ...incoming,
    oldestLoadedId: existing.oldestLoadedId,
    oldestLoadedTimestamp: existing.oldestLoadedTimestamp,
  };
}

/**
 * snake_case wire 页元数据 → camelCase 本地页模型(唯一映射,服务端快照与
 * useSessionCatchUp 触发1 自愈共用)。
 */
export function serverTranscriptPageToAgent(
  page: ServerAiTranscriptPage,
): AgentTranscriptPage {
  return {
    limit: page.limit,
    count: page.count,
    totalCount: page.total_count,
    hasMore: page.has_more,
    nextBeforeCursor: page.next_before_cursor,
    nextBeforeMessageId: page.next_before_message_id,
    anchorFound: page.anchor_found,
    cacheStatus: page.cache_status,
    fetchedAt: page.fetched_at,
  };
}

/**
 * 从 base64url(JSON({id, ...})) 游标里取 id(只用于位置比较,失败返回
 * undefined)。与服务端 decodeAiMessageCursor 同构,但这里不校验业务语义。
 */
function decodeCursorId(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    const normalized = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const parsed = JSON.parse(globalThis.atob(padded)) as { id?: unknown };
    return typeof parsed.id === 'string' && parsed.id.trim()
      ? parsed.id
      : undefined;
  } catch {
    return undefined;
  }
}

export function mergeEarlierAgentMessages(
  existing: VibeCodingRun['transcript'],
  earlier: VibeCodingRun['transcript'],
): VibeCodingRun['transcript'] {
  if (!earlier.length) return existing;
  const byId = new Map<string, VibeCodingRun['transcript'][number]>();
  // 值语义与旧的 [...earlier, ...existing] 顺序 fold({ ...acc, ...message })
  // 逐值一致(首现定位、后者字段覆盖),但值未变化的消息保留原引用:
  // agentTranscript 的 markdown 解析缓存(segmentCache WeakMap)按消息对象
  // 引用命中,加载更早一页若把整个已加载历史重建对象,缓存会全量 miss,
  // 每翻一页都在 JS 线程同步重解析全部历史(浏览历史卡顿的直接根因)。
  const put = (incoming: VibeCodingRun['transcript'][number]) => {
    const current = byId.get(incoming.id);
    if (!current) {
      byId.set(incoming.id, incoming);
      return;
    }
    // 目标值 = { ...current, ...incoming }。incoming 对 current 的每个键都
    // 给出相同值时,展开结果逐值等于 incoming,直接复用 incoming 引用。
    let identical = true;
    for (const key in current) {
      if (
        (incoming as unknown as Record<string, unknown>)[key] !==
        (current as unknown as Record<string, unknown>)[key]
      ) {
        identical = false;
        break;
      }
    }
    byId.set(incoming.id, identical ? incoming : { ...current, ...incoming });
  };
  for (const message of earlier) put(message);
  for (const message of existing) put(message);
  const merged = Array.from(byId.values());
  const allHaveIndex = merged.every(message => typeof message.index === 'number');
  if (allHaveIndex) {
    return merged.sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  }
  return merged;
}

export const line = (
  kind: TerminalLineKind,
  content: string,
): TerminalLine => ({
  id: createId('line'),
  kind,
  content,
  timestamp: nowTime(),
});

export const event = (
  type: UnifiedEventType,
  title: string,
  detail: string,
  status: UnifiedEventStatus,
  meta: Partial<UnifiedEvent> = {},
): UnifiedEvent => ({
  id: createId('evt'),
  type,
  title,
  detail,
  status,
  timestamp: nowTime(),
  ...meta,
});

// --- Server → Client adapters ---

export function platformDeviceToClient(sd: PlatformDeviceSnapshot): Device {
  return {
    id: sd.deviceId,
    name: sd.name,
    status:
      sd.status === 'online'
        ? 'online'
        : sd.status === 'offline'
        ? 'offline'
        : 'offline',
    location: sd.location ?? 'Remote device',
    os: sd.platform,
    host: sd.host ?? sd.uniqueCode ?? sd.deviceId,
    cpuLoad: sd.cpuLoad != null ? Math.round(sd.cpuLoad) : 0,
    memLoad: sd.memLoad != null ? Math.round(sd.memLoad) : 0,
    battery: sd.battery,
    authorizedDirectories: sd.authorizedDirectories,
    activePorts: sd.activePorts,
    projectIds: sd.projectIds,
    activeSessionIds: [],
    lastSeen: sd.lastSeenAt ?? 'unknown',
    uniqueCode: sd.uniqueCode,
    agentVersion: sd.agentVersion,
    remoteTerminalEnabled: sd.remoteTerminalEnabled,
    aiControlEnabled: sd.aiControlEnabled,
    capabilities: sd.capabilities,
    tunnelAvailable: sd.tunnelAvailable,
    tools: sd.tools.map(tool => ({
      id: tool.id,
      name: tool.name,
      command: tool.command,
      path: tool.path,
      available: tool.available,
      description: tool.description,
      version: tool.version,
      efforts: tool.efforts,
      commands: tool.commands?.map(cmd => ({
        name: cmd.name,
        description: cmd.description,
        argHint: cmd.argHint,
        scope: (cmd.scope as AgentCommandScope | undefined) ?? undefined,
        kind: cmd.kind,
        origin: cmd.origin,
        source: cmd.source,
        userInvocable: cmd.userInvocable,
        modelInvocable: cmd.modelInvocable,
        remote: cmd.remote,
      })),
    })),
    history: sd.history.map(entry => ({
      tool: entry.tool,
      path: entry.path,
      exists: entry.exists,
      file_count: entry.file_count,
      total_size: entry.total_size,
      updated_at: entry.updated_at,
    })),
    createdAt: sd.createdAt,
  };
}

export function serverProjectToClient(sp: PlatformProjectSnapshot): Project {
  return {
    id: sp.project_id || sp.id,
    name: sp.name,
    status:
      sp.status === 'error'
        ? 'error'
        : sp.status === 'fresh'
        ? 'active'
        : sp.status,
    branch: sp.branch ?? 'main',
    lastDeploy: sp.last_active_at ?? sp.updated_at,
    language: sp.language ?? 'Unknown',
    description: sp.description ?? '',
    path: sp.path ?? '',
    deviceId: sp.device_id,
    packageManager: sp.package_manager,
    isGitRepo: sp.is_git_repo,
    fileCount: sp.file_count,
    gitChangedCount: sp.git_changed_count,
    detectedPorts: sp.detected_ports ?? [],
    sourceTools: sp.source_tools ?? [],
    availableCommands: sp.available_commands ?? [],
    // Project-scoped approval policy (Phase B): mirror the server's scheme.
    approvalScheme: sp.approval_policy?.scheme ?? 'balanced',
    claudeSkillTrusted: sp.claude_skill_trusted === true,
    modelConfig: sp.model_config,
    provider: sp.provider ?? undefined,
    model: sp.model ?? undefined,
    effort: sp.effort ?? undefined,
  };
}

/**
 * Map a client Project into the ProjectScanResult shape used by the scan UI.
 * Discovered projects are stored server-side as Project records (the scan
 * endpoint registers them and the server emits `projects.updated`), so the
 * "Discovered Projects" list is derived from the projects collection.
 */
const PROJECT_STATUS_TO_SCAN: Record<Project['status'], ProjectScanResult['status']> = {
  active: 'active',
  idle: 'stale',
  error: 'warning',
};

export function projectToScanResult(project: Project): ProjectScanResult {
  return {
    id: project.id,
    deviceId: project.deviceId ?? '',
    projectId: project.id,
    name: project.name,
    path: project.path,
    isGitRepo: project.isGitRepo ?? false,
    branch: project.branch ?? 'main',
    language: project.language,
    packageManager:
      (project.packageManager as ProjectScanResult['packageManager']) ?? 'none',
    packageName: project.name,
    detectedPorts: project.detectedPorts ?? [],
    lastActiveAt: project.lastDeploy ?? '',
    status: PROJECT_STATUS_TO_SCAN[project.status] ?? 'stale',
  };
}

export function aiSessionModelLabel(session: PlatformAiSessionSnapshot) {
  const provider = normalizeProvider(session.provider, session.tool);
  if (provider === 'codex') return session.model ?? 'GPT-5 Codex';
  if (provider) return session.model ?? providerLabel(provider);
  return session.model ?? session.mode;
}

// The most recent user-role message in a transcript (newest-first scan), or
// `fallback` when the transcript holds no user message. Backs the session
// card's "最新提问" preview — the latest thing the user asked. CC 注入行
// （skill 全文 / 命令回显 / 系统提醒）不是用户的提问，跳过不冒充。
const lastUserMessageOf = (
  messages: ReadonlyArray<VibeCodingRun['lastMessage']> | undefined,
  fallback: VibeCodingRun['lastMessage'] | undefined,
): VibeCodingRun['lastMessage'] | undefined => {
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === 'user' && !isClaudeCodeMetaUserContent(m.content ?? '')) {
        return m;
      }
    }
  }
  return fallback;
};

export function serverAiSessionToVibeRun(
  session: PlatformAiSessionSnapshot,
  _devices: Device[],
  projects: Project[],
): VibeCodingRun {
  const project =
    projects.find(
      p =>
        sameRemotePath(p.path, session.project_path) &&
        p.deviceId === session.device_id,
    ) ??
    projects.find(p => sameRemotePath(p.path, session.project_path)) ??
    projects.find(p => p.id === session.project_path);
  const model = aiSessionModelLabel(session);
  const transcript = (session.transcript ?? []).map(serverAiMessageToAgent);
  const events = dedupeAgentEvents(
    (session.events ?? []).map(e => ({
      id: e.id,
      type: e.type as AgentEvent['type'],
      title: e.title,
      detail: e.detail,
      status: e.status as AgentEvent['status'],
      timestamp: e.timestamp,
    })),
  );
  const lastMessage = session.last_message
    ? {
        id: session.last_message.id,
        role: session.last_message.role,
        mode: session.last_message.mode as
          | 'voice'
          | 'text'
          | 'action'
          | undefined,
        content: session.last_message.content,
        timestamp: session.last_message.timestamp,
      }
    : transcript[transcript.length - 1];
  // Latest user-role message for the card menu's "最新提问" preview. Prefer a
  // real user turn from the transcript; fall back to last_message when it is
  // itself a user message (the common list-snapshot case, which omits the
  // transcript). The UI further falls back to `objective` when this is unset.
  // 兜底同样要过 CC meta 过滤——list 快照里 last_message 可能正是注入行。
  const lastUserMessage = lastUserMessageOf(
    transcript,
    lastMessage &&
      lastMessage.role === 'user' &&
      !isClaudeCodeMetaUserContent(lastMessage.content ?? '')
      ? lastMessage
      : undefined,
  );
  const goalSummary: GoalSummary | undefined = session.goal_summary
    ? {
        goalId: session.goal_summary.goal_id,
        objective: session.goal_summary.objective,
        state: session.goal_summary.state,
        stateVersion: session.goal_summary.state_version,
        completedTasks: session.goal_summary.completed_tasks,
        totalTasks: session.goal_summary.total_tasks,
        currentTask: session.goal_summary.current_task,
        currentRunHealth: session.goal_summary.current_run_health,
        attention: session.goal_summary.attention,
        primaryActionKind: session.goal_summary.primary_action_kind,
        primaryActionLabel: session.goal_summary.primary_action_label,
        provider: session.goal_summary.provider,
        model: session.goal_summary.model,
        effort: session.goal_summary.effort,
        driver: session.goal_summary.driver,
        workspaceRelation: session.goal_summary.workspace_relation,
        updatedAt: session.goal_summary.updated_at,
        tasks: session.goal_summary.tasks?.map(task => ({
          id: task.id,
          title: task.title,
          status: task.status,
          isCurrent: task.is_current,
        })),
        checks: session.goal_summary.checks?.map(check => ({
          id: check.id,
          title: check.title,
          status: check.status,
          detail: check.detail,
        })),
      }
    : undefined;

  return {
    id: session.session_id,
    title:
      session.title ??
      session.objective?.slice(0, 44) ??
      `AI ${session.mode} session`,
    deviceId: session.device_id,
    projectId: project?.id ?? '',
    directory: session.project_path ?? '',
    status: mapSessionStatus(session.status),
    purpose: session.purpose,
    goalSummary,
    phase: session.phase,
    activeRunId: session.active_run_id,
    latestRunId: session.latest_run_id,
    runState: session.run_state,
    runStateVersion: session.run_state_version,
    objective: session.objective ?? '',
    model,
    effort: session.effort || undefined,
    modelConfigVersion: session.model_config_version ?? 1,
    activeExecutionProfile: session.active_execution_profile
      ? {
          version: session.active_execution_profile.version,
          provider: session.active_execution_profile.provider,
          model: session.active_execution_profile.model,
          effort: session.active_execution_profile.effort,
          capturedAt: session.active_execution_profile.captured_at,
        }
      : undefined,
    provider: normalizeProvider(session.provider, session.tool),
    effectiveModelConfig: session.effective_model_config ?? undefined,
    risk: session.risk ?? 'medium',
    currentStep: session.current_step ?? '',
    // Branch is repository metadata. Never synthesize one from a conversation
    // id: `agent/ai_*` looks like a real Git branch and was the visible symptom
    // of the duplicate-session bug.
    branch: session.branch ?? project?.branch ?? '',
    // 活跃时间诚实化(2026-10-15 事故):解析不出就置 0(formatActivityLabel
    // 渲染 unknown),由 mergeVibeRunSnapshot 保留存量——绝不凭空造 now()。
    lastActivityMs: parseActivityMs(session.last_active_at),
    updatedAt: formatActivityLabel(parseActivityMs(session.last_active_at)),
    transcriptCount: session.transcript_count ?? transcript.length,
    transcriptPage: session.transcript_page
      ? serverTranscriptPageToAgent(session.transcript_page)
      : undefined,
    eventCount: session.event_count ?? events.length,
    filesTouchedCount: session.files_touched_count,
    gitChangedCount: session.git_changed_count,
    retryActive: session.retry_active ?? false,
    retryAttempt: session.retry_attempt,
    retryMax: session.retry_max,
    retryErrorStatus: session.retry_error_status,
    retryErrorType: session.retry_error_type,
    lastErrorStatus: session.last_error_status,
    lastErrorType: session.last_error_type,
    lastRetryAttempt: session.last_retry_attempt,
    lastRetryMax: session.last_retry_max,
    lastMessage,
    lastUserMessage,
    sourceSessionId: session.source_session_id || undefined,
    // 会话发起来源: wire origin 优先; 老 server 不发时按 ai_import_ 前缀兜底
    // (与 server 侧 publicAiSession 的兜底同源), 保证模型上该字段总被打满。
    origin:
      session.origin ??
      (session.session_id.startsWith('ai_import_') ? 'tui' : 'phone'),
    // Mark detail-resolved only when there is actual content. An empty array is
    // truthy in JS, so the old `session.transcript || session.events` form
    // marked a snapshot whose arrays were `[]` as "loaded" and suppressed the
    // chat screen's first-fetch. (In the load path detailState is resolved
    // explicitly in loadAgentSessionDetail regardless; this governs the
    // list-snapshot shape — kept correct defensively.) Use the mapped lengths,
    // not the raw fields, so an empty `[]` never counts as content.
    detailState:
      transcript.length > 0 || events.length > 0 ? { kind: 'ready' } : undefined,
    // Surface why the last page resolved the way it did (skipped_offline /
    // failed / cache_miss / fresh) so the chat screen can tell an empty
    // conversation apart from "agent offline, history unreachable".
    detailRefreshStatus:
      session.detail_refresh?.status ?? session.last_detail_fetch_status,
    suggestions: [],
    transcript,
    events,
    // Map the backend's slim `structured_events` envelopes into the
    // type-discriminated activity union. Snapshot-only mapping here (no
    // reconcile/merge — that's P2.3); unknown envelopes are dropped via the
    // null filter. `eventDetailCache` is intentionally left undefined on a
    // fresh snapshot (populated on demand in P3 via fetchStructuredEventDetail).
    // Cap at the transport boundary (same ring-buffer semantics as the live
    // applyStructuredEvent path): a first snapshot for a session with no local
    // run goes straight into vibeRuns, so an uncapped array here would reach
    // every screen selector subscribed to structuredEvents (iPhone watchdog
    // stopgap — big snapshot mounts on the JS thread).
    structuredEvents: tail(
      (session.structured_events ?? [])
        .map(env =>
          env && typeof env === 'object'
            ? envelopeToActivity(env as Record<string, unknown>)
            : null,
        )
        .filter((e): e is StructuredActivityEvent => e !== null),
      STRUCTURED_EVENTS_CAP,
    ),
  };
}

export const hasLoadedSessionDetail = (run: VibeCodingRun) =>
  isAuthoritativeDetail(run.detailState);

export function mergeAgentMessages(
  existing: VibeCodingRun['transcript'],
  incoming: VibeCodingRun['transcript'],
): VibeCodingRun['transcript'] {
  if (!incoming.length) return existing;
  const incomingById = new Map(incoming.map(item => [item.id, item]));
  const consumedIncoming = new Set<string>();
  const confirmedIncomingIds = new Set<string>();
  const merged: VibeCodingRun['transcript'] = [];

  const resolveMessage = (
    current: VibeCodingRun['transcript'][number] | undefined,
    item: VibeCodingRun['transcript'][number],
  ) =>
    current?.role === 'assistant' &&
    item.role === 'assistant' &&
    current.content.length > item.content.length
      ? current
      : item;

  const findPendingConfirmationIndex = (
    current: VibeCodingRun['transcript'][number],
  ) => {
    if (!current.pending) return -1;
    // Try exact match first (id + role + content).
    const exactIndex = incoming.findIndex(
      item =>
        !consumedIncoming.has(item.id) &&
        current.role === item.role &&
        (current.mode === item.mode || !current.mode || !item.mode) &&
        current.content === item.content,
    );
    if (exactIndex >= 0) return exactIndex;
    // Fallback: content-based match (handles race conditions where WebSocket
    // merged the server copy with a different id before the HTTP response
    // handler could reconcile). Match by role + content similarity.
    return incoming.findIndex(
      item =>
        !consumedIncoming.has(item.id) &&
        current.role === item.role &&
        current.content.trim() === item.content.trim(),
    );
  };

  const pushIncomingThrough = (incomingIndex: number) => {
    for (let index = 0; index <= incomingIndex; index += 1) {
      const item = incoming[index];
      if (consumedIncoming.has(item.id)) continue;
      const current = existing.find(existingItem => existingItem.id === item.id);
      const resolved = resolveMessage(current, item);
      merged.push(
        confirmedIncomingIds.has(item.id)
          ? { ...resolved, pending: false }
          : resolved,
      );
      consumedIncoming.add(item.id);
    }
  };

  for (const current of existing) {
    const incomingIndex = incoming.findIndex(item => item.id === current.id);
    if (incomingIndex >= 0) {
      if (current.pending) {
        confirmedIncomingIds.add(incoming[incomingIndex].id);
      }
      pushIncomingThrough(incomingIndex);
      continue;
    }

    const pendingIndex = findPendingConfirmationIndex(current);
    if (pendingIndex >= 0) {
      confirmedIncomingIds.add(incoming[pendingIndex].id);
      pushIncomingThrough(pendingIndex);
      continue;
    }

    merged.push(current);
  }

  for (const item of incoming) {
    if (!consumedIncoming.has(item.id)) {
      merged.push(resolveMessage(undefined, item));
      consumedIncoming.add(item.id);
    }
  }

  return merged.map(item => {
    const incomingItem = incomingById.get(item.id);
    if (!incomingItem || !confirmedIncomingIds.has(item.id)) return item;
    return { ...item, pending: false };
  });
}

export function dedupeAgentEvents(
  events: VibeCodingRun['events'],
): VibeCodingRun['events'] {
  if (events.length < 2) return events;
  const seen = new Set<string>();
  const deduped: VibeCodingRun['events'] = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const item = events[index];
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.unshift(item);
  }
  return deduped;
}

export function mergeAgentEvents(
  existing: VibeCodingRun['events'],
  incoming: VibeCodingRun['events'],
): VibeCodingRun['events'] {
  const incomingEvents = dedupeAgentEvents(incoming);
  if (!incomingEvents.length) return dedupeAgentEvents(existing);
  const existingEvents = dedupeAgentEvents(existing);
  const incomingIds = new Set(incomingEvents.map(item => item.id));
  return tail(
    [
      ...incomingEvents,
      ...existingEvents.filter(item => !incomingIds.has(item.id)),
    ],
    MAX_RUN_EVENTS,
  );
}

export function mergeVibeRunSnapshot(
  existing: VibeCodingRun | undefined,
  incoming: VibeCodingRun,
): VibeCodingRun {
  if (!existing) return incoming;
  const incomingHasDetail = hasLoadedSessionDetail(incoming);
  // 双轨活跃时钟(2026-10-15 事故):旧实现 Math.max 是单向棘轮——任何一个
  // 本地造假值(载荷缺时间戳时造的 now、事件处理器的本地钟)都会永久覆盖之后
  // 所有诚实快照,死会话卡片顶着 "just now" 直到进程退出。规则:
  //  - incoming 没带诚实时间(0)= 纯本地快照 → 保留存量;
  //  - 任一方 live(本地流式进行中)→ 保留 max:本地乐观不被旧快照拉回
  //    (原注释保护的场景),stale-demotion 守卫(下方)继续挡陈旧降级;
  //  - 双方均非 live → incoming 为服务端权威,直接覆盖(允许下修本地坏值)。
  const incomingCarriesActivity = (incoming.lastActivityMs ?? 0) > 0;
  const mergedActivityLive =
    ACTIVE_RUN_STATUS.has(existing.status) ||
    ACTIVE_RUN_STATUS.has(incoming.status);
  const lastActivityMs = !incomingCarriesActivity
    ? (existing.lastActivityMs ?? 0)
    : mergedActivityLive
      ? Math.max(existing.lastActivityMs ?? 0, incoming.lastActivityMs ?? 0)
      : (incoming.lastActivityMs ?? 0);
  // ...and don't let a stale/older snapshot demote an actively-running session's
  // STATUS either. A snapshot whose lastActivityMs is NOT newer than what we
  // hold locally (a reconnect refresh, a stray ai.session.updated, or the
  // stale-run sweeper) must not flip a session we know is running — because
  // deltas are still arriving — back to idle/completed. A genuinely-fresh
  // settle publish from the server carries a newer lastActivityMs (the settle
  // fires ~ALIANG_AI_IDLE_SETTLE_MS after the last activity), so it still
  // applies. This honors the comment above, which previously only protected the
  // timestamp, not the status. Caveat: significant server/client clock skew
  // (> the settle window) could over-retain "running"; the stale-run sweeper
  // and the next refresh eventually correct it.
  const existingActive = ACTIVE_RUN_STATUS.has(existing.status);
  const incomingActive = ACTIVE_RUN_STATUS.has(incoming.status);
  const incomingDemotes = existingActive && !incomingActive;
  const incomingFailure = incoming.status === 'failed';
  const incomingHasVersionAuthority = incoming.runStateVersion !== undefined;
  const existingHasVersionAuthority = existing.runStateVersion !== undefined;
  const hasVersionAuthority =
    existingHasVersionAuthority && incomingHasVersionAuthority;
  const olderVersion =
    hasVersionAuthority &&
    incoming.runStateVersion! < existing.runStateVersion!;
  const sameVersionStatusConflict =
    hasVersionAuthority &&
    incoming.runStateVersion === existing.runStateVersion &&
    (incoming.status !== existing.status || incoming.phase !== existing.phase);
  const optimisticRunRejectsOldSnapshot = Boolean(
    existing.optimisticRunPending &&
      incomingHasVersionAuthority &&
      incoming.runStateVersion! <= (existing.optimisticRunBaseVersion ?? -1),
  );
  const staleDemotion =
    incomingDemotes &&
    !incomingFailure &&
    (incoming.lastActivityMs ?? 0) <= (existing.lastActivityMs ?? 0);
  // 反向守卫:已结算的会话(existing 非活跃)不被陈旧的活跃快照重新激活。ai.done 已把
  // status 翻成 idle 并 bump lastActivityMs,此后一个滞后的 running 快照(活动不比本地新)
  // 不能再翻回 running——否则回合结束会闪回进行中(就是当年要靠 8s 压的那种抖动)。真正的新
  // 回合(新发送乐观置 running / 服务端更新的更新活动)lastActivityMs 更新,不被拦截。
  const staleReactivation =
    !existingActive &&
    incomingActive &&
    (incoming.lastActivityMs ?? 0) <= (existing.lastActivityMs ?? 0);
  // Protocol v2 uses a monotonic server revision. This is the primary guard and
  // is deliberately independent of Date.now()/last_active_at, so phone/server
  // clock skew cannot retain running forever or resurrect a completed run. The
  // timestamp guard remains only for snapshots from legacy servers.
  const rejectIncomingState = incomingHasVersionAuthority
    ? olderVersion || sameVersionStatusConflict || optimisticRunRejectsOldSnapshot
    : existingHasVersionAuthority
      ? true
      : staleDemotion || staleReactivation;
  const transcript = incomingHasDetail
    ? mergeAgentMessages(existing.transcript, incoming.transcript)
    : existing.transcript;
  const events = incomingHasDetail
    ? mergeAgentEvents(existing.events, incoming.events)
    : existing.events;
  // Resolve the merged detail state. Three steps, in order:
  //  1. mergeDetailState — authoritative incoming (ready/empty) wins; else keep
  //     existing (a transient-empty fetch must not clobber content held locally).
  //  2. invalidateStaleEmptyDetail — `empty` is not permanent; if the merged run
  //     now proves history exists (transcriptCount > 0), demote it so the screen
  //     re-fetches instead of freezing on a blank conversation.
  //  3. re-resolve from the snapshot's detailRefreshStatus — detailState is only
  //     resolved at fetch time otherwise, so a snapshot that pushes a new status
  //     (failed / skipped_offline) wouldn't update it, and the UI (which reads
  //     detailState.kind) would miss the change. Re-resolve when the snapshot
  //     carries a status and we're not holding content (ready is authoritative).
  //     List snapshots omit detailRefreshStatus, so they don't trigger this.
  const mergedTranscriptCount = incoming.transcriptCount ?? existing.transcriptCount ?? 0;
  let detailState = invalidateStaleEmptyDetail(
    mergeDetailState(incoming.detailState, existing.detailState),
    mergedTranscriptCount,
  );
  if (
    incoming.detailRefreshStatus !== undefined &&
    detailState?.kind !== 'ready'
  ) {
    detailState = resolveDetailState({
      transcriptLength: transcript.length,
      transcriptCount: mergedTranscriptCount,
      detailRefreshStatus: incoming.detailRefreshStatus,
    });
  }
  const incomingGoalVersion = incoming.goalSummary?.stateVersion;
  const existingGoalVersion = existing.goalSummary?.stateVersion;
  const goalSummary = !incoming.goalSummary
    ? existing.goalSummary
    : incomingGoalVersion !== undefined &&
      existingGoalVersion !== undefined &&
      incomingGoalVersion < existingGoalVersion
      ? existing.goalSummary
      : incomingGoalVersion === existingGoalVersion &&
        existing.goalSummary &&
        existing.goalSummary.state === incoming.goalSummary.state
        ? existing.goalSummary
        : incoming.goalSummary;
  return {
    ...existing,
    ...incoming,
    status: rejectIncomingState ? existing.status : incoming.status,
    // Apply the SAME stale guard to the server-authoritative phase: when we
    // reject a snapshot's status demotion/reactivation as stale, also reject
    // its phase (a stale 'completed' must not leak onto a session we know is
    // running, and vice versa). A fresh snapshot's phase always wins.
    phase: rejectIncomingState ? existing.phase : incoming.phase,
    activeRunId: rejectIncomingState ? existing.activeRunId : incoming.activeRunId,
    latestRunId: rejectIncomingState ? existing.latestRunId : incoming.latestRunId,
    runState: rejectIncomingState ? existing.runState : incoming.runState,
    runStateVersion: rejectIncomingState
      ? existing.runStateVersion
      : incoming.runStateVersion,
    optimisticRunPending:
      existing.optimisticRunPending &&
      (rejectIncomingState || !incomingHasVersionAuthority),
    optimisticRunBaseVersion:
      existing.optimisticRunPending &&
      (rejectIncomingState || !incomingHasVersionAuthority)
        ? existing.optimisticRunBaseVersion
        : undefined,
    lastActivityMs,
    updatedAt: formatActivityLabel(lastActivityMs),
    transcript,
    events,
    detailState,
    // lastViewedAt is purely client-side (never in a server snapshot), so always
    // keep the existing value — otherwise every ai.session.updated / snapshot
    // merge would wipe it and break idle demotion immediately.
    lastViewedAt: existing.lastViewedAt,
    // 位置感知合并(见 acceptServerTranscriptPage):`incoming ?? existing`
    // 的整体覆写会把客户端已翻历史的游标整体顶回服务端热窗起点——审计问题6
    // 自愈路径上的反噬。undefined 的 incoming(列表快照不带页)保持旧行为。
    transcriptPage: acceptServerTranscriptPage(
      existing.transcriptPage,
      incoming.transcriptPage,
      transcript,
    ),
    // effective_model_config is only attached to detail snapshots; keep the last
    // known value when a partial list snapshot omits it, so the session-settings
    // "当前有效" hint survives reconnect refreshes.
    effectiveModelConfig:
      incoming.effectiveModelConfig ?? existing.effectiveModelConfig,
    modelConfigVersion:
      incoming.modelConfigVersion ?? existing.modelConfigVersion,
    activeExecutionProfile:
      incoming.activeExecutionProfile ?? existing.activeExecutionProfile,
    lastMessage:
      (incomingHasDetail
        ? transcript[transcript.length - 1] ?? incoming.lastMessage
        : incoming.lastMessage) ??
      existing.lastMessage ??
      transcript[transcript.length - 1],
    // Re-derive from the merged transcript so a freshly-loaded history (or a
    // just-appended user turn) updates the "最新提问" preview; otherwise keep the
    // last known value so a transcript-less list snapshot doesn't blank it.
    lastUserMessage: lastUserMessageOf(
      transcript,
      incoming.lastUserMessage ?? existing.lastUserMessage,
    ),
    // Preserve the bound CLI session id (Claude uuid) across merges: a
    // transcript-less list snapshot omits it, so keep the last known value
    // rather than letting the spread wipe it.
    sourceSessionId: incoming.sourceSessionId ?? existing.sourceSessionId,
    // 来源(诞生地)不可变: 映射层总会打满, incoming 优先即可。
    origin: incoming.origin ?? existing.origin,
    purpose: incoming.purpose ?? existing.purpose,
    goalSummary,
  };
}

const messageFingerprint = (message: VibeCodingRun['lastMessage']) =>
  message
    ? `${message.id}:${message.role}:${message.timestamp}:${message.content}`
    : '';

export function hasMeaningfulVibeRunUpdate(
  existing: VibeCodingRun | undefined,
  incoming: VibeCodingRun,
): boolean {
  if (!existing) return true;
  if ((incoming.lastActivityMs ?? 0) > (existing.lastActivityMs ?? 0))
    return true;
  return (
    existing.status !== incoming.status ||
    existing.title !== incoming.title ||
    existing.objective !== incoming.objective ||
    existing.currentStep !== incoming.currentStep ||
    existing.model !== incoming.model ||
    existing.branch !== incoming.branch ||
    existing.transcriptCount !== incoming.transcriptCount ||
    existing.eventCount !== incoming.eventCount ||
    existing.filesTouchedCount !== incoming.filesTouchedCount ||
    existing.gitChangedCount !== incoming.gitChangedCount ||
    (incoming.purpose !== undefined && existing.purpose !== incoming.purpose) ||
    (incoming.goalSummary !== undefined &&
      (existing.goalSummary?.stateVersion !== incoming.goalSummary.stateVersion ||
        existing.goalSummary?.state !== incoming.goalSummary.state)) ||
    existing.retryActive !== incoming.retryActive ||
    existing.retryAttempt !== incoming.retryAttempt ||
    existing.retryErrorStatus !== incoming.retryErrorStatus ||
    existing.lastErrorStatus !== incoming.lastErrorStatus ||
    messageFingerprint(existing.lastMessage) !==
      messageFingerprint(incoming.lastMessage) ||
    messageFingerprint(existing.lastUserMessage) !==
      messageFingerprint(incoming.lastUserMessage)
  );
}

export function mapSessionStatus(status: string): VibeStatus {
  switch (status) {
    case 'running':
      return 'running';
    case 'active':
      return 'running';
    case 'creating':
      return 'running';
    case 'idle':
      return 'idle';
    case 'paused':
      return 'paused';
    case 'error':
      return 'failed';
    case 'closed':
      return 'completed';
    default:
      return 'idle';
  }
}

/**
 * Statuses where the agent is blocked waiting on the user (to approve a tool
 * use / choose a plan). The server sets `paused` when it derives an approval
 * from an assistant reply (server `derived.ts`); `waiting_approval` is the
 * in-memory flag flipped when an `approval.requested` push is applied locally
 * (controlCenterStore). Either means "an approval may be pending that the
 * one-shot push dropped" — a candidate for recovery.
 */
export const isWaitingApprovalStatus = (
  status: VibeStatus | undefined,
): boolean => status === 'paused' || status === 'waiting_approval';

/**
 * True ONLY on the non-waiting → waiting EDGE. Drives the one-shot dashboard
 * re-fetch when a session transitions into an approval-pending state, so an
 * `approval.requested` push dropped by a momentary WS blip is recovered
 * without waiting for `ai.done` (which a turn paused-for-approval never
 * emits). Returns false while already waiting (no re-fire), when leaving
 * waiting, and during normal running activity (thinking / tool use) — those
 * must NOT trigger a refresh.
 */
export const enteredWaitingApproval = (
  prev: VibeStatus | undefined,
  next: VibeStatus,
): boolean => !isWaitingApprovalStatus(prev) && isWaitingApprovalStatus(next);

export function serverApprovalToClient(
  sa: PlatformApprovalSnapshot,
): ApprovalRequest {
  return {
    id: sa.id,
    kind: (sa.kind as ApprovalKind) ?? 'dangerous_command',
    title: sa.title,
    summary: sa.summary,
    deviceId: sa.device_id,
    projectId: sa.project_id,
    sessionId: sa.session_id,
    terminalId: sa.terminal_id,
    command: sa.command,
    toolName: sa.tool_name,
    files: sa.files,
    options: sa.options,
    risk: sa.risk,
    status: sa.status as ApprovalRequest['status'],
    createdAt: sa.created_at,
    resolvedAt: sa.resolved_at,
  };
}

export function mapTerminalStatus(
  status: PlatformTerminalSessionSnapshot['status'],
): TerminalSessionStatus {
  switch (status) {
    case 'creating':
      return 'idle';
    case 'active':
      return 'running';
    case 'error':
      return 'failed';
    case 'closed':
      return 'completed';
    default:
      return 'idle';
  }
}

export function serverTerminalSessionToClient(
  session: PlatformTerminalSessionSnapshot,
): TerminalSession {
  return {
    id: session.session_id,
    deviceId: session.device_id,
    directory: session.cwd ?? '~',
    shell: session.shell ?? 'zsh',
    status: mapTerminalStatus(session.status),
    lines: [
      line(
        'system',
        `Terminal session restored from platform state (${session.status}).`,
      ),
    ],
    createdAt: session.created_at,
    updatedAt: session.last_active_at,
    lastCommand: session.last_command,
    lastCommandAt: session.last_command_at,
    // Replay state is realtime-only (never carried by REST snapshots): every
    // freshly mapped session starts with an empty buffer.
    replayChunks: [],
    replayReady: false,
    replayTruncated: false,
  };
}

export function mergeTerminalSessionSnapshot(
  existing: TerminalSession | undefined,
  incoming: TerminalSession,
): TerminalSession {
  if (!existing) return incoming;

  return {
    ...incoming,
    lines: existing.lines.length ? existing.lines : incoming.lines,
    // Replay state is buffered by the realtime stream, not the snapshot: a
    // rehydration must never drop unconsumed replayChunks — nor an in-flight
    // replayPending (the attach REST response lands mid-stream all the time).
    replayChunks: existing.replayChunks ?? incoming.replayChunks,
    replayReady: existing.replayReady ?? incoming.replayReady,
    replayStatus: existing.replayStatus ?? incoming.replayStatus,
    replayTruncated: existing.replayTruncated ?? incoming.replayTruncated,
    replayPending: existing.replayPending ?? incoming.replayPending,
    // Same for the pending geometry follow (设计 §1): it is realtime-only and
    // REST snapshots never carry it — the attach flow's snapshot merge runs
    // exactly when the user re-enters the terminal screen, and the follow
    // must survive that re-entry instead of silently dropping the badge.
    geometryFollow: existing.geometryFollow ?? incoming.geometryFollow,
  };
}

// --- Terminal scrollback replay buffering -------------------------------
// `terminal.replay` frames (attach flow) are buffered per session as
// display-ready text chunks (base64 frames are decoded at ingest — see
// appendTerminalReplayChunk) so the emulator can write them into xterm
// verbatim once the final frame arrives. UTF-8 byte length is computed
// manually: Hermes (the RN JS runtime) has no TextEncoder.
// -------------------------------------------------------------------------

/** UTF-8 byte length of a string without TextEncoder (absent on Hermes). */
export const utf8ByteLength = (value: string): number => {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) bytes += 4; // surrogate pair head
    else if (code >= 0xdc00 && code <= 0xdfff) continue; // pair tail, counted with head
    else bytes += 3;
  }
  return bytes;
};

/**
 * Start a FRESH replay stream for the session: drop any buffered chunks and
 * stale flags. Invoked when a new `terminal.replay` stream begins (seq 0, or
 * a non-final frame landing on an already-finalized buffer) and exposed as
 * the `resetTerminalReplay` store action for the attach flow — so a re-attach
 * replaces the previous scrollback instead of duplicating it.
 *
 * Attach-seam hygiene (Bug D,审计 §2-1/2): beginning a stream ALSO drops the
 * terminalOutputRegistry's pending buffer for the session. That buffer holds
 * live chunks received while no emulator was mounted (up to 200) — the
 * replayed scrollback re-covers exactly those bytes, so draining them after
 * wiring would write the same bytes twice (probe: one prompt painted into
 * the WebView twice). `replayPending: true` announces the in-flight stream
 * so the emulator holds the live handoff until the final frame: without it
 * the old gate (`!replayReady && chunks.length > 0`) passes before the FIRST
 * replay frame lands (chunks still empty) and the late history gets appended
 * on top of already-wired live output (probe order: output → replay →
 * replay).
 *
 * Known residual, honestly out of scope here (needs a watermark/sequence
 * scheme as future independent work): live bytes arriving BETWEEN the attach
 * start and the finalize still buffer into the registry pending and are
 * drained behind the replay — they can overlap the scrollback's tail because
 * the agent's replay snapshot was taken at attach time. The cold-attach
 * placeholder (session unknown locally, terminalSlice) does not run this
 * function but performs the same two steps itself at placeholder creation,
 * closing its pre-first-frame window; the residual above is all that remains.
 */
export function beginTerminalReplayStream(
  session: TerminalSession,
): TerminalSession {
  clearPendingTerminalOutput(session.id);
  return {
    ...session,
    replayChunks: [],
    replayReady: false,
    replayStatus: undefined,
    replayTruncated: false,
    replayPending: true,
  };
}

/**
 * Append one `terminal.replay` chunk to the session's independent replay
 * buffer. When the total exceeds MAX_REPLAY_CHUNKS_BYTES, whole chunks are
 * dropped from the HEAD (oldest first) and `replayTruncated` is set — chunks
 * are never split, so no ANSI escape or multibyte char gets corrupted at the
 * seam. (A lone over-cap chunk is kept whole rather than split; the agent
 * protocol caps frames at 64KB, far below the budget.) Returns the same
 * reference for an empty chunk.
 *
 * Encoding contract: a stored replay chunk is ALWAYS display-ready text.
 * `terminal.replay` frames carry the same `encoding` field as
 * `terminal.output`; base64 frames are decoded HERE at ingest (whole-chunk,
 * so UTF-8/ANSI boundaries stay intact) because the emulator injects every
 * chunk with `encoding='text'` — an undecoded base64 frame would paint the
 * whole scrollback as mojibake while identical live frames render fine.
 */
export function appendTerminalReplayChunk(
  session: TerminalSession,
  data: string,
  encoding = 'text',
): TerminalSession {
  if (!data) return session;

  const text = decodeTerminalData(data, encoding);
  const existingChunks = session.replayChunks ?? [];
  const chunks = [...existingChunks, text];
  let truncated = session.replayTruncated ?? false;

  // Bytes are tracked incrementally: chunk counts can reach the hundreds.
  let total = utf8ByteLength(text);
  for (const chunk of existingChunks) total += utf8ByteLength(chunk);
  while (chunks.length > 1 && total > MAX_REPLAY_CHUNKS_BYTES) {
    total -= utf8ByteLength(chunks[0]);
    chunks.shift();
    truncated = true;
  }

  return { ...session, replayChunks: chunks, replayTruncated: truncated };
}

/**
 * Mark the replay stream complete after the final `terminal.replay` frame.
 * `status` maps to replayStatus (anything but "exited" means the session was
 * live). The agent's `truncated` flag is OR-ed with any locally observed
 * truncation — either side losing scrollback means the buffer is incomplete.
 * Clearing `replayPending` releases the emulator's handoff hold (Bug D ②).
 */
export function finalizeTerminalReplay(
  session: TerminalSession,
  frame?: { status?: string; truncated?: boolean },
): TerminalSession {
  return {
    ...session,
    replayReady: true,
    replayStatus: frame?.status === 'exited' ? 'exited' : 'live',
    replayTruncated:
      frame?.truncated === true || (session.replayTruncated ?? false),
    replayPending: false,
  };
}

export function serverPreviewToClient(
  preview: PlatformPreviewSnapshot,
): PreviewLink {
  const access = ['private', 'team', 'public'].includes(preview.access)
    ? (preview.access as PreviewLink['access'])
    : 'private';
  return {
    id: preview.id,
    sessionId: preview.sessionId,
    port: preview.port,
    shortUrl: preview.shortUrl,
    targetUrl: preview.targetUrl,
    expiresIn: preview.expiresIn ?? '',
    access,
    // Auto port-forwarding mapping state (undefined = no mapping recorded);
    // the snapshot hydration path must carry these or a refresh after a
    // preview.updated broadcast would silently drop the public URL again.
    publicUrl: preview.publicUrl,
    portMappingId: preview.portMappingId,
    mappingStatus: preview.mappingStatus,
    mappingError: preview.mappingError,
  };
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const payloadString = (
  payload: Record<string, unknown> | undefined,
  key: string,
) => {
  const value = payload?.[key];
  return typeof value === 'string' ? value : undefined;
};

const payloadStringArray = (
  payload: Record<string, unknown> | undefined,
  key: string,
) => {
  const value = payload?.[key];
  return Array.isArray(value) ? value.map(String) : undefined;
};

const payloadRecords = (
  payload: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown>[] => {
  const value = payload?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object' && !Array.isArray(item)),
  );
};

const approvalStatus = (value: string | undefined): ApprovalRequest['status'] =>
  value === 'approved' || value === 'denied' ? value : 'pending';

const approvalRisk = (
  value: string | undefined,
): ApprovalRequest['risk'] =>
  value === 'low' || value === 'medium' || value === 'high'
    ? value
    : 'medium';

export function realtimeApprovalSnapshot(
  message: PlatformRealtimeEventSnapshot,
): PlatformApprovalSnapshot | undefined {
  if (message.message_type !== 'approval.requested') return undefined;
  const payload = isRecord(message.payload) ? message.payload : undefined;
  const approval = isRecord(payload?.approval) ? payload.approval : undefined;
  if (!approval) return undefined;

  const id = payloadString(approval, 'id') ?? payloadString(approval, 'approval_id');
  const deviceId = payloadString(approval, 'device_id') ?? message.device_id;
  if (!id || !deviceId) return undefined;

  const options: NonNullable<PlatformApprovalSnapshot['options']> = [];
  payloadRecords(approval, 'options').forEach(option => {
    const optionId = payloadString(option, 'id');
    const label = payloadString(option, 'label');
    if (!optionId || !label) return;
    options.push({
      id: optionId,
      label,
      description: payloadString(option, 'description'),
      response: payloadString(option, 'response'),
    });
  });

  return {
    id,
    approval_id: payloadString(approval, 'approval_id') ?? id,
    user_id: payloadString(approval, 'user_id') ?? message.user_id,
    device_id: deviceId,
    project_id: payloadString(approval, 'project_id'),
    session_id: payloadString(approval, 'session_id') ?? message.session_id,
    terminal_id: payloadString(approval, 'terminal_id'),
    kind: payloadString(approval, 'kind') ?? 'client_response',
    title: payloadString(approval, 'title') ?? 'Approval requested',
    summary:
      payloadString(approval, 'summary') ??
      payloadString(payload, 'detail') ??
      'The assistant is waiting for approval.',
    command: payloadString(approval, 'command'),
    tool_name: payloadString(approval, 'tool_name'),
    files: payloadStringArray(approval, 'files'),
    options: options.length ? options : undefined,
    risk: approvalRisk(payloadString(approval, 'risk')),
    status: approvalStatus(payloadString(approval, 'status')),
    created_at: payloadString(approval, 'created_at') ?? message.created_at,
    resolved_at: payloadString(approval, 'resolved_at'),
  };
}

export function primitivePayload(payload: unknown): UnifiedEvent['payload'] {
  if (!isRecord(payload)) return undefined;
  const entries = Object.entries(payload)
    .filter(
      ([, value]) =>
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean',
    )
    .slice(0, 8);
  return entries.length
    ? (Object.fromEntries(entries) as UnifiedEvent['payload'])
    : undefined;
}

export function realtimeMessageTypeToEventType(
  messageType: string,
  payload: Record<string, unknown> | undefined,
): UnifiedEventType {
  if (messageType === 'device.updated') {
    const device = isRecord(payload?.device) ? payload.device : undefined;
    return payloadString(device, 'status') === 'offline'
      ? 'device.offline'
      : 'device.bound';
  }
  if (messageType === 'project.updated') return 'project.updated';
  if (messageType === 'projects.updated') return 'project.scan.completed';
  if (messageType === 'ai.delta') return 'agent.delta';
  if (messageType === 'ai.done') return 'agent.session.completed';
  if (messageType === 'ai.error') return 'agent.session.failed';
  if (messageType === 'ai.session.created') {
    return 'agent.session.started';
  }
  if (messageType === 'ai.session.updated') return 'agent.session.updated';
  if (messageType === 'ai.session.deleted') return 'agent.session.terminated';
  if (messageType === 'ai.sessions.updated') return 'agent.session.updated';
  if (messageType === 'terminal.output') return 'terminal.output';
  if (messageType.startsWith('terminal.')) return 'command.completed';
  if (messageType === 'approval.requested') return 'approval.requested';
  if (messageType === 'preview.ready') return 'agent.delta';
  return 'platform.event';
}

export function realtimeMessageStatus(messageType: string): UnifiedEventStatus {
  if (messageType === 'ai.error' || messageType === 'terminal.error')
    return 'failed';
  if (messageType === 'approval.requested') return 'waiting';
  if (messageType === 'ai.delta' || messageType === 'terminal.output')
    return 'running';
  return 'done';
}

export function realtimeMessageTitle(
  messageType: string,
  payload: Record<string, unknown> | undefined,
): string {
  const project = isRecord(payload?.project) ? payload.project : undefined;
  const device = isRecord(payload?.device) ? payload.device : undefined;
  const session = isRecord(payload?.session) ? payload.session : undefined;
  const approval = isRecord(payload?.approval) ? payload.approval : undefined;
  if (messageType === 'project.updated')
    return payloadString(project, 'name') ?? 'Project updated';
  if (messageType === 'device.updated')
    return payloadString(device, 'name') ?? 'Device updated';
  if (messageType === 'approval.requested')
    return payloadString(approval, 'title') ?? 'Approval requested';
  if (messageType === 'ai.session.created')
    return payloadString(session, 'title') ?? 'VibeCoding started';
  if (messageType === 'ai.session.updated')
    return payloadString(session, 'title') ?? 'VibeCoding updated';
  if (messageType === 'ai.sessions.updated')
    return 'VibeCoding sessions synced';
  if (messageType === 'ai.done') return 'VibeCoding completed';
  if (messageType === 'ai.error') return 'VibeCoding failed';
  if (messageType === 'preview.ready') return 'Preview ready';
  return messageType;
}

export function realtimeMessageDetail(
  message: PlatformRealtimeEventSnapshot,
  payload: Record<string, unknown> | undefined,
): string {
  const project = isRecord(payload?.project) ? payload.project : undefined;
  const device = isRecord(payload?.device) ? payload.device : undefined;
  const session = isRecord(payload?.session) ? payload.session : undefined;
  const approval = isRecord(payload?.approval) ? payload.approval : undefined;
  return (
    payloadString(payload, 'detail') ??
    payloadString(payload, 'delta') ??
    payloadString(payload, 'error') ??
    payloadString(session, 'current_step') ??
    payloadString(session, 'objective') ??
    payloadString(project, 'path') ??
    payloadString(device, 'host') ??
    payloadString(approval, 'summary') ??
    message.direction
  );
}

function realtimeMessageTimestamp(
  message: PlatformRealtimeEventSnapshot,
  payload: Record<string, unknown> | undefined,
): string {
  const session = isRecord(payload?.session) ? payload.session : undefined;
  if (message.message_type === 'ai.session.created') {
    return payloadString(session, 'created_at') ?? message.created_at;
  }
  if (message.message_type === 'ai.session.updated') {
    return (
      payloadString(session, 'last_active_at') ??
      payloadString(session, 'updated_at') ??
      message.created_at
    );
  }
  return message.created_at;
}

export function realtimeEventToUnifiedEvent(
  message: PlatformRealtimeEventSnapshot,
): UnifiedEvent {
  const payload = isRecord(message.payload) ? message.payload : undefined;
  const approval = realtimeApprovalSnapshot(message);
  return {
    id: message.id,
    type: realtimeMessageTypeToEventType(message.message_type, payload),
    title: realtimeMessageTitle(message.message_type, payload),
    detail: realtimeMessageDetail(message, payload),
    status: realtimeMessageStatus(message.message_type),
    deviceId: message.device_id ?? approval?.device_id,
    projectId: approval?.project_id,
    sessionId: message.session_id ?? approval?.session_id,
    terminalId: approval?.terminal_id,
    approvalId: approval?.id,
    timestamp: realtimeMessageTimestamp(message, payload),
    payload: primitivePayload(message.payload),
  };
}

export function dedupeUnifiedEvents(events: UnifiedEvent[]): UnifiedEvent[] {
  const seen = new Set<string>();
  return events.filter(item => {
    const key = [
      item.type,
      item.deviceId ?? '',
      item.sessionId ?? '',
      item.terminalId ?? '',
      item.approvalId ?? '',
      item.timestamp,
      item.status,
      item.title,
      item.detail,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function serverNotificationToClient(
  notification: PlatformNotificationSnapshot,
): PushNotificationItem {
  return {
    id: notification.notification_id || notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    deviceId: notification.device_id,
    sessionId: notification.session_id,
    approvalId: notification.approval_id,
    read: Boolean(notification.read),
    createdAt: notification.created_at,
  };
}

export function upsertNotification(
  list: PushNotificationItem[],
  item: PushNotificationItem,
): PushNotificationItem[] {
  return [item, ...list.filter(existing => existing.id !== item.id)]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 120);
}

export const fileNameFromPath = (pathValue: string) =>
  pathValue.split(/[\\/]/).filter(Boolean).pop() ?? pathValue;

export const parentPathOf = (pathValue: string) => {
  const normalized = pathValue.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return normalized;
  const prefix = normalized.startsWith('/') ? '/' : '';
  return `${prefix}${parts.slice(0, -1).join('/')}`;
};

export const formatBytes = (bytes?: number) => {
  if (bytes === undefined || !Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
};

export function serverProjectFileToClient(
  projectId: string,
  directoryPath: string,
  file: PlatformProjectFileListSnapshot['entries'][number],
): ProjectFileEntry {
  const isFolder = file.kind === 'directory';
  return {
    id: `${projectId}:${file.path}`,
    projectId,
    deviceId: file.device_id,
    directoryPath,
    path: file.path,
    name: file.name || fileNameFromPath(file.path),
    kind: isFolder ? 'folder' : 'file',
    status: normalizeFileStatus(file.status),
    language: file.language ?? (isFolder ? 'Folder' : 'File'),
    size: isFolder ? '-' : formatBytes(file.size_bytes),
    sizeBytes: file.size_bytes,
    lastTouched: file.modified_at ?? 'unknown',
    modifiedAt: file.modified_at,
    etag: `${file.size_bytes ?? ''}:${file.modified_at ?? ''}`,
    summary:
      file.summary ?? (isFolder ? 'Directory' : 'Synced from desktop Agent.'),
  };
}

export function serverProjectContentToFileEntry(
  projectId: string,
  content: PlatformProjectFileContentSnapshot,
): ProjectFileEntry {
  return {
    id: `${projectId}:${content.path}`,
    projectId,
    deviceId: content.device_id,
    directoryPath: parentPathOf(content.path),
    path: content.path,
    name: fileNameFromPath(content.path),
    kind: 'file',
    status: 'clean',
    language: content.mime_type ?? 'File',
    size: formatBytes(content.size_bytes),
    sizeBytes: content.size_bytes,
    lastTouched: content.modified_at ?? 'unknown',
    modifiedAt: content.modified_at,
    summary: content.truncated
      ? 'Loaded preview from desktop Agent. Content was truncated.'
      : 'Loaded from desktop Agent.',
    content: content.content,
    encoding: content.encoding,
    loadedAt: nowTime(),
    truncated: content.truncated,
    etag: `${content.size_bytes ?? ''}:${content.modified_at ?? ''}`,
  };
}

export const activeVibeStatuses: VibeStatus[] = [
  'running',
  'waiting_user',
  'waiting_approval',
  'testing',
  'preview_ready',
  'paused',
];

export const mergeIds = (...groups: string[][]): string[] =>
  Array.from(new Set(groups.flat().filter(Boolean)));

export const projectBelongsToDevice = (
  project: Project,
  device: Device,
): boolean =>
  project.deviceId === device.id || device.projectIds.includes(project.id);

/** Order-independent membership check for two string arrays. Lets the
 *  relation-deriving helpers below keep a device's existing array (and object)
 *  reference when the recomputed members are identical. Without this, every
 *  re-derivation allocates a fresh array of fresh device objects, so
 *  `state.devices` changes identity on every snapshot and zustand v5
 *  (Object.is equality) re-renders all ~17 `state => state.devices`
 *  subscribers even when nothing changed. */
const sameStringMembers = (
  a: string[] | undefined,
  b: string[] | undefined,
): boolean => {
  if (a === b) return true;
  // A snapshot device may arrive without projectIds/activeSessionIds yet.
  // Treat a missing side as "different" so the field is (re)set to the computed
  // array — matching the previous always-assign behavior.
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const seen = new Set(b);
  for (const id of a) {
    if (!seen.has(id)) return false;
  }
  return true;
};

export const attachProjectIds = (
  devices: Device[],
  projects: Project[],
): Device[] => {
  let changed = false;
  const next = devices.map(device => {
    const computed = mergeIds(
      device.projectIds,
      projects
        .filter(project => projectBelongsToDevice(project, device))
        .map(project => project.id),
    );
    if (sameStringMembers(computed, device.projectIds)) {
      return device;
    }
    changed = true;
    return { ...device, projectIds: computed };
  });
  return changed ? next : devices;
};

export const attachActiveSessionIds = (
  devices: Device[],
  vibeRuns: VibeCodingRun[],
): Device[] => {
  const sessionsByDevice = new Map<string, string[]>();

  for (const run of vibeRuns) {
    if (!activeVibeStatuses.includes(run.status)) continue;
    const existing = sessionsByDevice.get(run.deviceId) ?? [];
    sessionsByDevice.set(run.deviceId, [run.id, ...existing]);
  }

  let changed = false;
  const next = devices.map(device => {
    const computed = sessionsByDevice.get(device.id) ?? [];
    if (sameStringMembers(computed, device.activeSessionIds)) {
      return device;
    }
    changed = true;
    return { ...device, activeSessionIds: computed };
  });
  return changed ? next : devices;
};

export const attachDeviceRelations = (
  devices: Device[],
  projects: Project[],
  vibeRuns: VibeCodingRun[],
): Device[] =>
  attachActiveSessionIds(attachProjectIds(devices, projects), vibeRuns);

/**
 * Pure state transition for removing a device after a successful /unbind.
 * Drops the device, any projects / vibe runs referencing it, re-attaches
 * relation counts on surviving devices, and prepends a 'Device removed' event.
 * Tested directly (see internals.test.ts) — the store action is a thin wrapper.
 */
export const removeDeviceFromState = (
  devices: Device[],
  projects: Project[],
  vibeRuns: VibeCodingRun[],
  events: UnifiedEvent[],
  deviceId: string,
  deviceName: string,
): { devices: Device[]; projects: Project[]; vibeRuns: VibeCodingRun[]; events: UnifiedEvent[] } => {
  const nextProjects = projects.filter(project => project.deviceId !== deviceId);
  const nextVibeRuns = vibeRuns.filter(run => run.deviceId !== deviceId);
  return {
    projects: nextProjects,
    vibeRuns: nextVibeRuns,
    devices: attachDeviceRelations(
      devices.filter(device => device.id !== deviceId),
      nextProjects,
      nextVibeRuns,
    ),
    events: [
      event('device.bound', 'Device removed', deviceName, 'done', { deviceId }),
      ...events,
    ].slice(0, 120),
  };
};

export function stateFromSnapshot(
  snapshot: Awaited<ReturnType<typeof platformTransport.loadSnapshot>>,
  previousRuns: VibeCodingRun[],
  previousTerminalSessions: TerminalSession[] = [],
  previousTerminalCommandHistory: Record<string, TerminalCommandHistoryItem[]> = {},
) {
  const baseDevices = snapshot.devices.map(platformDeviceToClient);
  const knownDeviceIds = new Set(baseDevices.map(device => device.id));
  const projects = snapshot.projects
    .filter(project => knownDeviceIds.has(project.device_id))
    .map(serverProjectToClient);
  const vibeRuns = snapshot.aiSessions
    .filter(session => knownDeviceIds.has(session.device_id))
    .map(session => serverAiSessionToVibeRun(session, baseDevices, projects));
  const previousRunsById = new Map(previousRuns.map(run => [run.id, run]));
  const mergedVibeRuns = evictOverflowVibeRuns(
    vibeRuns.map(run => {
      // Preserve the non-destructive merge: keep the locally-held transcript
      // AND incorporate the snapshot's, then bound memory with trim. Previously
      // this overwrote the merged transcript with the snapshot's own
      // (trimTranscript(run.transcript)), so a snapshot whose hot window was
      // empty for a session wiped whatever the client already had — turning a
      // reconnect-driven refresh into "正在拉取完整会话内容…" then a blank
      // screen. mergeVibeRunSnapshot already guards against a stale snapshot
      // demoting content; honour that instead of clobbering it.
      const merged = mergeVibeRunSnapshot(previousRunsById.get(run.id), run);
      const trimmed = trimTranscriptWithWindow(
        merged.transcript,
        merged.transcriptPage,
      );
      if (trimmed.pageDelta && merged.transcriptPage) {
        return {
          ...merged,
          transcript: trimmed.transcript,
          transcriptPage: { ...merged.transcriptPage, ...trimmed.pageDelta },
        };
      }
      return { ...merged, transcript: trimmed.transcript };
    }),
  );
  const devices = attachDeviceRelations(baseDevices, projects, mergedVibeRuns);
  const scanResults = projects.map(projectToScanResult);
  const approvalsById = new Map<string, ApprovalRequest>();
  snapshot.realtimeEvents
    .map(realtimeApprovalSnapshot)
    .filter(
      (approval): approval is PlatformApprovalSnapshot =>
        Boolean(approval && knownDeviceIds.has(approval.device_id)),
    )
    .forEach(approval => {
      approvalsById.set(approval.id, serverApprovalToClient(approval));
    });
  snapshot.approvals
    .filter(approval => knownDeviceIds.has(approval.device_id))
    .forEach(approval => {
      approvalsById.set(approval.id, serverApprovalToClient(approval));
    });
  const approvals = Array.from(approvalsById.values())
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_APPROVALS);
  const previousTerminalSessionsById = new Map(
    previousTerminalSessions.map(session => [session.id, session]),
  );
  const terminalSessions = snapshot.terminalSessions
    .filter(session => knownDeviceIds.has(session.device_id))
    .map(session =>
      mergeTerminalSessionSnapshot(
        previousTerminalSessionsById.get(session.session_id),
        serverTerminalSessionToClient(session),
      ),
    );
  const terminalCommandHistory: Record<string, TerminalCommandHistoryItem[]> = {
    ...previousTerminalCommandHistory,
  };
  for (const session of snapshot.terminalSessions) {
    if (!knownDeviceIds.has(session.device_id)) continue;
    const recent = session.recent_commands ?? [];
    if (!recent.length) continue;
    const items: TerminalCommandHistoryItem[] = recent
      .filter(cmd => (cmd.command ?? '').trim())
      .map(cmd => ({
        id: cmd.id,
        terminalSessionId: session.session_id,
        deviceId: session.device_id,
        command: cmd.command,
        timestamp: cmd.timestamp,
        exitCode: cmd.exit_code ?? null,
        createdAt: cmd.created_at,
      }));
    const key = `session:${session.session_id}`;
    terminalCommandHistory[key] = mergeCommandHistory(items, previousTerminalCommandHistory[key] ?? []);
  }
  const knownSessionIds = new Set(vibeRuns.map(session => session.id));
  const previewLinks = snapshot.previewLinks
    .filter(preview => knownSessionIds.has(preview.sessionId))
    .map(serverPreviewToClient);
  const realtimeEvents = dedupeUnifiedEvents(
    snapshot.realtimeEvents
      .map(realtimeEventToUnifiedEvent)
      .filter(item => !item.deviceId || knownDeviceIds.has(item.deviceId)),
  ).slice(0, MAX_EVENTS);
  const notifications = snapshot.notifications
    .map(serverNotificationToClient)
    .filter(item => !item.deviceId || knownDeviceIds.has(item.deviceId))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_NOTIFICATIONS);
  const warningEvents = snapshot.warnings.map(detail =>
    event('command.completed', 'Partial platform sync', detail, 'failed'),
  );

  return {
    devices,
    projects,
    scanResults,
    vibeRuns: mergedVibeRuns,
    terminalSessions,
    terminalCommandHistory,
    approvals,
    previewLinks,
    notifications,
    unreadNotificationsTotal: snapshot.unreadNotificationsTotal ?? 0,
    events: [...warningEvents, ...realtimeEvents].slice(0, MAX_EVENTS),
  };
}

export const emptySessionData = () => ({
  devices: [],
  projects: [],
  vibeRuns: [],
  aiSessionHistory: [],
  aiSessionHistoryPage: {
    initialized: false,
    loading: false,
    hasMore: true,
  },
  sessionCommands: {},
  previewLinks: [],
  terminalSessions: [],
  pendingChallenges: [],
  terminalCommandHistory: {},
  scanResults: [],
  approvals: [],
  approvalHistory: [],
  approvalHistoryPage: {
    initialized: false,
    loading: false,
    hasMore: true,
  },
  notifications: [],
  unreadNotificationsTotal: 0,
  notificationHistory: [],
  notificationHistoryPage: {
    initialized: false,
    loading: false,
    hasMore: true,
  },
  events: [],
  eventHistory: [],
  eventHistoryPages: {},
  projectFiles: [],
  lastSyncedAt: null,
  stale: false,
});

/**
 * What `refreshFromServer` should do, given the realtime state + whether a
 * session token is still held. Pure so the recovery decision is unit-testable.
 *
 *   'refresh'      — in server mode: pull a fresh snapshot (the normal path).
 *   'reinitialize' — NOT in server mode but a token is still held: the previous
 *                    `initializeFromServer` failed (or never ran). Re-run the
 *                    full init (snapshot + WS) instead of no-op'ing, so a
 *                    single transient boot failure doesn't strand the app
 *                    "logged in (Me) but no data" until the user kills the app
 *                    or re-logs in. Foreground / pull-to-refresh now self-heal.
 *                    THE FIX for the reinstall→empty-data stuck state.
 *   'noop'         — not in server mode and no token: nothing to refresh
 *                    (logged out; the boot effect renders Login).
 */
export type RefreshAction = 'refresh' | 'reinitialize' | 'noop';

export function resolveRefreshAction(
  serverMode: boolean,
  hasToken: boolean,
): RefreshAction {
  if (!serverMode) return hasToken ? 'reinitialize' : 'noop';
  return 'refresh';
}

/**
 * True 当实时层**确曾尝试连接并失败、且从未成功同步过**。此时列表页应显「连接失败·重试」
 * 卡片,替代含糊的空白/空态。三者全满足:
 *  - `!serverMode`:当前未连上。
 *  - `lastSyncedAt === null`:从未成功同步(首次 init 失败,而非曾连上后的暂态断线——
 *    那算 stale,不显失败卡)。
 *  - `lastConnectError !== null`:**确有尝试并失败**。这一条用来排除「冷启动加载中、init
 *    尚未开始」的窗口——否则每次正常开 app 都会闪一下「连接失败」假告警。
 *
 * 用户报告的「home/vibe/device 全空白、下拉无反应」根因就是停在这个状态。
 */
export function isConnectionFailed(
  serverMode: boolean,
  lastSyncedAt: number | null,
  lastConnectError: string | null,
): boolean {
  return !serverMode && lastSyncedAt === null && lastConnectError !== null;
}
