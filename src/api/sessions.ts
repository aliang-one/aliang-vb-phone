import {
  ApiResponseError,
  apiFetch,
  apiGet,
  apiPatch,
  apiPost,
} from './client';

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
}

export interface ServerAiSession {
  session_id: string;
  kind: 'ai';
  user_id: string;
  device_id: string;
  status: 'creating' | 'active' | 'idle' | 'running' | 'paused' | 'closed' | 'error';
  project_path?: string;
  mode: 'chat' | 'vibe' | 'review' | 'agent';
  title?: string;
  objective?: string;
  model?: string;
  provider?: 'codex' | 'claude' | 'claudecode';
  tool?: 'codex' | 'claude' | 'claudecode';
  risk?: 'low' | 'medium' | 'high';
  /**
   * Reasoning effort. Provider-specific:
   *   codex  → none | minimal | low | medium | high | xhigh
   *   claude → none | low | medium | high | max
   * Forwarded to the agent; codex applies it as a `<base>-<effort>` model
   * suffix. Empty/omit = no effort override (CLI/gateway default).
   */
  effort?: string;
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

export const fetchAiSession = (
  sessionId: string,
  options?: { refresh?: boolean },
): Promise<ServerAiSession> =>
  apiGet<ServerAiSession>(
    `/api/ai/sessions/${sessionId}${
      options?.refresh ? '?refresh=true' : ''
    }`,
    // The detail GET may trigger a server→agent round trip: the server waits up
    // to AGENT_REQUEST_TIMEOUT_MS (12s) for the agent to answer ai.session.detail.
    // The default 8s request timeout would abort BEFORE the agent responds,
    // stranding the chat on a timeout even though the server eventually got the
    // history. Allow ~15s so the in-band response (not just the WS push) can
    // carry the freshly-fetched transcript.
    { timeoutMs: 15_000 },
  );

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
  project_id?: string;
  project_path?: string;
  mode?: 'chat' | 'vibe' | 'review' | 'agent';
  title?: string;
  objective?: string;
  model?: string;
  provider?: 'codex' | 'claude' | 'claudecode';
  tool?: 'codex' | 'claude' | 'claudecode';
  risk?: 'low' | 'medium' | 'high';
  effort?: string;
}): Promise<ServerAiSession> =>
  apiPost<ServerAiSession>('/api/ai/sessions', input);

export const sendAiMessage = (
  sessionId: string,
  content: string,
  attachments: unknown[] = [],
  mode: 'voice' | 'text' = 'text',
): Promise<{ message_id: string; status: string }> =>
  apiPost(`/api/ai/sessions/${sessionId}/messages`, { content, attachments, mode });

export const sendAiSteer = (
  sessionId: string,
  content: string,
  attachments: unknown[] = [],
  mode: 'voice' | 'text' = 'text',
): Promise<{ message_id: string; status: string }> =>
  apiPost(`/api/ai/sessions/${sessionId}/steers`, { content, attachments, mode });

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
