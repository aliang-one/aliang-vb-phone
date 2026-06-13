import { apiGet, apiPost } from './client';

export interface ServerAiSession {
  session_id: string;
  kind: 'ai';
  user_id: string;
  device_id: string;
  status: 'creating' | 'active' | 'closed' | 'error';
  project_path?: string;
  mode: 'chat' | 'vibe' | 'review' | 'agent';
  title?: string;
  objective?: string;
  model?: string;
  risk?: 'low' | 'medium' | 'high';
  current_step?: string;
  branch?: string;
  transcript: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    mode?: 'voice' | 'text' | 'action';
    content: string;
    timestamp: string;
  }>;
  events: Array<{
    id: string;
    type: 'command' | 'file' | 'test' | 'preview' | 'approval' | 'status';
    title: string;
    detail: string;
    status: 'done' | 'running' | 'waiting' | 'failed';
    timestamp: string;
  }>;
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
}

// AI Sessions

export const fetchAiSessions = (): Promise<ServerAiSession[]> =>
  apiGet<ServerAiSession[]>('/api/ai/sessions');

export const fetchAiSession = (sessionId: string): Promise<ServerAiSession> =>
  apiGet<ServerAiSession>(`/api/ai/sessions/${sessionId}`);

export const createAiSession = (input: {
  device_id: string;
  project_path?: string;
  mode?: 'chat' | 'vibe' | 'review' | 'agent';
  title?: string;
  objective?: string;
  model?: string;
  risk?: 'low' | 'medium' | 'high';
}): Promise<ServerAiSession> =>
  apiPost<ServerAiSession>('/api/ai/sessions', input);

export const sendAiMessage = (
  sessionId: string,
  content: string,
  attachments: unknown[] = []
): Promise<{ message_id: string; status: string }> =>
  apiPost(`/api/ai/sessions/${sessionId}/messages`, { content, attachments });

export const stopAiSession = (sessionId: string): Promise<{ status: string }> =>
  apiPost(`/api/ai/sessions/${sessionId}/stop`);

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
