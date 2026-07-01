import { apiFetch, apiGet, apiPost, apiPatch } from './client';
import type { ServerAiSession } from './sessions';
import type { AgentCommandInfo } from '../data/platformModels';
import type { ProjectProviderModelConfig } from './modelConfig';
// Reuse the device-level approval type aliases — they describe the same enum
// values the server now carries on the project. Do not redefine here.
import type { ApprovalScheme, ApprovalDecision } from './devices';

/** Server-side approval-policy descriptor carried on every project payload. */
export interface ServerApprovalPolicy {
  scheme: ApprovalScheme;
  version: number;
  hash: string;
}

/** A single rule in the resolved approval policy (read-only on the client). */
export interface ServerApprovalRule {
  id: string;
  match: {
    tool?: string[];
    command_regex?: string;
  };
  decision: ApprovalDecision;
  reason?: string;
}

/** Full resolved policy returned by GET /api/projects/:id/approval-policy. */
export interface ServerProjectApprovalPolicy {
  scheme: ApprovalScheme;
  version: number;
  hash: string;
  rules: ServerApprovalRule[];
  default_decision: ApprovalDecision;
}

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
  /** Effective `/`-command surface (project > user > builtin), server-computed. */
  available_commands?: AgentCommandInfo[];
  /** Project-scoped approval policy (Phase B): scheme + version + hash. */
  approval_policy?: ServerApprovalPolicy;
  /** Project-scoped model/effort choices per provider tab. */
  model_config?: ProjectProviderModelConfig;
  /** Legacy single-provider override; kept for older server payloads. */
  provider?: 'codex' | 'claude_code' | 'opencode' | null;
  model?: string | null;
  effort?: string | null;
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
  /** agent 上报的 git 状态（clean/modified/added/deleted）；缺省→clean。 */
  status?: string;
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
    approval_policy: {
      scheme?: ApprovalScheme;
      custom_rule_overrides?: Record<string, ApprovalDecision>;
    };
  }>,
): Promise<ServerProject> =>
  apiPatch<ServerProject>(`/api/projects/${projectId}`, input);

// Switch a project's approval-policy scheme (balanced / allow_all / custom).
// The server stores the choice, bumps version + rehashes, and pushes
// `project.settings.updated` to the agent so it refetches + re-evaluates.
export const patchProjectCustomPolicy = (
  projectId: string,
  customRuleOverrides: Record<string, ApprovalDecision>,
): Promise<ServerProject> =>
  apiPatch<ServerProject>(`/api/projects/${projectId}/approval-policy/custom`, {
    custom_rule_overrides: customRuleOverrides,
  });

// Fetch the fully-resolved approval policy for the custom-rule editor
// (开关微调): the balanced preset's rules with per-rule decisions.
export const fetchProjectApprovalPolicy = (
  projectId: string,
): Promise<ServerProjectApprovalPolicy> =>
  apiGet<ServerProjectApprovalPolicy>(`/api/projects/${projectId}/approval-policy`);

export const deleteProject = (projectId: string): Promise<{ status: string; project_id: string }> =>
  apiFetch<{ status: string; project_id: string }>(`/api/projects/${projectId}`, { method: 'DELETE' });

export const fetchDeviceProjects = (deviceId: string): Promise<ServerProject[]> =>
  apiGet<ServerProject[]>(`/api/devices/${deviceId}/projects`);

export interface ProjectAiSessionList {
  sessions: ServerAiSession[];
  total_count: number;
}

export const fetchProjectAiSessions = (
  projectId: string,
  limit?: number,
): Promise<ProjectAiSessionList> =>
  apiGet<ProjectAiSessionList>(
    `/api/projects/${projectId}/ai-sessions${
      limit && limit > 0 ? `?limit=${limit}` : ''
    }`,
  );

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

/** One file's uncommitted change with its unified-diff text (agent-reported). */
export interface WorkingTreeFileDiff {
  path: string;
  status: 'modified' | 'added' | 'deleted';
  diff: string;
  added?: number;
  removed?: number;
}

export interface WorkingTreeDiffResult {
  entries: WorkingTreeFileDiff[];
  path?: string;
}

/** Live working-tree diff (staged + unstaged + untracked) for change review. */
export const fetchWorkingTreeDiff = (
  projectId: string,
): Promise<WorkingTreeDiffResult> =>
  apiGet<WorkingTreeDiffResult>(
    `/api/projects/${encodeURIComponent(projectId)}/working-tree-diff`,
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
