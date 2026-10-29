import type { ApprovalScheme } from '../api/devices';
import type { ProjectProviderModelConfig } from '../api/modelConfig';
import type { AiAttachmentMeta, AttachmentCapability } from '../api/attachments';
import type { EffortProvider } from '../utils/modelIntensity';

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
  provider?: EffortProvider;
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
  /** Whether the server-side tunnel is configured and port forwarding is available for this device. */
  tunnelAvailable?: boolean;
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
  /** CLI version reported by the agent (e.g. claude 2.1.156), if known. */
  version?: string;
  /** Reasoning-effort levels this CLI version accepts (device capability). */
  efforts?: string[];
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

/**
 * Typed single-session detail-loading state. Replaces the legacy
 * `detailLoadedAt` timestamp on `VibeCodingRun`. `undefined` on a run means
 * "never detail-fetched" (only list-snapshot metadata is resident). Resolved
 * by the session-detail domain (`resolveDetailState`); see `isAuthoritativeDetail`.
 */
export type DetailState =
  | { kind: 'ready' }
  | { kind: 'empty' }
  | { kind: 'recoverable_empty' }
  | { kind: 'offline' }
  | { kind: 'failed' };

export type GoalState =
  | 'planning'
  | 'planning_failed'
  | 'awaiting_approval'
  | 'active'
  | 'approval_pending'
  | 'pause_requested'
  | 'verifying'
  | 'awaiting_user_acceptance'
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
  key?: string;
  description?: string;
  allowedCommands?: string[];
  dependsOn?: string[];
  requiredCheckIds?: string[];
}

export type GoalCheckType = 'command' | 'file_exists' | 'file_contains';

export interface GoalCheckSummary {
  id: string;
  title: string;
  status?: string;
  detail?: string;
  key?: string;
  type?: GoalCheckType;
  command?: string;
  path?: string;
  contains?: string;
  required?: boolean;
  timeoutMs?: number;
  criterionKey?: string;
}

// Phase 2 criterion subsystem: goal-level acceptance criteria with derived
// status (the evidence matrix). The user edits these at plan approval (codex #1).
export type GoalCriterionVerification = 'auto' | 'manual' | 'unverifiable';
export type GoalCriterionStatus = 'passed' | 'failed' | 'pending' | 'manual' | 'unverifiable';

export interface GoalAcceptanceCriterionSummary {
  key: string;
  statement: string;
  kind: 'functional' | 'regression' | 'integration' | 'device' | 'delivery';
  verification: GoalCriterionVerification;
  required: boolean;
  userAuthored?: boolean;
  mappedCheckKeys: string[];
  status: GoalCriterionStatus;
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
  /** 已消耗的回合预算(服务端 publicGoal.turn_count,2026-10-28 预算审计补充)。 */
  turnCount?: number;
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
  primaryActionKind?: 'approve_plan' | 'continue' | 'retry' | 'accept_completion' | (string & {});
  primaryActionLabel?: string;
  /** True when the run is making no forward progress and a nudge is meaningful. */
  stalled?: boolean;
  /** True when the server exposes a user-driven recovery action for this Goal. */
  recoverable?: boolean;
  /**
   * Redesign Phase 5: non-blocking drift hint from the post-verify evaluator.
   * The phone surfaces a "建议分叉重规划" entry; the DAG keeps flowing.
   */
  branchSuggestion?: { reason: string; pivotTaskKey?: string; magnitude?: 'minor' | 'major'; kind?: 'branch' | 'user_input' };
  /**
   * Redesign Phase 6: an active (open) fork — when present the user can navigate
   * into the child session to explore the re-plan, then merge or abandon. v1
   * left the user stranded after opening a fork (audit #3).
   */
  openFork?: { forkId: string; childSessionId: string; pivotTaskKey?: string; forkReason?: string };
  provider?: string;
  model?: string;
  effort?: string;
  driver?: string;
  workspaceRelation?: 'exact' | 'advanced' | 'unavailable';
  updatedAt?: string;
  revision?: GoalRevisionSummary;
  tasks?: GoalTaskSummary[];
  checks?: GoalCheckSummary[];
  criteria?: GoalAcceptanceCriterionSummary[];
}

/**
 * 一次 AI run 的逐回合诊断快照（agentcore 内核产出，服务端归一化为 camelCase
 * 后随 ai.session.updated 快照携带；终态含终止真因并已持久化）。键与服务端
 * AiRunDiagnostics 一致；缺键按缺省渲染「—」。
 */
export interface VibeRunDiagnostics {
  /** 已开始的回合数（从 1 计）。 */
  turns: number;
  /** 最近一次上游报告的本轮输入 token 数（含缓存），压缩后为估算值。 */
  contextTokens: number;
  /** 本 run 的有效上下文窗口。 */
  contextWindow: number;
  /** 三个无进展守卫的当前连击计数（重复工具/连续工具错误/截断重试）。 */
  dupStreak?: number;
  errStreak?: number;
  truncStreak?: number;
  /** 最近一个回合的上游停止原因。 */
  stopReason?: string;
  /** run 已耗时（毫秒）。 */
  elapsedMs?: number;
  /** true = 终态快照。 */
  terminal?: boolean;
  /** 终止真因（仅终态快照非空）。 */
  reason?: string;
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
  /**
   * 本会话最近一次运行的执行器（server 从 ai.run.started 派生）。
   * 'tui' = 注入终端里已在跑的 Claude Code TUI：只能收文本，没有 steer
   * 通道，运行中不能插话；'spawn' = agent 自己 spawn 的进程，支持图片与插话。
   * undefined = 老 server 或尚未开始过运行。
   */
  executor?: 'tui' | 'spawn';
  /** Client-only optimistic new-run guard; never serialized to Server. */
  optimisticRunPending?: boolean;
  optimisticRunBaseVersion?: number;
  objective: string;
  model: string;
  projectBudget?: AgentBudgetInfo;
  /** Reasoning effort (provider-specific); undefined = no override. */
  effort?: string;
  /**
   * 会话级上下文窗口（tokens）。undefined = 未设置（服务端回落用户默认 →
   * 200k）。可随时在输入框 Tools 里改，下一轮生效；展示用的「生效值」看
   * `effectiveModelConfig.contextWindow`（含来源）。
   */
  contextWindow?: number;
  /** Monotonic server version for session-level model/effort edits. */
  modelConfigVersion?: number;
  /** Immutable profile captured for the active or most recently issued Run. */
  activeExecutionProfile?: {
    version: number;
    provider?: string;
    model?: string;
    effort?: string;
    contextWindow?: number;
    capturedAt: string;
  };
  /**
   * Authoritative AI provider, derived from the server session's
   * `provider`/`tool` (see normalizeProvider). Drives provider-aware effort
   * presets and codex-vs-claude rendering. Undefined only for legacy snapshots
   * that lack the field — callers apply a sensible default.
   */
  provider?: EffortProvider;
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
    /** 生效的上下文窗口（camelCase，服务端原样序列化，恒有值）。 */
    contextWindow?: number | null;
    source?: {
      provider?: string;
      model?: string;
      effort?: string;
      context?: string;
    };
  };
  /**
   * 素材上传能力位（COS 是否可用 + 上限）。只有单会话详情 GET 会带；列表
   * 快照省略。消费方用 `=== true` 判断可用，`undefined` 视为「未知」。
   */
  attachmentsCapability?: AttachmentCapability;
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
  /**
   * 只增不减的守卫基线(历史最大已见活动值)。2026-10-15 事故评审:双轨合并
   * 允许 lastActivityMs 被更旧但合法的服务端快照下修,若 staleDemotion/
   * staleReactivation 守卫直接读被下修后的值,一份迟到的陈旧 running 快照
   * 可击穿反向守卫让已结算会话闪回"进行中"。守卫读这个单调基线,展示值
   * 允许下修。
   */
  activityGuardMs?: number;
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
  /**
   * 逐回合诊断快照（agentcore 通道经 ai.session.updated 快照携带；终态含终止
   * 真因，服务端已持久化）。诊断面板实时与重开回放共用。undefined = 旧 agent
   * 或非 agentcore 通道，面板降级为「无诊断数据」。
   */
  diagnostics?: VibeRunDiagnostics;
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
  /**
   * 会话最近一次对话的发起通道: 'phone' = 手机发起/手机续写, 'tui' = 电脑
   * 终端(TUI)发起/终端侧续写, 'dashboard' = 本机 dashboard 网页发起(跨端统一
   * 阶段 2/3 起下发), 'managed' = 已绑定外部清单会话(手机不渲染来源角标)。
   * 自 2026-10-18 起 server 取「最新明确写入」(手机派发盖章 + 扫盘 wire origin
   * 映射都会翻转落库值), 不再是诞生地——卡片来源角标据此跟随最近通道。需要
   * 「是否导入会话」这一诞生属性时, 用会话 id 的 ai_import_ 前缀判断(见
   * VibeCodingSessionScreen TUI 共用横幅), 不要用本字段。由
   * serverAiSessionToVibeRun 从 wire origin 映射, 老 server 无该字段时按
   * ai_import_ 前缀兜底, 因此模型上该字段总被打满。
   */
  origin?: 'phone' | 'tui' | 'dashboard' | 'managed';
  /**
   * Typed detail-loading state for this session — the canonical replacement
   * for the legacy `detailLoadedAt` timestamp. `undefined` = never fetched
   * (the run only has list-snapshot metadata). Resolved by the session-detail
   * domain (`resolveDetailState`) on each single-session fetch; readers ask
   * `isAuthoritativeDetail` instead of guessing from a timestamp.
   *
   * Variants:
   *   - `ready`             — transcript content delivered.
   *   - `empty`             — fetched, genuinely no history (`transcriptCount` 0).
   *   - `recoverable_empty` — empty page but server reports known history
   *                           (a cache/agent miss; retryable, NOT "loaded").
   *   - `offline`           — agent offline (`skipped_offline`); history unreachable.
   *   - `failed`            — agent request errored.
   *
   * `ready` / `empty` are "authoritative" (count as detail-loaded for eviction
   * and the chat screen's hasDetail); the rest stay retryable.
   */
  detailState?: DetailState;
  /**
   * Server `detail_refresh.status` from the last single-session fetch — lets the
   * chat screen distinguish "genuinely no messages" from "agent offline /
   * fetch failed, history unreachable". Undefined for list-snapshot sessions
   * (the summary payload omits it). See ServerAiSession.detail_refresh.
   */
  detailRefreshStatus?: string;
  /**
   * 该会话是否完成过**一次真实的详情页加载**(`loadAgentSessionDetail`,任何
   * 结果都算对过账)。2026-10-28 实锤:WS/列表快照喂的是服务端热窗 transcript
   * 列(截断 + 空 assistant 锚点),不是权威 ai_messages 页——若快照自身就算
   * 「已加载」,挂载自动加载被短路,失败会话在手机上永远"从半截开始"。只有
   * 详情页加载置 true;快照映射不携带该键(merge 的 `...incoming` 不会覆盖),
   * 单调不可逆。
   */
  detailFromPage?: boolean;
  /**
   * 内部标记:当前 transcript 来自 AsyncStorage 缓存水合
   * (hydrateRunTranscriptFromCache)而非服务器权威数据。仅诊断/测试用——
   * 「缓存渲染」与「详情已加载」(detailState/detailFromPage)严格分离,本
   * 标记不参与任何 detail 判定;服务器内容一经 merge 即被清除。
   */
  transcriptSource?: 'cache';
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
    }
  | {
      kind: 'subagent';
      eventId: string;
      serverEventId: string;
      messageId: string;
      itemId: string;
      taskId: string;
      phase: 'started' | 'progress' | 'completed' | 'failed' | 'interrupted';
      toolUseId?: string;
      description?: string;
      subagentType?: string;
      spawnDepth?: number;
      taskType?: string;
      isBackgrounded?: boolean;
      currentStep?: string;
      lastTool?: string;
      toolUses?: number;
      totalTokens?: number;
      durationMs?: number;
      summary?: string;
      outputFile?: string;
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
        kind: 'command', eventId, messageId, itemId,
        status: String(env.status ?? 'started'), command: str(env.command), cwd: str(env.cwd),
        exitCode: typeof env.exit_code === 'number' ? env.exit_code : env.exit_code == null ? undefined : null,
      };
    case 'ai.file_change':
      return { kind: 'file_change', eventId, messageId, itemId, path: str(env.path), changeKind: str(env.kind), added: num(env.added), removed: num(env.removed), renamedFrom: str(env.renamed_from) };
    case 'ai.thinking':
      return { kind: 'thinking', eventId, messageId, active: env.active !== false, chars: typeof env.chars === 'number' ? env.chars : 0 };
    case 'ai.usage':
      return { kind: 'usage', eventId, messageId: str(env.message_id), inputTokens: num(env.input_tokens), outputTokens: num(env.output_tokens), cacheReadTokens: num(env.cache_read_tokens), model: str(env.model) };
    case 'ai.task':
      return {
        kind: 'task', eventId, messageId,
        tasks: Array.isArray(env.tasks) ? env.tasks as { subject: string; status: string; active_form?: string }[] : [],
      };
    case 'ai.subagent': {
      const phase = env.phase;
      const taskId = String(env.task_id ?? env.item_id ?? '');
      if (!taskId || !(phase === 'started' || phase === 'progress' || phase === 'completed' || phase === 'failed' || phase === 'interrupted')) return null;
      return {
        kind: 'subagent', eventId: `sub:${taskId}`, serverEventId: eventId,
        messageId, itemId: taskId, taskId, phase,
        toolUseId: str(env.tool_use_id), description: str(env.description),
        subagentType: str(env.subagent_type), spawnDepth: num(env.spawn_depth),
        taskType: str(env.task_type), isBackgrounded: typeof env.is_backgrounded === 'boolean' ? env.is_backgrounded : undefined,
        currentStep: str(env.current_step) ?? str(env.status_detail), lastTool: str(env.last_tool),
        toolUses: num(env.tool_uses), totalTokens: num(env.total_tokens), durationMs: num(env.duration_ms),
        summary: str(env.summary), outputFile: str(env.output_file),
      };
    }
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
  /**
   * Server-owned goal 软删镜像（wire `hidden = Boolean(hiddenAt)`，goal 被删
   * 除/放弃后置位）。仅补全 wire 模型——phone 的折叠展示消费的是
   * `hiddenAt` + `goalId` 对，不直接读本字段；它不是 CC 注入抑制位。
   */
  hidden?: boolean;
  /**
   * 该条消息进入 server 的通道: 'phone' = 手机派发, 'tui' = agent 扫盘带入。
   * undefined = 未知(老 server / 存量 agent 原生 id)。仅透传 wire 契约,
   * 当前无 UI 消费(会话级 origin 已覆盖展示需求)。
   */
  origin?: 'phone' | 'tui';
  /**
   * 该消息携带的素材（图片 / 手绘 / ASCII）。字段与 wire 一致（snake_case
   * `asset_id` / `object_key`），因为服务端已经物化过，手机只读不改，多一次
   * 改名没有收益。undefined = 纯文本消息。
   */
  attachments?: AiAttachmentMeta[];
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
  /**
   * before 模式锚点存在性(服务端 2026-10 起返回;老服务端 undefined 视为
   * 存在)。服务端拿到 before 游标却解析不到锚点时会显式回 anchor_found=false
   * (此前是静默落回最新页伪装成功)——客户端必须拒绝合并这种页,否则会把
   * 一页"最新消息"当更早历史吞掉,且页状态被错误推进。
   */
  anchorFound?: boolean;
  /**
   * 本地窗口事实(客户端自维护,服务端永不下发):本地保留窗口最老一条
   * 服务端确认消息的 id/timestamp。trim/加载更早/快照水合路径原子维护。
   * 「加载更早」用 encodeClientAiMessageCursor(它)自编码游标,服务端下发
   * 的 nextBeforeCursor 只是参考——trim 之后它可能指向已被裁掉或早已加载
   * 过的消息。undefined 表示用户从未在本机加载过更早历史(纯热窗)。
   */
  oldestLoadedId?: string;
  oldestLoadedTimestamp?: string;
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
  /** Auto-created public tunnel mapping (undefined = no mapping state recorded). */
  publicUrl?: string;
  portMappingId?: string;
  mappingStatus?: 'mapped' | 'failed' | 'unavailable' | 'revoked';
  mappingError?: string;
}
