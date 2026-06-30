import type {
  AgentCommandInfo,
  Device,
  PreviewLink,
  Project,
  VibeCodingRun,
} from '../data/platformModels';
import type { PlatformTransportEvent } from '../services/platformTransport';

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

export type AgentProvider = 'claude_code' | 'codex';

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
  | 'client_response';

export interface ApprovalOption {
  id: string;
  label: string;
  description?: string;
  response?: string;
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
  files?: string[];
  options?: ApprovalOption[];
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
  resolvedAt?: string;
}

export interface PushNotificationItem {
  id: string;
  type: 'approval' | 'completed' | 'error' | 'device_offline';
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
  previewBlocked?: { reason: 'too_large' | 'binary'; sizeBytes?: number };
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

interface StartAgentInput {
  deviceId: string;
  projectId: string;
  directory: string;
  provider: AgentProvider;
  objective: string;
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
}

interface BindDeviceResult {
  ok: boolean;
  deviceId?: string;
  error?: string;
}

export interface ControlCenterState {
  // Connection state
  wsConnected: boolean;
  serverMode: boolean;
  // Freshness metadata (L5): lets screens surface "data may be stale" and
  // trigger a per-domain refresh instead of assuming the resident copy is live.
  lastSyncedAt: number | null;
  stale: boolean;
  // Data
  devices: Device[];
  projects: Project[];
  vibeRuns: VibeCodingRun[];
  /**
   * The AI session currently on the chat screen (set on focus, cleared on
   * blur/unmount). The idle demoter never clears this session's resident
   * detail, so viewing a conversation never triggers a mid-view reload.
   * Client-side only; never persisted or carried in a server snapshot.
   */
  currentlyViewedSessionId?: string;
  previewLinks: PreviewLink[];
  terminalSessions: TerminalSession[];
  terminalCommandHistory: Record<string, TerminalCommandHistoryItem[]>;
  scanResults: ProjectScanResult[];
  approvals: ApprovalRequest[];
  notifications: PushNotificationItem[];
  events: UnifiedEvent[];
  projectFiles: ProjectFileEntry[];
  // Actions
  initializeFromServer: (token?: string) => Promise<void>;
  refreshFromServer: () => Promise<void>;
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
    }>,
  ) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  loadProjectFiles: (projectId: string, path?: string, opts?: { force?: boolean }) => Promise<void>;
  loadProjectFileContent: (projectId: string, path: string, opts?: { force?: boolean }) => Promise<void>;
  dropFileContent: (projectId: string, path: string) => void;
  createTerminalSession: (
    deviceId: string,
    directory?: string,
  ) => Promise<string>;
  executeTerminalCommand: (terminalId: string, command: string) => void;
  clearTerminal: (terminalId: string) => void;
  stopTerminal: (terminalId: string) => Promise<void>;
  interruptTerminal: (terminalId: string) => void;
  loadTerminalCommandHistory: (
    terminalId: string,
    deviceId?: string,
  ) => Promise<void>;
  startAgentSession: (input: StartAgentInput) => Promise<string>;
  loadAgentSessionDetail: (
    sessionId: string,
    options?: { refresh?: boolean },
  ) => Promise<void>;
  loadEarlierAgentMessages: (sessionId: string) => Promise<void>;
  /**
   * On-demand `/`-command discovery for a session. Auto path (ToolsMenu open,
   * `force=false`) is 1h-gated + in-flight-deduped (cheap). Manual path (input
   * refresh button, `force=true`) bypasses the 1h gate. The server applies a
   * 10s floor on top. Returns the effective command list (custom/user/project +
   * builtin baseline) and mirrors it onto the project's availableCommands.
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
    }>,
  ) => Promise<void>;
  deleteAgentSession: (sessionId: string) => Promise<void>;
  appendAgentMessage: (
    sessionId: string,
    content: string,
    mode: 'voice' | 'text',
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
    options?: { selectedOptionId?: string; message?: string },
  ) => Promise<void>;
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
}
