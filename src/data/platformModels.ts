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
  detectedPorts: number[];
  sourceTools?: string[];
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

export interface AgentToolInfo {
  id: string;
  name?: string;
  command?: string;
  path?: string;
  available?: boolean;
  description?: string;
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

export interface VibeCodingRun {
  id: string;
  title: string;
  deviceId: string;
  projectId: string;
  directory: string;
  status: VibeStatus;
  objective: string;
  model: string;
  projectBudget?: AgentBudgetInfo;
  timeLimitMinutes: number;
  elapsedMinutes: number;
  risk: 'low' | 'medium' | 'high';
  currentStep: string;
  branch: string;
  updatedAt: string;
  previewId?: string;
  suggestions: string[];
  transcript: AgentMessage[];
  events: AgentEvent[];
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
