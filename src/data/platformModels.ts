import type { ApprovalScheme } from '../api/devices';
import type { ProjectProviderModelConfig } from '../api/modelConfig';

export interface Project {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'error';
  branch: string;
  lastDeploy?: string;
  language: string;
  description: string;
  path: string;
  deviceId?: string;
  packageManager?: string;
  isGitRepo?: boolean;
  /** Tracked file count for the project (git ls-files), reported by the agent. */
  fileCount?: number;
  /** Current git working-tree change count, reported by the agent ~1/min. */
  gitChangedCount?: number;
  detectedPorts: number[];
  sourceTools?: string[];
  /** Effective `/`-command surface for this project (project > user > builtin). */
  availableCommands?: AgentCommandInfo[];
  /** Active approval-policy scheme (project-scoped; defaults to balanced). */
  approvalScheme?: ApprovalScheme;
  claudeSkillTrusted?: boolean;
  /** Project-scoped model/effort selections keyed by provider tab. */
  modelConfig?: ProjectProviderModelConfig;
  /** Legacy single-provider override from older server payloads. */
  provider?: 'codex' | 'claude_code' | 'opencode';
  model?: string;
  effort?: string;
}

export interface TerminalNode {
  id: string;
  name: string;
  host: string;
  status: 'active' | 'idle' | 'error';
  latency: number;
  uptime: string;
  cpuLoad: number;
  memLoad: number;
  group: string;
  processes: ProcessInfo[];
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  status: string;
}

export interface RunningInstance {
  id: string;
  name: string;
  project: string;
  progress: number;
  status: 'building' | 'deploying' | 'running' | 'stopping';
  startedAt: string;
  cluster: string;
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export type DeviceStatus = 'online' | 'offline' | 'warning';

export interface Device {
  id: string;
  name: string;
  status: DeviceStatus;
  location: string;
  os: string;
  host: string;
  cpuLoad: number;
  memLoad: number;
  battery?: number;
  authorizedDirectories: string[];
  activePorts: number[];
  projectIds: string[];
  activeSessionIds: string[];
  lastSeen: string;
  uniqueCode?: string;
  agentVersion?: string;
  remoteTerminalEnabled: boolean;
  aiControlEnabled: boolean;
  capabilities: string[];
  /** Tools advertised by the agent, including detected AI coding tools (claude-code/codex). */
  tools: AgentToolInfo[];
  /** Workspace roots the agent discovered (e.g. claude-code/codex session dirs). */
  history: WorkspaceHistoryEntry[];
  createdAt?: string;
}

export type AgentCommandScope = 'builtin' | 'user' | 'project' | 'plugin';
export type AgentCommandKind = 'builtin' | 'command' | 'skill' | 'mcp_prompt';

/**
 * A discoverable `/`-style command for an AI coding tool (e.g. a Claude Code
 * slash command). `name` is the bare command without the leading slash — the UI
 * prepends `/`. The desktop agent is the source of truth: it introspects
 * on-disk command files (`.claude/commands/*.md`) for claude-code and ships a
 * curated built-in baseline for commands the CLIs don't enumerate.
 */
// How a `/`-command executes in a remote (mobile-driven) session. Mirrors the
// server's AgentCommandRemote. See server/src/types.ts for the rationale.
//   'prompt'      — prompt template (custom/user command); sent as a message.
//   'local'       — interactive REPL builtin (/compact /clear...); the agent
//                   runs it against its CLI session, replies status + ai.done.
//   'unsupported' — purely-local builtin (/memory /init...); agent rejects.
export type AgentCommandRemote = 'prompt' | 'local' | 'unsupported';

export interface AgentCommandInfo {
  name: string;
  description?: string;
  argHint?: string;
  scope?: AgentCommandScope;
  kind?: AgentCommandKind;
  origin?: 'project' | 'user' | 'plugin';
  source?: string;
  userInvocable?: boolean;
  modelInvocable?: boolean;
  /** Remote-execution category; absent ≈ 'prompt'. Drives the typeahead badge. */
  remote?: AgentCommandRemote;
}

export interface AgentToolInfo {
  id: string;
  name?: string;
  command?: string;
  path?: string;
  available?: boolean;
  description?: string;
  /** Slash commands the agent discovered for this tool, if any. */
  commands?: AgentCommandInfo[];
}

export interface WorkspaceHistoryEntry {
  tool: string;
  path: string;
  exists?: boolean;
  file_count?: number;
  total_size?: number;
  updated_at?: string;
}

export type VibeStatus =
  | 'idle'
  | 'running'
  | 'waiting_user'
  | 'waiting_approval'
  | 'testing'
  | 'preview_ready'
  | 'failed'
  | 'completed'
  | 'paused';

export type GoalState =
  | 'planning'
  | 'planning_failed'
  | 'awaiting_approval'
  | 'active'
  | 'approval_pending'
  | 'pause_requested'
  | 'verifying'
  | 'paused'
  | 'blocked'
  | 'budget_limited'
  | 'cancel_requested'
  | 'abandoned'
  | 'cancelled'
  | 'completed';

export interface GoalTaskSummary {
  id: string;
  title: string;
  status?: string;
  isCurrent?: boolean;
  failureAttempt?: number;
}

export interface GoalCheckSummary {
  id: string;
  title: string;
  status?: string;
  detail?: string;
}

export interface GoalRevisionSummary {
  id: string;
  number: number;
  objective: string;
  constraints: string[];
  nonGoals: string[];
  budget?: {
    maxAttemptsPerTask?: number;
    maxTurns?: number;
    deadlineAt?: string;
    commandTimeoutMs?: number;
    providerUsageLimit?: number;
  };
  manifestDigest?: string;
  createdAt?: string;
}

/** Bounded, server-authoritative Goal summary embedded in an AI session snapshot. */
export interface GoalSummary {
  goalId: string;
  objective?: string;
  state: GoalState;
  stateVersion?: number;
  completedTasks?: number;
  totalTasks?: number;
  currentTask?: string;
  currentRunHealth?: string;
  attention?: string;
  planningErrorCode?: string;
  planningErrorDetail?: string;
  /** Live in-flight planning signal (only meaningful while state === 'planning'). */
  planningPhase?: string;
  planningAttempt?: number;
  planningThinkingChars?: number;
  planningThinkingPreview?: string;
  planningUpdatedAt?: string;
  /**
   * Server-authoritative primary CTA for the Goal. Known literals get autocomplete
   * and exhaustiveness support; the `string & {}` tail keeps the field forward-
   * compatible so unrecognized future server values still round-trip cleanly.
   */
  primaryActionKind?: 'approve_plan' | 'continue' | 'retry' | (string & {});
  primaryActionLabel?: string;
  /** True when the run is making no forward progress and a nudge is meaningful. */
  stalled?: boolean;
  /** True when the server exposes a user-driven recovery action for this Goal. */
  recoverable?: boolean;
  provider?: string;
  model?: string;
  effort?: string;
  driver?: string;
  workspaceRelation?: 'exact' | 'advanced' | 'unavailable';
  updatedAt?: string;
  revision?: GoalRevisionSummary;
  tasks?: GoalTaskSummary[];
  checks?: GoalCheckSummary[];
}

export interface VibeCodingRun {
  id: string;
  title: string;
  deviceId: string;
  projectId: string;
  directory: string;
  status: VibeStatus;
  /** Server-owned session purpose. Goal UI is rendered only for `goal`. */
  purpose?: 'chat' | 'goal';
  /** Optional Goal summary; absence means the phone must show syncing, not 0/0. */
  goalSummary?: GoalSummary;
  /**
   * Server-authoritative display phase ('running'|'waiting_approval'|
   * 'completed'|'failed'). Preferred over the phone's local silence-based
   * deriveSessionPhase for the top-level status — completion isn't guessed from
   * a lack of ai.delta. Undefined for older servers; callers fall back.
   */
  phase?: 'running' | 'waiting_approval' | 'completed' | 'failed';
  activeRunId?: string;
  latestRunId?: string;
  runState?:
    | 'queued'
    | 'running'
    | 'waiting_approval'
    | 'cancelling'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'timed_out';
  /** Monotonic server-owned state version; wall-clock timestamps never replace it. */
  runStateVersion?: number;
  /** Client-only optimistic new-run guard; never serialized to Server. */
  optimisticRunPending?: boolean;
  optimisticRunBaseVersion?: number;
  objective: string;
  model: string;
  projectBudget?: AgentBudgetInfo;
  /** Reasoning effort (provider-specific); undefined = no override. */
  effort?: string;
  /** Monotonic server version for session-level model/effort edits. */
  modelConfigVersion?: number;
  /** Immutable profile captured for the active or most recently issued Run. */
  activeExecutionProfile?: {
    version: number;
    provider?: string;
    model?: string;
    effort?: string;
    capturedAt: string;
  };
  /**
   * Authoritative AI provider, derived from the server session's
   * `provider`/`tool` (see normalizeProvider). Drives provider-aware effort
   * presets and codex-vs-claude rendering. Undefined only for legacy snapshots
   * that lack the field — callers apply a sensible default.
   */
  provider?: 'codex' | 'claude_code' | 'opencode';
  /**
   * Server-resolved effective model config (the concrete provider/model/effort
   * the agent runs with + each field's provenance). Surfaced read-only in the
   * session settings as "当前有效". Undefined when the server snapshot didn't
   * attach it. Mirrors `EffectiveModelConfig` (api/modelConfig.ts).
   */
  effectiveModelConfig?: {
    provider?: string | null;
    model?: string | null;
    effort?: string | null;
    source?: {
      provider?: string;
      model?: string;
      effort?: string;
    };
  };
  risk: 'low' | 'medium' | 'high';
  currentStep: string;
  branch: string;
  /** Display-friendly relative label for last activity, e.g. "刚刚" / "5 分钟前". */
  updatedAt: string;
  /**
   * Authoritative epoch-millis timestamp of the last activity on this session.
   * Drives sorting/recency so list ordering is deterministic regardless of how
   * `updatedAt` (the display string) is formatted. Updated on every AI delta,
   * message, lifecycle change, and server snapshot.
   */
  lastActivityMs: number;
  previewId?: string;
  transcriptCount?: number;
  transcriptPage?: AgentTranscriptPage;
  eventCount?: number;
  /** Distinct files the agent wrote/edited during the current/most-recent run. */
  filesTouchedCount?: number;
  /** git working-tree change count for the project dir during the current/most-recent run. */
  gitChangedCount?: number;
  /** Live retry indicator (gateway 5xx being retried). Transient on the server. */
  retryActive?: boolean;
  retryAttempt?: number;
  retryMax?: number;
  retryErrorStatus?: number;
  retryErrorType?: string;
  /** Structured cause of the most recent terminal failure. Persisted on server. */
  lastErrorStatus?: number;
  lastErrorType?: string;
  lastRetryAttempt?: number;
  lastRetryMax?: number;
  lastMessage?: AgentMessage;
  /**
   * Most recent user-role message (the latest thing the user asked), used by the
   * session card's long-press menu "最新提问" preview. Derived at mapping time
   * from the transcript when present, else from `last_message` when it's a user
   * message; undefined when neither is available (UI falls back to `objective`).
   * Survives snapshot merges like `lastMessage`.
   */
  lastUserMessage?: AgentMessage;
  /**
   * The CLI session id (Claude's uuid / codex id) this run is bound to — what
   * you'd pass to `claude --resume <id>`. Present for agent-discovered (imported)
   * sessions; for phone-created Claude sessions it's bound once Phase 2 persists
   * it server-side. Shown in the long-press menu with a copy button. Undefined
   * when not yet bound.
   */
  sourceSessionId?: string;
  detailLoadedAt?: string;
  /**
   * Server `detail_refresh.status` from the last single-session fetch — lets the
   * chat screen distinguish "genuinely no messages" from "agent offline /
   * fetch failed, history unreachable". Undefined for list-snapshot sessions
   * (the summary payload omits it). See ServerAiSession.detail_refresh.
   */
  detailRefreshStatus?: string;
  suggestions: string[];
  transcript: AgentMessage[];
  events: AgentEvent[];
  /**
   * Structured activity events (command / file_change / thinking / usage / task)
   * ingested from the backend's slim `structured_events` envelopes. These power
   * the structured activity timeline in the chat screen. Each event carries a
   * stable `eventId`/`messageId` for dedupe + on-demand heavy-detail fetch.
   */
  structuredEvents: StructuredActivityEvent[];
  /**
   * On-demand cache for the heavy detail (command output / diff / thinking
   * text) of a structured event, keyed by `eventId`. Populated lazily by the
   * chat screen via `fetchStructuredEventDetail`; undefined on a fresh
   * snapshot (no detail fetched yet). Bounded FIFO by EVENT_DETAIL_CACHE_MAX.
   */
  eventDetailCache?: Record<string, { text?: string; truncated?: boolean }>;
  /**
   * Last time the user viewed this session's chat screen (ms epoch, in-memory
   * only — never persisted, never carried in a server snapshot). Drives idle
   * demotion: sessions not viewed within IDLE_DEMOTE_MS (and not active, not
   * currently viewed) get their transcript/structuredEvents/detailCache
   * cleared to bound resident memory. Set by the session screen on focus.
   */
  lastViewedAt?: number;
}

/**
 * Discriminated union of the 5 structured activity event kinds the backend
 * pushes for AI sessions. Slim envelopes are mapped to this shape (camelCase,
 * type-discriminated) by {@link envelopeToActivity}; the heavy text/detail
 * payload is fetched on demand via `fetchStructuredEventDetail`.
 */
export type StructuredActivityEvent =
  | {
      kind: 'command';
      eventId: string;
      messageId: string;
      itemId: string;
      status: string;
      command?: string;
      cwd?: string;
      exitCode?: number | null;
    }
  | {
      kind: 'file_change';
      eventId: string;
      messageId: string;
      itemId: string;
      path?: string;
      /**
       * Backend file-change category (e.g. "create" | "edit" | "delete").
       * Renamed from the wire's `kind` to avoid colliding with the
       * discriminant above (two `kind` keys can't coexist in one object type).
       */
      changeKind?: string;
      added?: number;
      removed?: number;
      renamedFrom?: string;
    }
  | {
      kind: 'thinking';
      eventId: string;
      messageId: string;
      active: boolean;
      chars: number;
    }
  | {
      kind: 'usage';
      eventId: string;
      messageId?: string;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      model?: string;
    }
  | {
      kind: 'task';
      eventId: string;
      messageId: string;
      tasks: { subject: string; status: string; active_form?: string }[];
    };

/**
 * Map a backend slim envelope (snake_case `Record<string, unknown>`) to a phone
 * {@link StructuredActivityEvent} (camelCase, type-discriminated). Returns
 * `null` for unknown / missing envelope types so callers can `.filter` them out.
 *
 * Backend envelope field reference (by `env.type`):
 *   ai.command:     event_id, session_id, message_id, item_id, status, command?, cwd?, exit_code?
 *   ai.file_change: event_id, session_id, message_id, item_id, path?, kind?(→changeKind), added?, removed?, renamed_from?
 *   ai.thinking:    event_id, session_id, message_id, active, chars
 *   ai.usage:       event_id, session_id, message_id?, input_tokens?, output_tokens?, cache_read_tokens?, model?
 *   ai.task:        event_id, session_id, message_id, tasks[{subject,status,active_form}]
 */
export function envelopeToActivity(
  env: Record<string, unknown>,
): StructuredActivityEvent | null {
  const type = String(env.type ?? '');
  const eventId = String(env.event_id ?? '');
  const messageId = String(env.message_id ?? '');
  const itemId = String(env.item_id ?? '');
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  switch (type) {
    case 'ai.command':
      return {
        kind: 'command',
        eventId,
        messageId,
        itemId,
        status: String(env.status ?? 'started'),
        command: str(env.command),
        cwd: str(env.cwd),
        exitCode:
          typeof env.exit_code === 'number'
            ? env.exit_code
            : env.exit_code == null
              ? undefined
              : null,
      };
    case 'ai.file_change':
      return {
        kind: 'file_change',
        eventId,
        messageId,
        itemId,
        path: str(env.path),
        changeKind: str(env.kind),
        added: num(env.added),
        removed: num(env.removed),
        renamedFrom: str(env.renamed_from),
      };
    case 'ai.thinking':
      return {
        kind: 'thinking',
        eventId,
        messageId,
        active: env.active !== false,
        chars: typeof env.chars === 'number' ? env.chars : 0,
      };
    case 'ai.usage':
      return {
        kind: 'usage',
        eventId,
        messageId: str(env.message_id),
        inputTokens: num(env.input_tokens),
        outputTokens: num(env.output_tokens),
        cacheReadTokens: num(env.cache_read_tokens),
        model: str(env.model),
      };
    case 'ai.task':
      return {
        kind: 'task',
        eventId,
        messageId,
        tasks: Array.isArray(env.tasks)
          ? (env.tasks as {
              subject: string;
              status: string;
              active_form?: string;
            }[])
          : [],
      };
    default:
      return null;
  }
}

export interface AgentBudgetInfo {
  source: 'codex';
  currencySymbol: string;
  used: number;
  limit: number;
  updatedAt: string;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  mode?: 'voice' | 'text' | 'action';
  content: string;
  timestamp: string;
  pending?: boolean;
  index?: number;
  /**
   * Client-only: this user message FAILED to send (the HTTP dispatch threw —
   * e.g. agent offline). Unlike `pending` (an in-flight optimistic bubble that
   * the server will confirm), a failed message never reached the server, so it
   * has no server id and must survive server-snapshot merges as a client-only
   * retryable bubble. Surfaced in the UI with a retry / dismiss affordance.
   */
  failed?: boolean;
  /**
   * Server-owned Goal this message belongs to (set by the backend for messages
   * produced during a Goal-driven run). Matches `goal_id` on the wire. Used by
   * the phone to fold goal-planning chatter once the Goal is closed. Absent for
   * ordinary chat sessions and older servers.
   */
  goalId?: string;
  /**
   * ISO timestamp the server marked this message hidden (e.g. folded away once
   * the owning Goal is abandoned/completed). Matches `hidden_at` on the wire.
   * Absent means the message is still visible.
   */
  hiddenAt?: string;
}

export interface AgentTranscriptPage {
  limit: number;
  count: number;
  totalCount?: number;
  hasMore: boolean;
  nextBeforeCursor?: string;
  nextBeforeMessageId?: string;
  cacheStatus?: string;
  fetchedAt?: string;
}

export interface AgentEvent {
  id: string;
  type: 'command' | 'file' | 'test' | 'preview' | 'approval' | 'status';
  title: string;
  detail: string;
  status: 'done' | 'running' | 'waiting' | 'failed';
  timestamp: string;
}

export interface PreviewLink {
  id: string;
  sessionId: string;
  port: number;
  shortUrl: string;
  targetUrl: string;
  expiresIn: string;
  access: 'private' | 'team' | 'public';
}
