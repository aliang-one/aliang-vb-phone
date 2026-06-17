import { apiFetch, apiGet, apiPatch, apiPost } from './client';

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
  provider?: 'auto' | 'codex' | 'claude' | 'claudecode';
  tool?: 'auto' | 'codex' | 'claude' | 'claudecode';
  risk?: 'low' | 'medium' | 'high';
  current_step?: string;
  branch?: string;
  transcript?: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    mode?: 'voice' | 'text' | 'action';
    content: string;
    timestamp: string;
  }>;
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
  last_message?: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    mode?: 'voice' | 'text' | 'action';
    content: string;
    timestamp: string;
  };
  created_at: string;
  last_active_at: string;
  closed_at?: string;
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

export const fetchAiSession = (sessionId: string): Promise<ServerAiSession> =>
  apiGet<ServerAiSession>(`/api/ai/sessions/${sessionId}`);

export const createAiSession = (input: {
  device_id: string;
  project_id?: string;
  project_path?: string;
  mode?: 'chat' | 'vibe' | 'review' | 'agent';
  title?: string;
  objective?: string;
  model?: string;
  provider?: 'auto' | 'codex' | 'claude' | 'claudecode';
  tool?: 'auto' | 'codex' | 'claude' | 'claudecode';
  risk?: 'low' | 'medium' | 'high';
}): Promise<ServerAiSession> =>
  apiPost<ServerAiSession>('/api/ai/sessions', input);

export const sendAiMessage = (
  sessionId: string,
  content: string,
  attachments: unknown[] = [],
  mode: 'voice' | 'text' = 'text',
): Promise<{ message_id: string; status: string }> =>
  apiPost(`/api/ai/sessions/${sessionId}/messages`, { content, attachments, mode });

export const stopAiSession = (sessionId: string): Promise<{ status: string; session?: ServerAiSession }> =>
  apiPost(`/api/ai/sessions/${sessionId}/stop`);

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
    risk: 'low' | 'medium' | 'high';
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
