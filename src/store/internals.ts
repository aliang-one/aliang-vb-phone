import type {
  AgentEvent,
  Device,
  PreviewLink,
  Project,
  VibeCodingRun,
  VibeStatus,
} from '../data/platformModels';
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

// Render a stable, human-friendly label for a session's last-activity timestamp.
// Used for the `updatedAt` display string; sorting uses `lastActivityMs` instead.
export const formatActivityLabel = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return '未知';
  const diffSec = Math.max(0, (Date.now() - ms) / 1000);
  if (diffSec < 45) return '刚刚';
  if (diffSec < 90) return '1 分钟前';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
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
export const MAX_RUN_EVENTS = 200; // per AI session lifecycle events
export const MAX_SESSION_DETAIL = 8; // LRU: full transcripts held for at most this many sessions
export const MAX_VIBE_RUNS = 50; // Maximum number of AI sessions kept in memory
export const MAX_TRANSCRIPT_LENGTH = 500; // Maximum messages per session transcript (hot window)
export const MAX_EVENTS = 120; // Global event log limit
export const MAX_NOTIFICATIONS = 120; // Notification list limit
export const MAX_APPROVALS = 50; // Pending/resolved approvals limit
export const tail = <T>(list: T[], limit: number): T[] =>
  list.length <= limit ? list : list.slice(list.length - limit);

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
  const detailed = runs.filter(run => run.detailLoadedAt);
  if (detailed.length <= MAX_SESSION_DETAIL) return runs;
  const overflow = detailed.length - MAX_SESSION_DETAIL;
  const toEvict = new Set(
    detailed
      .filter(run => !ACTIVE_RUN_STATUS.has(run.status))
      .sort((a, b) => (a.lastActivityMs ?? 0) - (b.lastActivityMs ?? 0))
      .slice(0, overflow)
      .map(run => run.id),
  );
  if (!toEvict.size) return runs;
  return runs.map(run =>
    toEvict.has(run.id)
      ? { ...run, transcript: [], events: [], detailLoadedAt: undefined }
      : run,
  );
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
    tools: sd.tools.map(tool => ({
      id: tool.id,
      name: tool.name,
      command: tool.command,
      path: tool.path,
      available: tool.available,
      description: tool.description,
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
    detectedPorts: sp.detected_ports ?? [],
    sourceTools: sp.source_tools ?? [],
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
  const provider = (session.provider ?? session.tool ?? '').toLowerCase();
  if (provider === 'codex') return session.model ?? 'GPT-5 Codex';
  if (provider === 'claude' || provider === 'claudecode')
    return session.model ?? 'Claude Code';
  return session.model ?? session.mode;
}

export function serverAiSessionToVibeRun(
  session: PlatformAiSessionSnapshot,
  _devices: Device[],
  projects: Project[],
): VibeCodingRun {
  const project =
    projects.find(
      p => p.path === session.project_path && p.deviceId === session.device_id,
    ) ??
    projects.find(p => p.path === session.project_path) ??
    projects.find(p => p.id === session.project_path);
  const model = aiSessionModelLabel(session);
  const transcript = (session.transcript ?? []).map(t => ({
    id: t.id,
    role: t.role,
    mode: t.mode as 'voice' | 'text' | 'action' | undefined,
    content: t.content,
    timestamp: t.timestamp,
  }));
  const events = (session.events ?? []).map(e => ({
    id: e.id,
    type: e.type as AgentEvent['type'],
    title: e.title,
    detail: e.detail,
    status: e.status as AgentEvent['status'],
    timestamp: e.timestamp,
  }));
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
    objective: session.objective ?? '',
    model,
    timeLimitMinutes: 60,
    elapsedMinutes: 0,
    risk: session.risk ?? 'medium',
    currentStep: session.current_step ?? '',
    branch: session.branch ?? `agent/${session.session_id}`,
    lastActivityMs: Date.parse(session.last_active_at ?? '') || activityNowMs(),
    updatedAt: formatActivityLabel(
      Date.parse(session.last_active_at ?? '') || activityNowMs(),
    ),
    transcriptCount: session.transcript_count ?? transcript.length,
    eventCount: session.event_count ?? events.length,
    lastMessage,
    detailLoadedAt:
      session.transcript || session.events ? nowTime() : undefined,
    suggestions: ['Ask for plan', 'Open terminal', 'Pause session'],
    transcript,
    events,
  };
}

export const hasLoadedSessionDetail = (run: VibeCodingRun) =>
  Boolean(run.detailLoadedAt);

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

export function mergeAgentEvents(
  existing: VibeCodingRun['events'],
  incoming: VibeCodingRun['events'],
): VibeCodingRun['events'] {
  if (!incoming.length) return existing;
  const incomingIds = new Set(incoming.map(item => item.id));
  return tail(
    [...incoming, ...existing.filter(item => !incomingIds.has(item.id))],
    MAX_RUN_EVENTS,
  );
}

export function mergeVibeRunSnapshot(
  existing: VibeCodingRun | undefined,
  incoming: VibeCodingRun,
): VibeCodingRun {
  if (!existing) return incoming;
  const incomingHasDetail = hasLoadedSessionDetail(incoming);
  // Never let a (possibly slightly stale) server snapshot demote a session that
  // is actively streaming locally — keep the most recent activity timestamp.
  const lastActivityMs = Math.max(
    existing.lastActivityMs ?? 0,
    incoming.lastActivityMs ?? 0,
  );
  const transcript = incomingHasDetail
    ? mergeAgentMessages(existing.transcript, incoming.transcript)
    : existing.transcript;
  const events = incomingHasDetail
    ? mergeAgentEvents(existing.events, incoming.events)
    : existing.events;
  return {
    ...existing,
    ...incoming,
    lastActivityMs,
    updatedAt: formatActivityLabel(lastActivityMs),
    transcript,
    events,
    detailLoadedAt: incoming.detailLoadedAt ?? existing.detailLoadedAt,
    lastMessage:
      (incomingHasDetail
        ? transcript[transcript.length - 1] ?? incoming.lastMessage
        : incoming.lastMessage) ??
      existing.lastMessage ??
      transcript[transcript.length - 1],
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
    messageFingerprint(existing.lastMessage) !==
      messageFingerprint(incoming.lastMessage)
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
    files: sa.files,
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
  return {
    id: message.id,
    type: realtimeMessageTypeToEventType(message.message_type, payload),
    title: realtimeMessageTitle(message.message_type, payload),
    detail: realtimeMessageDetail(message, payload),
    status: realtimeMessageStatus(message.message_type),
    deviceId: message.device_id,
    sessionId: message.session_id,
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
    status: 'clean',
    language: file.language ?? (isFolder ? 'Folder' : 'File'),
    size: isFolder ? '-' : formatBytes(file.size_bytes),
    sizeBytes: file.size_bytes,
    lastTouched: file.modified_at ?? 'unknown',
    modifiedAt: file.modified_at,
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

export const attachProjectIds = (
  devices: Device[],
  projects: Project[],
): Device[] =>
  devices.map(device => ({
    ...device,
    projectIds: mergeIds(
      device.projectIds,
      projects
        .filter(project => projectBelongsToDevice(project, device))
        .map(project => project.id),
    ),
  }));

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

  return devices.map(device => ({
    ...device,
    activeSessionIds: sessionsByDevice.get(device.id) ?? [],
  }));
};

export const attachDeviceRelations = (
  devices: Device[],
  projects: Project[],
  vibeRuns: VibeCodingRun[],
): Device[] =>
  attachActiveSessionIds(attachProjectIds(devices, projects), vibeRuns);

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
      return { ...merged, transcript: trimTranscript(merged.transcript) };
    }),
  );
  const devices = attachDeviceRelations(baseDevices, projects, mergedVibeRuns);
  const scanResults = projects.map(projectToScanResult);
  const approvals = snapshot.approvals
    .filter(approval => knownDeviceIds.has(approval.device_id))
    .map(serverApprovalToClient)
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
    events: [...warningEvents, ...realtimeEvents].slice(0, MAX_EVENTS),
  };
}

export const emptySessionData = () => ({
  devices: [],
  projects: [],
  vibeRuns: [],
  previewLinks: [],
  terminalSessions: [],
  terminalCommandHistory: {},
  scanResults: [],
  approvals: [],
  notifications: [],
  events: [],
  projectFiles: [],
  lastSyncedAt: null,
  stale: false,
});
