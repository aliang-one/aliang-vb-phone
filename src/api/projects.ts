import { apiFetch, apiGet, apiPost, apiPatch } from './client';
import type { ServerAiSession } from './sessions';

export interface ServerProject {
  id: string;
  project_id: string;
  user_id: string;
  device_id: string;
  name: string;
  path: string;
  branch?: string;
  language?: string;
  description?: string;
  status: 'active' | 'idle' | 'error' | 'fresh';
  package_manager?: string;
  is_git_repo?: boolean;
  file_count?: number;
  git_changed_count?: number;
  detected_ports?: number[];
  source_tools?: string[];
  last_active_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ServerProjectDetail extends ServerProject {
  ai_sessions: ServerAiSession[];
}

export interface ServerProjectFile {
  project_id: string;
  device_id: string;
  path: string;
  name: string;
  kind: 'file' | 'directory';
  size_bytes?: number;
  modified_at?: string;
  language?: string;
  summary?: string;
}

export interface ServerProjectFileList {
  project_id: string;
  device_id: string;
  path: string;
  entries: ServerProjectFile[];
  truncated: boolean;
  generated_at: string;
}

export interface ServerProjectFileContent {
  project_id: string;
  device_id: string;
  path: string;
  content: string;
  encoding: 'utf8' | 'base64' | string;
  mime_type?: string;
  size_bytes?: number;
  modified_at?: string;
  truncated: boolean;
}

const queryString = (params: Record<string, string | number | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
};

export const fetchProjects = (): Promise<ServerProject[]> =>
  apiGet<ServerProject[]>('/api/projects');

export const createProject = (input: {
  device_id: string;
  name?: string;
  path: string;
  branch?: string;
  language?: string;
  description?: string;
  status?: 'active' | 'idle' | 'error' | 'fresh';
  package_manager?: string;
  is_git_repo?: boolean;
  detected_ports?: number[];
  source_tools?: string[];
}): Promise<ServerProject> =>
  apiPost<ServerProject>('/api/projects', input);

export const fetchProject = (projectId: string): Promise<ServerProjectDetail> =>
  apiGet<ServerProjectDetail>(`/api/projects/${projectId}`);

export const updateProject = (
  projectId: string,
  input: Partial<{
    name: string;
    path: string;
    branch: string;
    language: string;
    description: string;
    status: 'active' | 'idle' | 'error' | 'fresh';
    package_manager: string;
    is_git_repo: boolean;
    detected_ports: number[];
    source_tools: string[];
  }>,
): Promise<ServerProject> =>
  apiPatch<ServerProject>(`/api/projects/${projectId}`, input);

export const deleteProject = (projectId: string): Promise<{ status: string; project_id: string }> =>
  apiFetch<{ status: string; project_id: string }>(`/api/projects/${projectId}`, { method: 'DELETE' });

export const fetchDeviceProjects = (deviceId: string): Promise<ServerProject[]> =>
  apiGet<ServerProject[]>(`/api/devices/${deviceId}/projects`);

export const fetchProjectAiSessions = (projectId: string): Promise<ServerAiSession[]> =>
  apiGet<ServerAiSession[]>(`/api/projects/${projectId}/ai-sessions`);

export const fetchProjectFiles = (
  projectId: string,
  path?: string,
  maxEntries = 200,
): Promise<ServerProjectFileList> =>
  apiGet<ServerProjectFileList>(
    `/api/projects/${encodeURIComponent(projectId)}/files${queryString({
      path,
      max_entries: maxEntries,
    })}`,
  );

export const fetchProjectFileContent = (
  projectId: string,
  path: string,
  maxBytes = 128 * 1024,
): Promise<ServerProjectFileContent> =>
  apiGet<ServerProjectFileContent>(
    `/api/projects/${encodeURIComponent(projectId)}/files/content${queryString({
      path,
      max_bytes: maxBytes,
    })}`,
  );

export const scanDeviceProjects = (deviceId: string): Promise<{ status: string; device_id: string }> =>
  apiPost(`/api/devices/${deviceId}/scan`);
