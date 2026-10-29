import type {
  AgentCommandInfo,
  AgentTranscriptPage,
  Device,
  PreviewLink,
  Project,
  VibeCodingRun,
} from '../data/platformModels';
import type {
  PlatformFileDownloadStatus,
  PlatformTransferStatus,
  PlatformTransportEvent,
} from '../services/platformTransport';
import type { AiAttachmentMeta, AttachmentCapability } from '../api/attachments';
import type { EffortProvider } from '../utils/modelIntensity';

// --- Type definitions ---

export type TerminalLineKind =
  | 'command'
  | 'stdout'
  | 'stderr'
  | 'system'
  | 'success';

export type TerminalSessionStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'waiting_approval';

// agentcore = alianggate 自带的内核（不需要装任何外部 CLI）。
// 直接取 EffortProvider 的别名：两者必须同集合，用注释去保证迟早会漂移，
// 用类型别名则由编译器保证。
export type AgentProvider = EffortProvider;

/**
 * Outcome of a `refreshFromServer` call. Resolves (never rejects) so callers
 * can surface success/failure feedback without a try/catch — `ok:false` carries
 * the error message for a toast.
 */
export type RefreshOutcome = { ok: true } | { ok: false; error: string };

/** Outcome of a catch-up attempt (see catchUpAgentMessages). */
export type SessionCatchUpResult =
  | { mode: 'skipped'; reason: 'in_flight' | 'no_run' | 'fresh' }
  | { mode: 'full' }
  | {
      mode: 'after';
      fetched: number;
      anchorMissing: boolean;
      /** true = page cap hit with the server still claiming has_more; the
       * watermark was NOT advanced — the next trigger resumes the drain. */
      moreRemaining: boolean;
      /** true = the drain was cancelled mid-flight (unmount / session switch).
       * Already-fetched batches stay committed, but the caller must NOT treat
       * this as a finished drain: no continuation scheduling, no budget reset. */
      cancelled?: boolean;
    };

export interface HistoryPageState {
  initialized: boolean;
  loading: boolean;
  hasMore: boolean;
  nextBeforeCursor?: string;
  totalCount?: number;
  error?: string;
  /** 当前历史游标的设备过滤( undefined=全部设备 )。 */
  deviceId?: string;
}

export type UnifiedEventType =
  | 'terminal.output'
  | 'agent.delta'
  | 'platform.event'
  | 'command.started'
  | 'command.completed'
  | 'approval.requested'
  | 'file.changed'
  | 'device.bound'
  | 'device.offline'
  | 'project.updated'
  | 'project.scan.completed'
  | 'agent.session.started'
  | 'agent.session.updated'
  | 'agent.session.paused'
  | 'agent.session.resumed'
  | 'agent.session.completed'
  | 'agent.session.failed'
  | 'agent.session.terminated';

export type UnifiedEventStatus =
  | 'info'
  | 'running'
  | 'waiting'
  | 'done'
  | 'failed';

export interface TerminalLine {
  id: string;
  kind: TerminalLineKind;
  content: string;
  timestamp: string;
}

export interface TerminalSession {
  id: string;
  deviceId: string;
  directory: string;
  shell: string;
  status: TerminalSessionStatus;
  lines: TerminalLine[];
  createdAt: string;
  updatedAt: string;
  lastCommand?: string;
  lastCommandAt?: string;
  /**
   * Scrollback replay chunks from `terminal.replay` frames, in arrival order.
   * Deliberately independent of `lines` (lossy: fragmented + ANSI-stripped) and
   * of the terminal registry's pending buffer (double-buffering seam), so a
   * replay renders exactly once into a freshly-mounted emulator.
   *
   * Encoding contract: chunks are display-ready text — base64 frames are
   * decoded at ingest (appendTerminalReplayChunk), so consumers inject them
   * verbatim without re-checking the frame encoding.
   */
  replayChunks?: string[];
  /** True once the final replay frame arrived — chunks are complete to render. */
  replayReady?: boolean;
  /** Status carried by the final replay frame: the session was live or already exited. */
  replayStatus?: 'live' | 'exited';
  /** True when part of the scrollback was dropped (agent ring eviction or the client byte cap). */
  replayTruncated?: boolean;
  /**
   * True while an attach replay stream has BEGUN but its final frame hasn't
   * arrived (set by beginTerminalReplayStream; cleared by
   * finalizeTerminalReplay and the session-reset paths). The emulator's
   * replay→live handoff waits on it: before the FIRST frame lands
   * `replayChunks` is still empty, so waiting on chunks alone would wire the
   * live feed during the attach window and the late history would be
   * appended on top of live output (Bug D ②). Realtime-only — REST snapshots
   * never carry it.
   */
  replayPending?: boolean;
  /**
   * Raw kill/exit reason from the agent's `terminal.error` frame (verbatim,
   * e.g. "quota_unanswered: output quota exhausted …"). Set when the session
   * dies with an error, cleared when it is created/resumed again. Display
   * points humanize the quota_* prefixes; other texts keep generic copy.
   */
  exitReason?: string;
  /**
   * Pending geometry follow (设计 §1/§2): the last `terminal.geometry_changed`
   * broadcast that passed the local-resize window (this device's own resize
   * echoes are filtered out at the dispatcher — see terminalGeometryFollow.ts).
   * Deliberately stored on the session entry — NOT component state — so
   * re-entering the terminal screen still shows the follow until the user
   * takes it back (emulator fit / badge tap / app foreground) via
   * `clearTerminalGeometryFollow`.
   */
  geometryFollow?: { cols: number; rows: number; origin: 'web' | 'phone' };
  /**
   * 有效期窗口(server 权威,mirrors TerminalSession.expiresAt/ttlGrantedAt):
   * expiresAt = 当前窗口到期时刻,ttlGrantedAt = 窗口起点(create/renew/reopen
   * 时下发)。两者都缺 = 无过期(存量会话/服务端 TTL 关闭),UI 显示"未设置"。
   * 燃尽条以 (expiresAt - now) / (expiresAt - ttlGrantedAt) 计算。
   */
  expiresAt?: string;
  ttlGrantedAt?: string;
}

/**
 * A live output-quota challenge pushed by the server
 * (`terminal.quota.challenge`): the terminal has crossed its warning
 * watermark and will be killed at `killAtBytes` unless the user intervenes.
 * Client-side only — a transient queue drained by `challenge_resolved` or by
 * the session closing; never part of the server snapshot.
 */
export interface TerminalQuotaChallenge {
  challengeId: string;
  sessionId: string;
  seq: number;
  terminalName?: string;
  usedBytes: number;
  killAtBytes: number;
  maxBytes: number;
}

export interface TerminalCommandHistoryItem {
  id: string;
  terminalSessionId: string;
  deviceId: string;
  command: string;
  timestamp: string;
  exitCode?: number | null;
  createdAt: string;
}

export interface ProjectScanResult {
  id: string;
  deviceId: string;
  projectId: string;
  name: string;
  path: string;
  isGitRepo: boolean;
  branch: string;
  language: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'go' | 'pip' | 'gradle' | 'none';
  packageName: string;
  detectedPorts: number[];
  lastActiveAt: string;
  status: 'fresh' | 'active' | 'stale' | 'warning';
}

export type ApprovalKind =
  | 'dangerous_command'
  | 'file_write'
  | 'file_delete'
  | 'git_push'
  | 'tool'
  | 'client_response'
  | 'tool_ask';

export interface ApprovalOption {
  id: string;
  label: string;
  description?: string;
  response?: string;
  // v2:每选项预览行(≤8×200,server 已钳制);仅展示,不进作答。
  previews?: string[];
}

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  deviceId: string;
  projectId?: string;
  sessionId?: string;
  terminalId?: string;
  command?: string;
  toolName?: string;
  files?: string[];
  options?: ApprovalOption[];
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
  resolvedAt?: string;
  // tool_ask:agent bridge 生成的幂等键 / 原始提问载荷 / 作答 SLA(ms epoch)。
  interactionId?: string;
  toolInput?: Record<string, unknown>;
  expiresAt?: number;
  // v2 aliang-options 协议字段(server 透传;v1 块缺省)。multi=true 的卡
  // 走勾选多选 + selectedOptionIds 数组作答;header 为卡片眉题。
  multi?: boolean;
  allowCustom?: boolean;
  header?: string;
  version?: number;
}

export interface PushNotificationItem {
  id: string;
  type: 'approval' | 'completed' | 'error' | 'device_offline' | 'device_online';
  title: string;
  body: string;
  deviceId?: string;
  sessionId?: string;
  approvalId?: string;
  read: boolean;
  createdAt: string;
}

export interface ProjectFileEntry {
  id: string;
  projectId: string;
  deviceId?: string;
  directoryPath?: string;
  path: string;
  name: string;
  kind: 'file' | 'folder';
  status: 'clean' | 'modified' | 'added' | 'deleted';
  language: string;
  size: string;
  sizeBytes?: number;
  lastTouched: string;
  modifiedAt?: string;
  summary: string;
  content?: string;
  encoding?: string;
  loadedAt?: string;
  truncated?: boolean;
  error?: string;
  etag?: string;
  previewBlocked?: { reason: 'too_large' | 'binary' | 'video'; sizeBytes?: number };
}

export interface UnifiedEvent {
  id: string;
  type: UnifiedEventType;
  title: string;
  detail: string;
  status: UnifiedEventStatus;
  deviceId?: string;
  projectId?: string;
  sessionId?: string;
  terminalId?: string;
  approvalId?: string;
  timestamp: string;
  payload?: Record<string, string | number | boolean | undefined>;
}

/**
 * Client-side lifecycle of a single file download (server enforces per-user
 * concurrency = 1, so one active record is enough):
 *
 *   idle        no task
 *   requesting  POST /files/download in flight (no requestId yet)
 *   uploading   server is pushing the file to COS (WS-driven progress)
 *   ready       COS URL signed and stored — waiting for local save
 *   saving      blob-util writing the file to disk (download sheet owns this)
 *   done        saved / shared
 *   failed      request or upload failed (`reason` carries the server code)
 *   cancelled   user cancelled
 */
export type FileDownloadPhase =
  | 'idle'
  | 'requesting'
  | 'uploading'
  | 'ready'
  | 'saving'
  | 'done'
  | 'failed'
  | 'cancelled';

/** The one in-flight (or just-finished, pre-reset) download. */
export interface ActiveDownload {
  projectId: string;
  /** '' while the start POST is in flight. */
  requestId: string;
  path: string;
  /** Display name for the sheet/share dialog (from the file list entry). */
  filename: string;
  totalBytes: number;
  uploadedBytes: number;
  url?: string;
  reason?: string;
}

/**
 * Client-side lifecycle of one device-to-device transfer (server snapshot is
 * the truth; see transferSlice):
 *
 *   idle          no task
 *   requesting    POST /api/transfers in flight (transferId still '')
 *   transferring  server orchestration running (upload → complete → receive)
 *   done          target device confirmed the transfer
 *   failed        failed/expired on the server (`reason` carries the code)
 *   cancelled     user cancelled (transient — the sheet closes itself)
 */
export type TransferPhase =
  | 'idle'
  | 'requesting'
  | 'transferring'
  | 'done'
  | 'failed'
  | 'cancelled';

/** The one in-flight (or just-finished, pre-reset) transfer. */
export interface ActiveTransfer {
  sourceDeviceId: string;
  targetDeviceId: string;
  /** '' while the start POST is in flight. */
  transferId: string;
  /** Absolute path on the source device (what we asked it to pack). */
  sourcePath: string;
  /** Display name for the sheet (from the file list entry). */
  filename: string;
  /** True when the source path is a directory (server archives it as .zip). */
  isDirectoryArchive: boolean;
  totalBytes: number;
  bytesDone: number;
  reason?: string;
  /** 目标设备回报的最终落盘绝对路径（done 后有值）。 */
  path?: string;
}

interface StartAgentInput {
  deviceId: string;
  clientRequestId?: string;
  projectId: string;
  directory: string;
  provider: AgentProvider;
  objective: string;
  /**
   * 续聊回填（跨端统一 P4）：清单「另起续聊」时携带源会话的原生 CLI 会话 id，
   * 以 source_session_id 下发（服务端落绑定表，首回合按 resume 装回原生历史）。
   * 设置时 objective 允许为空——会话先注册为空起，用户在会话页发首条消息才
   * 起回合（服务端把 message:'' 当真消息派发，故空 objective 不发 message 键）。
   */
  sourceSessionId?: string;
  /**
   * Optional concrete model name forwarded to the agent CLI as `--model`
   * (e.g. "glm-5.2-xhigh"). When omitted/empty the agent's own default model is
   * used — do NOT send a display label like "Claude Code", the gateway would
   * forward it verbatim and pollute the CLI's model selection.
   */
  model?: string;
  /**
   * Optional reasoning effort. Provider-specific (codex:
   * none/minimal/low/medium/high/xhigh; claude_code: none/low/medium/high/max).
   * The agent applies it — codex as a `<base>-<effort>` model suffix. Empty
   * string means "no override"; omit entirely is equivalent.
   */
  effort?: string;
  /**
   * 会话上下文窗口（tokens，[100k,1M]）。omit = 服务端按
   * 用户默认（Me → 上下文）回落。创建后仍可改：输入框 Tools 里的
   * 「上下文」滑块走 updateAgentSession，下一轮生效。
   */
  contextWindow?: number;
  /**
   * Per-session approval-policy override (create-flow "session permissions").
   * Forwarded to the server's aiCreateSchema; omit/undefined = inherit the
   * resolved project/device policy (do NOT send 'inherit' to the server — only
   * allow_all | ask_all | read_only are valid on the wire).
   */
  approvalScheme?: 'allow_all' | 'ask_all' | 'read_only';
  /**
   * Per-session capability toggles. Omit = no override (the server keeps the
   * resolved policy's capability bits). Sent verbatim as booleans.
   */
  canRead?: boolean;
  canModify?: boolean;
  canRun?: boolean;
}

interface BindDeviceResult {
  ok: boolean;
  deviceId?: string;
  error?: string;
}

/**
 * 部署级功能开关（server mobile snapshot `features` 下发）。字段缺失（旧
 * server / 本地模式 / 未连接）一律按默认隐藏处理——审核安全侧。
 */
export interface PlatformFeatures {
  /** 「我的」页 Account/Usage 区块展示开关（默认 false 隐藏）。 */
  accountPortalVisible: boolean;
  /**
   * 部署级附件能力位（server snapshot features.attachments 下发）。字段缺失
   * （旧 server / 本地模式 / 未连接）为 undefined → 草稿态按不可用处理。
   * 与会话级 `attachmentsCapability` 同构，供草稿（尚无会话）直接读取。
   */
  attachmentsCapability?: AttachmentCapability;
}

export interface ControlCenterState {
  // Connection state
  wsConnected: boolean;
  serverMode: boolean;
  // Freshness metadata (L5): lets screens surface "data may be stale" and
  // trigger a per-domain refresh instead of assuming the resident copy is live.
  lastSyncedAt: number | null;
  stale: boolean;
  /** 最近一次 initialize/refresh 失败的原因(成功时清空)。供「连接失败」卡片展示。 */
  lastConnectError: string | null;
  // 部署级功能开关（snapshot 刷新；默认全隐藏）。
  platformFeatures: PlatformFeatures;
  // Data
  devices: Device[];
  projects: Project[];
  vibeRuns: VibeCodingRun[];
  aiSessionHistory: VibeCodingRun[];
  aiSessionHistoryPage: HistoryPageState;
  /** Active Claude/Codex capability snapshot keyed by AI session id. */
  sessionCommands: Record<string, AgentCommandInfo[]>;
  /**
   * The AI session currently on the chat screen (set on focus, cleared on
   * blur/unmount). The idle demoter never clears this session's resident
   * detail, so viewing a conversation never triggers a mid-view reload.
   * Client-side only; never persisted or carried in a server snapshot.
   */
  currentlyViewedSessionId?: string;
  previewLinks: PreviewLink[];
  terminalSessions: TerminalSession[];
  /** Pending terminal output-quota challenges, deduped by challengeId. */
  pendingChallenges: TerminalQuotaChallenge[];
  terminalCommandHistory: Record<string, TerminalCommandHistoryItem[]>;
  scanResults: ProjectScanResult[];
  approvals: ApprovalRequest[];
  approvalHistory: ApprovalRequest[];
  approvalHistoryPage: HistoryPageState;
  notifications: PushNotificationItem[];
  unreadNotificationsTotal: number;
  notificationHistory: PushNotificationItem[];
  notificationHistoryPage: HistoryPageState;
  events: UnifiedEvent[];
  eventHistory: UnifiedEvent[];
  eventHistoryPages: Record<string, HistoryPageState>;
  projectFiles: ProjectFileEntry[];
  /**
   * 目录级截断标记,键 `${projectId}:${path}`。Agent 对单次 file.list 有
   * max_entries 上限,超出部分手机端此前完全不可见(2026-10-28 审计 #1)。
   * true = 本次响应被截断;重新加载到全量时写回 false。
   */
  projectFileListTruncated: Record<string, boolean>;
  /**
   * File-download capability advertised by the server on the last
   * GET /files response (`download` field). Undefined when the server has no
   * download domain or the field is absent. Client-side only; not per-file
   * metadata, so it deliberately lives outside fileCache.
   */
  fileDownloadCapability?: { enabled: boolean; max_bytes: number };
  /**
   * The single in-flight file download (null = none). Client-side only, never
   * part of the server snapshot — a fresh app start reconnects via
   * `refreshStatus` only while a record exists.
   */
  fileDownloadActive: ActiveDownload | null;
  fileDownloadPhase: FileDownloadPhase;
  /**
   * The single in-flight device-to-device transfer (null = none).
   * Client-side only, never part of the server snapshot.
   */
  transferActive: ActiveTransfer | null;
  transferPhase: TransferPhase;
  // Actions
  initializeFromServer: (token?: string) => Promise<void>;
  refreshFromServer: () => Promise<RefreshOutcome>;
  disconnectFromServer: () => void;
  resetSessionData: () => void;
  markStale: () => void;
  handleTransportEvent: (event: PlatformTransportEvent) => void;
  renameDevice: (deviceId: string, name: string) => Promise<BindDeviceResult>;
  removeDevice: (deviceId: string) => Promise<BindDeviceResult>;
  scanDeviceProjects: (deviceId: string) => Promise<void>;
  createProject: (input: {
    deviceId: string;
    path: string;
    name?: string;
    language?: string;
    description?: string;
  }) => Promise<string>;
  updateProject: (
    projectId: string,
    input: Partial<{
      name: string;
      path: string;
      branch: string;
      language: string;
      description: string;
      status: 'active' | 'idle' | 'error' | 'fresh';
      claudeSkillTrusted: boolean;
    }>,
  ) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  loadProjectFiles: (
    projectId: string,
    path?: string,
    opts?: { force?: boolean; maxEntries?: number },
  ) => Promise<void>;
  loadProjectFileContent: (projectId: string, path: string, opts?: { force?: boolean }) => Promise<void>;
  dropFileContent: (projectId: string, path: string) => void;
  createTerminalSession: (
    deviceId: string,
    directory?: string,
  ) => Promise<string>;
  /**
   * Attach to an existing terminal session (POST /attach): asks the agent to
   * replay its scrollback (`terminal.replay` frames) before the live feed
   * resumes. Any buffered replay from a previous attach is reset first so a
   * re-attach replaces — never duplicates — the previous scrollback. When the
   * session is unknown locally (cold attach after an app restart) a
   * placeholder is registered BEFORE the request so early replay frames have
   * somewhere to buffer; it is dropped again if the attach fails.
   */
  attachTerminalSession: (
    sessionId: string,
    options?: { deviceId?: string },
  ) => Promise<string>;
  executeTerminalCommand: (terminalId: string, command: string) => void;
  clearTerminal: (terminalId: string) => void;
  /**
   * Drop the target session's buffered replay chunks and flags. The attach
   * flow calls this before requesting scrollback so a re-attach starts a
   * fresh stream instead of appending to (and duplicating) the previous one.
   */
  resetTerminalReplay: (sessionId: string) => void;
  /**
   * Drop the target session's pending geometry follow — the "take it back"
   * escape hatch for the follow state written by `terminal.geometry_changed`:
   * the local emulator fit (Task 13 resize), the follow badge tap, or regaining
   * foreground all reclaim local geometry authority this way. A no-op for
   * unknown session ids.
   */
  clearTerminalGeometryFollow: (sessionId: string) => void;
  stopTerminal: (terminalId: string) => Promise<void>;
  /**
   * 续期(有效期):把会话窗口重设为 now + hours(服务端上限 24h)。仅改
   * 服务端租约记录,不动 PTY/lastActiveAt;返回后本地快照被响应替换。
   */
  renewTerminalSession: (sessionId: string, hours: number) => Promise<void>;
  interruptTerminal: (terminalId: string) => void;
  /**
   * Answer a queued output-quota challenge from the global ChallengeModal:
   * send the `challenge.respond` message and optimistically dequeue the entry
   * without waiting for the server's `challenge_resolved` broadcast — that
   * broadcast's dequeue is an idempotent filter, so the optimistic removal
   * never conflicts with the echo and the next queued challenge shows at once.
   */
  respondToPendingChallenge: (
    challengeId: string,
    verdict: 'granted' | 'denied',
  ) => void;
  loadTerminalCommandHistory: (
    terminalId: string,
    deviceId?: string,
  ) => Promise<void>;
  startAgentSession: (input: StartAgentInput) => Promise<string>;
  /**
   * Resolves with the fetched `detail_refresh` status (fresh / failed /
   * skipped_offline / cached…) so a manual refresh can surface "the agent
   * didn't respond, showing the stale copy" instead of failing silently —
   * the server answers HTTP 200 with the cached page in those cases.
   */
  loadAgentSessionDetail: (
    sessionId: string,
    options?: { refresh?: boolean },
  ) => Promise<{ detailRefreshStatus?: string } | undefined>;
  /**
   * Incremental catch-up: compare the authoritative server transcript count
   * against the locally materialized messages and pull ONLY the missing tail
   * (after-cursor) when behind. Zero network I/O when fresh. Falls back to a
   * full detail fetch when no server-confirmed anchor exists locally. See
   * utils/sessionCatchUp + SessionCatchUpResult.
   */
  catchUpAgentMessages: (
    sessionId: string,
    serverCount: number,
  ) => Promise<SessionCatchUpResult>;
  /**
   * Cancel an in-flight catch-up drain (unmount / session switch). The loop
   * stops at the next page boundary; already-fetched batches stay committed
   * but the watermark is never claimed by a cancelled run.
   */
  cancelAiSessionCatchUp: (sessionId: string) => void;
  /**
   * 触发1 自愈(useSessionCatchUp):把轻量元数据(fetchedAiSession)携带的
   * 服务端 transcript_page 位置感知合并进会话(见 acceptServerTranscriptPage
   * ——游标比本地窗口浅的页被拒,防止已翻历史被顶回服务端热窗起点)。
   * incoming.page 为 undefined 时是 no-op。
   */
  mergeServerTranscriptPage: (
    sessionId: string,
    page: AgentTranscriptPage | undefined,
  ) => void;
  loadEarlierAgentMessages: (sessionId: string) => Promise<void>;
  loadAiSessionHistory: (options?: {
    reset?: boolean;
    deviceId?: string;
  }) => Promise<void>;
  /**
   * 自动水合会话历史：连续按 cursor 拉页直到 ≥minItems 条摘要或服务端
   * has_more 结束。设备列表未就绪时直接返回（由调用方在 devices 到位后重入，
   * 见 VibeCodingListScreen 的 boot effect）。minItems 是预取目标而非上限，
   * 用户手动"加载更多"仍可继续访问全部历史。
   */
  hydrateSessionHistory: (options?: {
    minItems?: number;
    maxPages?: number;
    deviceId?: string;
  }) => Promise<void>;
  /**
   * On-demand `/`-command discovery for a session. Auto path (ToolsMenu open,
   * `force=false`) is 1h-gated + in-flight-deduped (cheap). Manual path (input
   * refresh button, `force=true`) bypasses the 1h gate. The server applies a
   * 10s floor on top. Results are stored by session because Skills depend on
   * the active CLI process, cwd, version, settings and plugins.
   */
  refreshSessionCommands: (
    sessionId: string,
    options?: { force?: boolean },
  ) => Promise<AgentCommandInfo[]>;
  interruptAgentSession: (sessionId: string) => Promise<void>;
  pauseAgentSession: (sessionId: string) => Promise<void>;
  resumeAgentSession: (sessionId: string) => Promise<void>;
  terminateAgentSession: (sessionId: string) => Promise<void>;
  updateAgentSession: (
    sessionId: string,
    input: Partial<{
      title: string;
      objective: string;
      status: 'idle' | 'running' | 'paused' | 'error' | 'closed';
      currentStep: string;
      /** Concrete model name; "" clears it (revert to CLI default), omit = unchanged. */
      model: string;
      risk: 'low' | 'medium' | 'high';
      /** Reasoning effort (provider-specific); "" clears, omit = unchanged. */
      effort: string;
      /**
       * 会话级上下文窗口（tokens）。omit = 不变，`null` = 清除（回落用户
       * 默认）。下一轮生效；计入 modelConfigVersion。
       */
      contextWindow: number | null;
    }>,
  ) => Promise<void>;
  /**
   * 让服务端按当前会话内容生成新标题并直接应用（重命名面板的 AI 按钮）。
   * 返回落库后的标题；失败原因由服务端状态码区分（503 未配置 / 422 无素材 /
   * 502 模型失败 / 409 goal 会话）。
   */
  generateAgentSessionTitle: (sessionId: string) => Promise<string>;
  deleteAgentSession: (sessionId: string) => Promise<void>;
  /**
   * 发送一条用户消息。`attachments` 是**服务端已物化**的素材元数据（图片
   * 先 PUT+complete，ASCII 先 create），发送时只带 `asset_id` 供服务端
   * 引用；乐观气泡同时挂上这份元数据，让用户立刻看到自己发了什么。
   */
  appendAgentMessage: (
    sessionId: string,
    content: string,
    mode: 'voice' | 'text',
    attachments?: AiAttachmentMeta[],
  ) => Promise<void>;
  /**
   * Re-send a failed-to-send user message (`AgentMessage.failed`) directly from
   * its retryable bubble — NOT through the composer input, so the retry can
   * never append to / combine with other text. Removes the stale failed bubble
   * and dispatches a fresh send; a repeat failure re-marks the new bubble failed.
   */
  retryAgentMessage: (sessionId: string, messageId: string) => Promise<void>;
  /** Remove a failed-to-send user bubble the user chose to discard. */
  dismissFailedMessage: (sessionId: string, messageId: string) => void;
  resolveApproval: (
    approvalId: string,
    decision: 'approved' | 'denied',
    options?: {
      selectedOptionId?: string;
      /** v2 多选:multi 卡传 id 数组(按选项声明顺序)。 */
      selectedOptionIds?: string[];
      message?: string;
    },
  ) => Promise<void>;
  loadApprovalHistory: (options?: { reset?: boolean }) => Promise<void>;
  loadNotificationHistory: (options?: { reset?: boolean }) => Promise<void>;
  loadEventHistory: (options?: {
    reset?: boolean;
    deviceId?: string;
    sessionId?: string;
  }) => Promise<void>;
  /**
   * Cache the lazily-fetched heavy detail (command output / diff / thinking
   * text) for one structured activity event on the matching run's
   * `eventDetailCache`, keyed by `eventId`. Called by the chat screen via
   * `ActivityBlock` so the presentational component never touches the store.
   */
  cacheStructuredDetail: (
    sessionId: string,
    eventId: string,
    detail: { text?: string; truncated?: boolean },
  ) => void;
  /**
   * Mark a session as viewed now (chat screen focus): stamps its `lastViewedAt`
   * and sets it as `currentlyViewedSessionId` so idle demotion skips it.
   */
  markSessionViewed: (sessionId: string) => void;
  /** Clear the currently-viewed marker (chat screen blur/unmount). */
  clearCurrentlyViewedSession: (sessionId?: string) => void;
  /**
   * Demote sessions not viewed within the idle threshold (and not active /
   * currently viewed) — clears their resident transcript/structuredEvents/
   * detail cache to bound memory. Triggered on AppState background and by a
   * coarse interval sweeper.
   */
  demoteIdleSessions: () => void;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  createPtySession: (
    deviceId: string,
    options?: { cwd?: string; cols?: number; rows?: number },
  ) => Promise<string>;
  sendTerminalInput: (
    sessionId: string,
    data: string,
    encoding?: string,
  ) => void;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => void;
  closeTerminalSession: (sessionId: string) => Promise<void>;
  // --- File download (single in-flight task; see fileDownloadSlice) ---
  /** POST the download request; failures land in markFailed (never rejects). */
  startDownload: (
    projectId: string,
    path: string,
    filename: string,
  ) => Promise<void>;
  /** Apply one normalized `file_download` push (WS or REST reconcile). */
  handleFileDownloadEvent: (download: PlatformFileDownloadStatus) => void;
  /** Reconcile with GET status while a download is active (404 → reset). */
  refreshStatus: () => Promise<void>;
  /** Cancel the in-flight upload via DELETE (never rejects). */
  cancelDownload: () => Promise<void>;
  markSaving: () => void;
  markDone: () => void;
  markFailed: (reason?: string) => void;
  resetFileDownload: () => void;
  // --- Device-to-device transfer (single in-flight task; see transferSlice) ---
  /** POST /api/transfers; failures land in markTransferFailed (never rejects). */
  startTransfer: (input: {
    sourceDeviceId: string;
    targetDeviceId: string;
    sourcePath: string;
    filename: string;
    isDirectoryArchive: boolean;
    /** Optional landing subdirectory under the target inbox (empty = root). */
    targetDir?: string;
  }) => Promise<void>;
  /** Apply one normalized `transfer.updated` push (WS or REST reconcile). */
  handleTransferEvent: (transfer: PlatformTransferStatus) => void;
  /** Reconcile with GET status while a transfer is active (404 → reset). */
  refreshTransferStatus: () => Promise<void>;
  /** Cancel via POST /cancel; user cancel lands in `cancelled`. */
  cancelTransfer: () => Promise<void>;
  markTransferFailed: (reason?: string) => void;
  resetTransfer: () => void;
}
