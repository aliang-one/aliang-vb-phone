import {
  ApiResponseError,
  apiFetch,
  apiGet,
  apiPatch,
  apiPost,
} from './client';
import type { AgentCommandInfo, AgentMessage, GoalState } from '../data/platformModels';
import { cursorPageQuery, type ServerCursorPageResponse } from './pagination';

const AI_TURN_REQUEST_TIMEOUT_MS = 120_000;
const aiSessionDetailRequests = new Map<string, Promise<ServerAiSession>>();

export interface ServerAiTranscriptPage {
  limit: number;
  count: number;
  total_count?: number;
  has_more: boolean;
  next_before_cursor?: string;
  next_before_message_id?: string;
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
   * ISO timestamp the server marked this message hidden (folded) — e.g. once
   * the owning Goal is abandoned/completed. Absent means still visible.
   * Matches `hidden_at` from server Task 8.
   */
  hidden_at?: string;
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
});

export interface ServerAiSession {
  session_id: string;
  kind: 'ai';
  user_id: string;
  device_id: string;
  status: 'creating' | 'active' | 'idle' | 'running' | 'paused' | 'closed' | 'error';
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
  last_agent_event_seq?: number;
  project_path?: string;
  mode: 'chat' | 'vibe' | 'review' | 'agent';
  purpose?: 'chat' | 'goal';
  goal_summary?: ServerGoalSummary;
  title?: string;
  objective?: string;
  model?: string;
  provider?: 'codex' | 'claude' | 'claudecode' | 'opencode';
  tool?: 'codex' | 'claude' | 'claudecode' | 'opencode';
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
  active_execution_profile?: {
    version: number;
    provider?: string;
    model?: string;
    effort?: string;
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
    source?: {
      provider?: string;
      model?: string;
      effort?: string;
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
  last_command?: string;
  last_command_at?: string;
  recent_commands?: Array<{
    id: string;
    command: string;
    timestamp: string;
    created_at: string;
    exit_code?: number | null;
  }>;
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
  options?: { limit?: number; before?: string; refresh?: boolean },
): Promise<ServerAiMessagesPageResponse> => {
  const query = new URLSearchParams();
  if (options?.limit) query.set('limit', String(options.limit));
  if (options?.before) query.set('before', options.before);
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
  provider?: 'codex' | 'claude' | 'claudecode' | 'opencode';
  tool?: 'codex' | 'claude' | 'claudecode' | 'opencode';
  risk?: 'low' | 'medium' | 'high';
  effort?: string;
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
    expected_model_config_version: number;
  }>,
): Promise<ServerAiSession> =>
  apiPatch<ServerAiSession>(`/api/ai/sessions/${sessionId}`, input);

export const deleteAiSession = (sessionId: string): Promise<{ status: string; session_id: string }> =>
  apiFetch<{ status: string; session_id: string }>(`/api/ai/sessions/${sessionId}`, { method: 'DELETE' });

// Terminal Sessions

export const fetchTerminalSessions = (): Promise<ServerTerminalSession[]> =>
  apiGet<ServerTerminalSession[]>('/api/terminal/sessions');

export const createTerminalSession = (input: {
  device_id: string;
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
}): Promise<ServerTerminalSession> =>
  apiPost<ServerTerminalSession>('/api/terminal/sessions', input);

export const closeTerminalSession = (sessionId: string): Promise<ServerTerminalSession> =>
  apiPost(`/api/terminal/sessions/${sessionId}/close`);

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
