import {
  ApiResponseError,
  apiFetch,
  apiGet,
  apiPatch,
  apiPost,
} from './client';
import type { AgentCommandInfo, AgentMessage, GoalState } from '../data/platformModels';
import { cursorPageQuery, type ServerCursorPageResponse } from './pagination';
import type { AiAttachmentMeta, AttachmentCapability } from './attachments';

const AI_TURN_REQUEST_TIMEOUT_MS = 120_000;
const aiSessionDetailRequests = new Map<string, Promise<ServerAiSession>>();

/**
 * Provider spelling as it appears on the wire to PhoneServer.
 *
 * 注意这**不是** UI 层的 AgentProvider：'claude_code' 在 wire 上拼作
 * 'claudecode'，由 aiSessionSlice 的 providerWireValue 统一转换。
 * agentcore 两侧同拼写。
 */
export type AiProviderWire =
  | 'codex'
  | 'claude'
  | 'claudecode'
  | 'opencode'
  | 'agentcore';

export interface ServerAiTranscriptPage {
  limit: number;
  count: number;
  total_count?: number;
  has_more: boolean;
  next_before_cursor?: string;
  next_before_message_id?: string;
  /**
   * after(catch-up)模式专属:向前链式游标 / 锚点存在性。before 模式下
   * 服务端不返回(undefined → JSON 序列化丢弃)。
   */
  next_after_cursor?: string;
  next_after_message_id?: string;
  anchor_found?: boolean;
  order?: 'asc';
  cache_status?: string;
  fetched_at?: string;
}

export interface ServerAiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  mode?: 'voice' | 'text' | 'action';
  content: string;
  timestamp: string;
  index?: number;
  /**
   * Server-owned Goal id when this message was produced during a Goal-driven
   * run. Absent for ordinary chat. Matches `goal_id` from server Task 8.
   */
  goal_id?: string;
  /**
   * 该条消息进入 server 的通道: 'phone' = 手机 REST/WS 派发(server 造币
   * msg_ 前缀), 'tui' = agent 扫盘/详情合并带入。undefined = 来源未知
   * (存量 agent 原生 id / managed 上报不可分辨), 显示侧回落会话级 origin。
   */
  origin?: 'phone' | 'tui';
  /**
   * ISO timestamp the server marked this message hidden (folded) — e.g. once
   * the owning Goal is abandoned/completed. Absent means still visible.
   * Matches `hidden_at` from server Task 8.
   */
  hidden_at?: string;
  /**
   * Server-owned goal 软删镜像：server 侧 `hidden = Boolean(hiddenAt)`（goal
   * 被删除/放弃后置位，行仍随 payload 下发是为了可折叠展示）。生产 payload
   * 一直在发，此前未声明而被 field-by-field 拷贝静默丢弃。注意它不是 CC
   * 注入抑制位——CC 工件在 server 侧入库即拦、存量走开机清理。
   */
  hidden?: boolean;
  /**
   * 这条消息携带的素材（server `serializeAiMessage` 只在不空时下发）。
   * 服务端已物化：名称/MIME/字节数都以服务端记录为准，手机渲染图片时用
   * `object_key` 换签名 URL，或用 `text` 直接渲染 ASCII。
   */
  attachments?: AiAttachmentMeta[];
}

export interface ServerGoalSummary {
  goal_id: string;
  objective?: string;
  state: GoalState;
  state_version?: number;
  completed_tasks?: number;
  total_tasks?: number;
  current_task?: string;
  current_run_health?: string;
  attention?: string;
  primary_action_kind?: string;
  primary_action_label?: string;
  provider?: string;
  model?: string;
  effort?: string;
  driver?: string;
  workspace_relation?: 'exact' | 'advanced' | 'unavailable';
  updated_at?: string;
  tasks?: Array<{
    id: string;
    title: string;
    status?: string;
    is_current?: boolean;
  }>;
  checks?: Array<{
    id: string;
    title: string;
    status?: string;
    detail?: string;
  }>;
}

/**
 * Map a server `ServerAiMessage` (snake_case wire form) to the phone's
 * `AgentMessage` (camelCase client model). Centralizes the field-by-field copy
 * so every transcript/messages call site stays in sync — including the
 * server-owned Goal metadata (`goal_id` / `hidden_at`) introduced in server
 * Task 8, which folds goal-planning chatter once a Goal is closed.
 */
export const serverAiMessageToAgent = (m: ServerAiMessage): AgentMessage => ({
  id: m.id,
  role: m.role,
  mode: m.mode,
  content: m.content,
  timestamp: m.timestamp,
  index: m.index,
  goalId: m.goal_id,
  hiddenAt: m.hidden_at,
  hidden: m.hidden,
  origin: m.origin,
  // 素材元数据原样透传：wire 与本地模型共用同一组 snake_case 字段
  // （见 AiAttachmentMeta），不需要再做一次字段改名。
  attachments: m.attachments,
});

export interface ServerAiSession {
  session_id: string;
  kind: 'ai';
  user_id: string;
  device_id: string;
  status: 'creating' | 'active' | 'idle' | 'running' | 'paused' | 'closed' | 'error';
  /**
   * 会话发起来源(server origin 列): 'phone' = 手机 REST/WS 建会话,
   * 'tui' = agent 扫盘导入的终端会话。老 server 不发 → 映射层按
   * ai_import_ 前缀兜底(见 serverAiSessionToVibeRun)。≠ device_id
   * (跑在哪台机器), ≠ source_session_id(CLI 原生 --resume id)。
   */
  origin?: 'phone' | 'tui';
  /**
   * Server-authoritative display phase (drives the phone's top-level status).
   * Preferred over locally deriving phase from status + a silence window, so
   * completion isn't guessed from a lack of ai.delta (the "运行中却显示已完成"
   * bug). Undefined when talking to an older server that doesn't send it —
   * callers fall back to deriveSessionPhase.
   */
  phase?: 'running' | 'waiting_approval' | 'completed' | 'failed';
  active_run_id?: string;
  latest_run_id?: string;
  run_state?:
    | 'queued'
    | 'running'
    | 'waiting_approval'
    | 'cancelling'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'timed_out';
  run_state_version?: number;
  /**
   * 本会话最近一次运行的执行器（server 从 ai.run.started 事件派生）。
   * 'tui' = 注入到终端里已在跑的 Claude Code TUI，只能收文本、没有 steer
   * 通道；'spawn' = agent 自己 spawn 的 --print 进程，支持图片与插话。
   * 老 server 不下发 → undefined，手机按旧行为处理。
   */
  executor?: 'tui' | 'spawn';
  last_agent_event_seq?: number;
  project_path?: string;
  mode: 'chat' | 'vibe' | 'review' | 'agent';
  purpose?: 'chat' | 'goal';
  goal_summary?: ServerGoalSummary;
  title?: string;
  objective?: string;
  model?: string;
  provider?: AiProviderWire;
  tool?: AiProviderWire;
  source_session_id?: string;
  risk?: 'low' | 'medium' | 'high';
  /**
   * Reasoning effort. Provider-specific:
   *   codex  → none | minimal | low | medium | high | xhigh
   *   claude → none | low | medium | high | max
   * Forwarded to the agent; codex applies it as a `<base>-<effort>` model
   * suffix. Empty/omit = no effort override (CLI/gateway default).
   */
  effort?: string;
  model_config_version?: number;
  /**
   * 会话级上下文窗口（tokens）。缺省 = 未设置，服务端逐层回落（会话 →
   * 用户默认 → 200k，见 server `modelConfig.ts`）。PATCH 可随时改，
   * 下一轮生效：服务端每轮 `ai.message` 前重发 `ai.session.create`。
   */
  context_window?: number;
  active_execution_profile?: {
    version: number;
    provider?: string;
    model?: string;
    effort?: string;
    /** 该轮锁定的上下文窗口（profile 不可变，改设置不影响进行中的那一轮）。 */
    context_window?: number;
    captured_at: string;
  };
  /**
   * Server-resolved effective model config for this session: the concrete
   * provider/model/effort the agent will actually run with, plus where each
   * field was sourced from (session | project | device | server). Surfaced to
   * the UI as a read-only "当前有效" hint. Optional — only present when the
   * server attached it. Mirrors `EffectiveModelConfig` (api/modelConfig.ts).
   */
  effective_model_config?: {
    provider?: string | null;
    model?: string | null;
    effort?: string | null;
    /**
     * 生效的上下文窗口（token）。**注意大小写**：这个子对象是服务端
     * `EffectiveModelConfig` 原样序列化，键名是 camelCase，和同层的
     * snake_case 字段不一致（见 server `types.ts`）。恒有值。
     */
    contextWindow?: number | null;
    source?: {
      provider?: string;
      model?: string;
      effort?: string;
      /** 窗口来源：session | user | cli。 */
      context?: string;
    };
  };
  current_step?: string;
  branch?: string;
  transcript?: ServerAiMessage[];
  transcript_page?: ServerAiTranscriptPage;
  events?: Array<{
    id: string;
    type: 'command' | 'file' | 'test' | 'preview' | 'approval' | 'status';
    title: string;
    detail: string;
    status: 'done' | 'running' | 'waiting' | 'failed';
    timestamp: string;
  }>;
  transcript_count?: number;
  event_count?: number;
  /**
   * Structured activity events (command / file_change / thinking / usage /
   * task) for the session, as slim snake_case envelopes pushed by the backend.
   * Present on single-session detail GETs; the list snapshot may omit it. The
   * phone maps each envelope to a `StructuredActivityEvent`
   * (see `envelopeToActivity` in `data/platformModels`); heavy detail per event
   * is fetched on demand via `fetchStructuredEventDetail`.
   */
  structured_events?: Array<Record<string, unknown>>;
  /** Distinct files the agent wrote/edited during the current/most-recent run. */
  files_touched_count?: number;
  /** git working-tree change count for the project dir during the current/most-recent run. */
  git_changed_count?: number;
  /**
   * Live retry indicator: the agent is retrying an upstream (gateway 5xx)
   * error. Transient on the server (in-memory only); false/absent when not
   * retrying. Powers the phone's "重试 2/10 · 网关 502" indicator so the
   * (potentially long) retry window isn't a silent "处理中…".
   */
  retry_active?: boolean;
  retry_attempt?: number;
  retry_max?: number;
  retry_error_status?: number;
  retry_error_type?: string;
  /**
   * Structured cause of the most recent terminal failure (ai.error). Persisted
   * on the server, so the failed-phase renders correctly after a refresh.
   */
  last_error_status?: number;
  last_error_type?: string;
  last_retry_attempt?: number;
  last_retry_max?: number;
  last_message?: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    mode?: 'voice' | 'text' | 'action';
    content: string;
    timestamp: string;
  };
  /**
   * Server-side diagnostic for the latest message-page resolution. The single
   * session GET runs `loadAiMessagePageForSession`, which reports WHY the
   * returned transcript is what it is — crucially `skipped_offline` (agent not
   * connected, so native-session history couldn't be fetched) and `failed`
   * (agent request errored). Without this the client can't tell an empty
   * conversation apart from "agent offline, history unreachable".
   *
   * status values: cached | cached_partial | cache_miss | fresh | failed |
   * skipped_offline.
   */
  detail_refresh?: { status: string; error?: string };
  last_detail_fetch_status?: string;
  last_detail_fetch_at?: string;
  last_detail_error?: string;
  /**
   * 素材上传能力位（server `publicAiSession().attachments`）。COS 未配置时
   * `enabled:false`，手机据此隐藏输入框的「+」入口。
   *
   * 注意：**列表快照 `publicAiSessionSummary()` 不带这个字段**——所以
   * undefined 只能理解为「还不知道」，不能当成「不支持」；详情 GET 回来后
   * 才做最终判断。
   */
  attachments?: AttachmentCapability;
  created_at: string;
  last_active_at: string;
  closed_at?: string;
}

export interface ServerAiMessagesPageResponse {
  session_id: string;
  messages: ServerAiMessage[];
  page: ServerAiTranscriptPage;
  detail_refresh?: { status: string; error?: string };
}

export interface ServerTerminalSession {
  session_id: string;
  kind: 'terminal';
  user_id: string;
  device_id: string;
  status: 'creating' | 'active' | 'closed' | 'error';
  cwd?: string;
  shell?: string;
  cols: number;
  rows: number;
  created_at: string;
  last_active_at: string;
  closed_at?: string;
  /** 有效期窗口(server 权威):窗口起点 + 到期时刻;都缺 = 无过期。 */
  ttl_granted_at?: string;
  expires_at?: string;
  last_command?: string;
  last_command_at?: string;
  recent_commands?: Array<{
    id: string;
    command: string;
    timestamp: string;
    created_at: string;
    exit_code?: number | null;
  }>;
  /** Attach endpoint: whether the agent found a live session to resume. */
  resumed?: boolean;
  /** Attach endpoint: whether the attached session had already exited (tombstone replay). */
  exited?: boolean;
}

export interface ServerTerminalCommand {
  id: string;
  terminalSessionId: string;
  userId: string;
  deviceId: string;
  command: string;
  timestamp: string;
  exitCode?: number | null;
  createdAt: string;
}

export interface ServerTerminalCommandResult {
  sessionId?: string;
  deviceId?: string;
  commands: ServerTerminalCommand[];
}

// AI Sessions

export const fetchAiSessions = (): Promise<ServerAiSession[]> =>
  apiGet<ServerAiSession[]>('/api/ai/sessions');

export const fetchAiSessionsPage = (options?: {
  limit?: number;
  before?: string;
  deviceId?: string;
}): Promise<ServerCursorPageResponse<ServerAiSession>> =>
  apiGet<ServerCursorPageResponse<ServerAiSession>>(
    `/api/ai/sessions?${cursorPageQuery(options)}`,
  );

export const fetchAiSession = (
  sessionId: string,
  options?: { refresh?: boolean },
): Promise<ServerAiSession> => {
  const refresh = options?.refresh === true;
  const key = `${sessionId}:${refresh ? 'refresh' : 'cached'}`;
  const existing = aiSessionDetailRequests.get(key);
  if (existing) return existing;
  const request = (async () => {
    try {
      return await apiGet<ServerAiSession>(
        `/api/ai/sessions/${sessionId}${refresh ? '?refresh=true' : ''}`,
        // The detail GET may trigger a server→agent round trip: the server waits
        // up to 12s, so leave enough room for the in-band response.
        { timeoutMs: 15_000 },
      );
    } finally {
      aiSessionDetailRequests.delete(key);
    }
  })();
  aiSessionDetailRequests.set(key, request);
  return request;
};

export const fetchAiSessionMessages = (
  sessionId: string,
  options?: {
    limit?: number;
    before?: string;
    /** catch-up 锚点:返回该消息之后(不含)的增量段,与 before 互斥。 */
    after?: string;
    refresh?: boolean;
  },
): Promise<ServerAiMessagesPageResponse> => {
  const query = new URLSearchParams();
  if (options?.limit) query.set('limit', String(options.limit));
  if (options?.before) query.set('before', options.before);
  if (options?.after) query.set('after', options.after);
  if (options?.refresh) query.set('refresh', 'true');
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiGet<ServerAiMessagesPageResponse>(
    `/api/ai/sessions/${sessionId}/messages${suffix}`,
    { timeoutMs: 15_000 },
  );
};

export interface StructuredEventDetailResponse {
  event_id: string;
  event_type: string;
  detail: Record<string, unknown> | null;
  truncated: boolean;
}

/**
 * Fetch the heavy detail for a single structured activity event. The backend
 * serves it at `/api/ai/sessions/:sessionId/structured-events/:eventId`; the
 * `detail` payload carries the large field by event type
 * (command→{output}, file_change→{diff, changes}, thinking→{text}). We extract
 * the first known text-bearing field for display; null/missing → undefined so
 * the UI can show a neutral placeholder.
 */
export async function fetchStructuredEventDetail(
  sessionId: string,
  eventId: string,
): Promise<{ text?: string; truncated: boolean }> {
  const r = await apiGet<StructuredEventDetailResponse>(
    `/api/ai/sessions/${sessionId}/structured-events/${eventId}`,
  );
  const d = r.detail ?? {};
  const text =
    typeof d.output === 'string'
      ? d.output
      : typeof d.diff === 'string'
        ? d.diff
        : typeof d.text === 'string'
          ? d.text
          : undefined;
  return { text, truncated: Boolean(r.truncated) };
}

export const createAiSession = (input: {
  device_id: string;
  client_request_id?: string;
  project_id?: string;
  project_path?: string;
  mode?: 'chat' | 'vibe' | 'review' | 'agent';
  title?: string;
  objective?: string;
  /**
   * First user message. When set, the server creates the session AND dispatches
   * ai.session.create + ai.message together so the agent starts turn 1
   * immediately (an empty create would idle forever). Title/objective are
   * derived from this on the server when not explicitly provided.
   */
  message?: string;
  model?: string;
  provider?: AiProviderWire;
  tool?: AiProviderWire;
  risk?: 'low' | 'medium' | 'high';
  effort?: string;
  /**
   * 会话上下文窗口（tokens）。服务端钳到 [100k,1M] 后经 executionProfile
   * 下发给宿主：claude 系转成 CLI 的 --autocompact，agentcore 作为内核
   * 自动压缩窗口。省略 = 继承用户默认（Me 里设置）→ 200k。
   */
  context_window?: number;
  /**
   * Per-session approval-policy override (create-flow "session permissions").
   * camelCase on the wire to match the server's aiCreateSchema field naming.
   * Omit/undefined = inherit the resolved project/device policy (the server
   * only accepts allow_all | ask_all | read_only — never send 'inherit').
   */
  approvalScheme?: 'allow_all' | 'ask_all' | 'read_only';
  /**
   * Per-session capability toggles. Omit = no override (the resolved policy's
   * capability bits are kept). Forwarded verbatim as booleans, camelCase.
   */
  canRead?: boolean;
  canModify?: boolean;
  canRun?: boolean;
}): Promise<ServerAiSession> =>
  apiPost<ServerAiSession>('/api/ai/sessions', input, {
    timeoutMs: AI_TURN_REQUEST_TIMEOUT_MS,
  });

export interface SendAiMessageResponse {
  message_id: string;
  status: string;
  run_id?: string;
  run_state?: ServerAiSession['run_state'];
  run_state_version?: number;
}

export const sendAiMessage = (
  sessionId: string,
  content: string,
  attachments: unknown[] = [],
  mode: 'voice' | 'text' = 'text',
  expectedModelConfigVersion?: number,
): Promise<SendAiMessageResponse> =>
  apiPost(`/api/ai/sessions/${sessionId}/messages`, {
    content,
    attachments,
    mode,
    expected_model_config_version: expectedModelConfigVersion,
  }, {
    timeoutMs: AI_TURN_REQUEST_TIMEOUT_MS,
  });

export const sendAiSteer = (
  sessionId: string,
  content: string,
  attachments: unknown[] = [],
  mode: 'voice' | 'text' = 'text',
): Promise<SendAiMessageResponse> =>
  apiPost(`/api/ai/sessions/${sessionId}/steers`, { content, attachments, mode }, {
    timeoutMs: AI_TURN_REQUEST_TIMEOUT_MS,
  });

export interface RefreshSessionCommandsResponse {
  source: 'cache' | 'persisted' | 'agent' | 'agent-offline';
  fetched_at: string;
  commands: AgentCommandInfo[];
  verified?: boolean;
  claude_version?: string;
  capability_generation?: string;
}

/**
 * On-demand `/`-command discovery for a session. `force` maps to the server's
 * `refresh` query param: true bypasses the server's 10s floor + the client's
 * 1h auto-gate (manual refresh button); false is the cheap auto path (ToolsMenu
 * open) that only fetches when stale and otherwise returns persisted commands.
 * The store action (refreshSessionCommands) owns the 1h gate + in-flight dedup;
 * this is just the transport.
 */
export const refreshSessionCommands = (
  sessionId: string,
  force: boolean,
): Promise<RefreshSessionCommandsResponse> =>
  apiPost<RefreshSessionCommandsResponse>(
    `/api/ai/sessions/${sessionId}/commands/refresh?refresh=${force ? 'true' : 'false'}`,
    {},
  );

export const stopAiSession = (
  sessionId: string,
): Promise<{ status: string; session?: ServerAiSession }> =>
  apiPost(`/api/ai/sessions/${sessionId}/stop`);

export const interruptAiSession = async (
  sessionId: string,
): Promise<ServerAiSession> => {
  try {
    return await apiPost<ServerAiSession>(
      `/api/ai/sessions/${sessionId}/interrupt`,
    );
  } catch (error) {
    if (error instanceof ApiResponseError && error.status === 404) {
      const stopped = await stopAiSession(sessionId);
      return stopped.session ?? fetchAiSession(sessionId);
    }
    throw error;
  }
};

export const pauseAiSession = (sessionId: string): Promise<ServerAiSession> =>
  apiPost<ServerAiSession>(`/api/ai/sessions/${sessionId}/pause`);

export const resumeAiSession = (sessionId: string): Promise<ServerAiSession> =>
  apiPost<ServerAiSession>(`/api/ai/sessions/${sessionId}/resume`);

export const terminateAiSession = (sessionId: string): Promise<ServerAiSession> =>
  apiPost<ServerAiSession>(`/api/ai/sessions/${sessionId}/terminate`);

export const updateAiSession = (
  sessionId: string,
  input: Partial<{
    title: string;
    objective: string;
    status: 'idle' | 'running' | 'paused' | 'error' | 'closed';
    current_step: string;
    /** Concrete model name; "" clears (revert to CLI default), omit = unchanged. */
    model: string;
    risk: 'low' | 'medium' | 'high';
    /**
     * Reasoning effort (provider-specific). "" clears it (revert to default),
     * omit = unchanged. Sent as a separate field — the gateway derives the
     * codex reasoning level from it (NOT from the model name).
     */
    effort: string;
    /**
     * 会话级上下文窗口（tokens）。omit = 不变；`null` = 清除（回落到用户
     * 默认）。服务端会把它算进 modelConfigVersion，所以改窗口和改
     * model/effort 一样要走 `expected_model_config_version`。
     */
    context_window: number | null;
    expected_model_config_version: number;
  }>,
): Promise<ServerAiSession> =>
  apiPatch<ServerAiSession>(`/api/ai/sessions/${sessionId}`, input);

export const deleteAiSession = (sessionId: string): Promise<{ status: string; session_id: string }> =>
  apiFetch<{ status: string; session_id: string }>(`/api/ai/sessions/${sessionId}`, { method: 'DELETE' });

/**
 * 长按重命名面板的「AI」按钮：让服务端按当前会话内容重新生成标题并直接落库。
 * 服务端同步等 LLM（默认超时 20s），客户端 8s 默认超时不够，单独放宽到 30s。
 */
export const generateAiSessionTitle = (sessionId: string): Promise<ServerAiSession> =>
  apiPost<ServerAiSession>(
    `/api/ai/sessions/${sessionId}/generate-title`,
    undefined,
    { timeoutMs: 30_000 },
  );

// Terminal Sessions

export const fetchTerminalSessions = (): Promise<ServerTerminalSession[]> =>
  apiGet<ServerTerminalSession[]>('/api/terminal/sessions');

export const createTerminalSession = (input: {
  device_id: string;
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
  // Create-intent id: a retried POST (client.ts re-discover retry) hits the
  // same live session server-side instead of opening a second pty.
  client_request_id?: string;
}): Promise<ServerTerminalSession> =>
  apiPost<ServerTerminalSession>('/api/terminal/sessions', input);

export const closeTerminalSession = (sessionId: string): Promise<ServerTerminalSession> =>
  apiPost(`/api/terminal/sessions/${sessionId}/close`);

/**
 * 续期(有效期):新窗口锚定在当前时刻(now + hours,服务端上限 24h),只在
 * 服务端改租约记录,不碰 PTY。会话已死时服务端回 409。
 */
export const renewTerminalSession = (
  sessionId: string,
  hours: number,
): Promise<ServerTerminalSession> =>
  apiPost<ServerTerminalSession>(
    `/api/terminal/sessions/${encodeURIComponent(sessionId)}/renew`,
    { hours },
  );

/**
 * Attach to an existing terminal session. Asks the agent to resize to the
 * given rows/cols and stream the scrollback as `terminal.replay` chunks over
 * the realtime socket before the live feed continues.
 */
export const attachTerminalSession = (
  sessionId: string,
  input: { rows?: number; cols?: number },
): Promise<ServerTerminalSession> =>
  apiPost<ServerTerminalSession>(
    `/api/terminal/sessions/${encodeURIComponent(sessionId)}/attach`,
    input,
  );

export const fetchTerminalSessionCommands = (
  sessionId: string,
  limit = 20,
): Promise<ServerTerminalCommandResult> =>
  apiGet<ServerTerminalCommandResult>(
    `/api/terminal-sessions/${encodeURIComponent(sessionId)}/commands?limit=${limit}`,
  );

export const fetchDeviceTerminalCommands = (
  deviceId: string,
  limit = 20,
): Promise<ServerTerminalCommandResult> =>
  apiGet<ServerTerminalCommandResult>(
    `/api/devices/${encodeURIComponent(deviceId)}/terminal-commands?limit=${limit}`,
  );
