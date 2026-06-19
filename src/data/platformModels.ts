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

export type AgentCommandScope = 'builtin' | 'user' | 'project';

/**
 * A discoverable `/`-style command for an AI coding tool (e.g. a Claude Code
 * slash command). `name` is the bare command without the leading slash — the UI
 * prepends `/`. The desktop agent is the source of truth: it introspects
 * on-disk command files (`.claude/commands/*.md`) for claude-code and ships a
 * curated built-in baseline for commands the CLIs don't enumerate.
 */
export interface AgentCommandInfo {
  name: string;
  description?: string;
  argHint?: string;
  scope?: AgentCommandScope;
}

export interface AgentToolInfo {
  id: string;
  name?: string;
  command?: string;
  path?: string;
  available?: boolean;
  description?: string;
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
  /** Reasoning effort (provider-specific); undefined = no override. */
  effort?: string;
  /**
   * Authoritative AI provider, derived from the server session's
   * `provider`/`tool` (see normalizeProvider). Drives provider-aware effort
   * presets and codex-vs-claude rendering. Undefined only for legacy snapshots
   * that lack the field — callers apply a sensible default.
   */
  provider?: 'codex' | 'claude_code';
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
  previewId?: string;
  transcriptCount?: number;
  transcriptPage?: AgentTranscriptPage;
  eventCount?: number;
  /** Distinct files the agent wrote/edited during the current/most-recent run. */
  filesTouchedCount?: number;
  /** git working-tree change count for the project dir during the current/most-recent run. */
  gitChangedCount?: number;
  lastMessage?: AgentMessage;
  detailLoadedAt?: string;
  /**
   * Server `detail_refresh.status` from the last single-session fetch — lets the
   * chat screen distinguish "genuinely no messages" from "agent offline /
   * fetch failed, history unreachable". Undefined for list-snapshot sessions
   * (the summary payload omits it). See ServerAiSession.detail_refresh.
   */
  detailRefreshStatus?: string;
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
  index?: number;
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
