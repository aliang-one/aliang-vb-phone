import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  AgentEvent,
  Device,
  PreviewLink,
  Project,
  VibeCodingRun,
  VibeStatus,
} from '../data/platformModels';
import { terminalOutputHandlers } from '../components/terminal/TerminalEmulator';
import {
  platformTransport,
  type PlatformAiSessionSnapshot,
  type PlatformApprovalSnapshot,
  type PlatformDeviceSnapshot,
  type PlatformNotificationSnapshot,
  type PlatformProjectFileContentSnapshot,
  type PlatformProjectFileListSnapshot,
  type PlatformProjectSnapshot,
  type PlatformPreviewSnapshot,
  type PlatformRealtimeEventSnapshot,
  type PlatformTerminalSessionSnapshot,
  type PlatformTransportEvent,
} from '../services/platformTransport';

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
  | 'git_push';

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
  timeLimitMinutes: number;
}

interface BindDeviceInput {
  name: string;
  os: string;
  host: string;
  location: string;
  pairingCode: string;
}

interface BindDeviceResult {
  ok: boolean;
  deviceId?: string;
  error?: string;
}

interface ControlCenterState {
  // Connection state
  wsConnected: boolean;
  serverMode: boolean;
  // Data
  devices: Device[];
  projects: Project[];
  vibeRuns: VibeCodingRun[];
  previewLinks: PreviewLink[];
  terminalSessions: TerminalSession[];
  scanResults: ProjectScanResult[];
  approvals: ApprovalRequest[];
  notifications: PushNotificationItem[];
  events: UnifiedEvent[];
  projectFiles: ProjectFileEntry[];
  // Actions
  initializeFromServer: (token?: string) => Promise<void>;
  disconnectFromServer: () => void;
  resetSessionData: () => void;
  handleTransportEvent: (event: PlatformTransportEvent) => void;
  bindDevice: (input: BindDeviceInput) => Promise<BindDeviceResult>;
  renameDevice: (deviceId: string, name: string) => Promise<BindDeviceResult>;
  scanDeviceProjects: (deviceId: string) => Promise<void>;
  createProject: (input: {
    deviceId: string;
    path: string;
    name?: string;
    language?: string;
    description?: string;
  }) => Promise<string>;
  updateProject: (projectId: string, input: Partial<{
    name: string;
    path: string;
    branch: string;
    language: string;
    description: string;
    status: 'active' | 'idle' | 'error' | 'fresh';
  }>) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  loadProjectFiles: (projectId: string, path?: string) => Promise<void>;
  loadProjectFileContent: (projectId: string, path: string) => Promise<void>;
  createTerminalSession: (deviceId: string, directory?: string) => Promise<string>;
  executeTerminalCommand: (terminalId: string, command: string) => void;
  clearTerminal: (terminalId: string) => void;
  stopTerminal: (terminalId: string) => Promise<void>;
  startAgentSession: (input: StartAgentInput) => Promise<string>;
  pauseAgentSession: (sessionId: string) => Promise<void>;
  resumeAgentSession: (sessionId: string) => Promise<void>;
  terminateAgentSession: (sessionId: string) => Promise<void>;
  updateAgentSession: (sessionId: string, input: Partial<{
    title: string;
    objective: string;
    status: 'idle' | 'running' | 'paused' | 'error' | 'closed';
    currentStep: string;
    risk: 'low' | 'medium' | 'high';
  }>) => Promise<void>;
  deleteAgentSession: (sessionId: string) => Promise<void>;
  appendAgentMessage: (
    sessionId: string,
    content: string,
    mode: 'voice' | 'text',
  ) => Promise<void>;
  resolveApproval: (approvalId: string, decision: 'approved' | 'denied') => Promise<void>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  createPtySession: (deviceId: string, options?: { cwd?: string; cols?: number; rows?: number }) => Promise<string>;
  sendTerminalInput: (sessionId: string, data: string, encoding?: string) => void;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => void;
  closeTerminalSession: (sessionId: string) => Promise<void>;
}

// --- Helpers ---

const nowTime = () =>
  new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

const shortTime = () =>
  new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const line = (kind: TerminalLineKind, content: string): TerminalLine => ({
  id: createId('line'),
  kind,
  content,
  timestamp: nowTime(),
});

const event = (
  type: UnifiedEventType,
  title: string,
  detail: string,
  status: UnifiedEventStatus,
  meta: Partial<UnifiedEvent> = {},
): UnifiedEvent => ({
  id: createId('evt'),
  type,
  title,
  detail,
  status,
  timestamp: nowTime(),
  ...meta,
});

// --- Server → Client adapters ---

function platformDeviceToClient(sd: PlatformDeviceSnapshot): Device {
  return {
    id: sd.deviceId,
    name: sd.name,
    status: sd.status === 'online' ? 'online' : sd.status === 'offline' ? 'offline' : 'offline',
    location: sd.location ?? 'Remote device',
    os: sd.platform,
    host: sd.host ?? sd.uniqueCode ?? sd.deviceId,
    cpuLoad: sd.cpuLoad ?? 0,
    memLoad: sd.memLoad ?? 0,
    battery: sd.battery,
    authorizedDirectories: sd.authorizedDirectories,
    activePorts: sd.activePorts,
    projectIds: sd.projectIds,
    activeSessionIds: [],
    lastSeen: sd.lastSeenAt ?? 'unknown',
    uniqueCode: sd.uniqueCode,
    agentVersion: sd.agentVersion,
    remoteTerminalEnabled: sd.remoteTerminalEnabled,
    aiControlEnabled: sd.aiControlEnabled,
    capabilities: sd.capabilities,
    tools: sd.tools.map(tool => ({
      id: tool.id,
      name: tool.name,
      command: tool.command,
      path: tool.path,
      available: tool.available,
      description: tool.description,
    })),
    history: sd.history.map(entry => ({
      tool: entry.tool,
      path: entry.path,
      exists: entry.exists,
      file_count: entry.file_count,
      total_size: entry.total_size,
      updated_at: entry.updated_at,
    })),
    createdAt: sd.createdAt,
  };
}

function serverProjectToClient(sp: PlatformProjectSnapshot): Project {
  return {
    id: sp.project_id || sp.id,
    name: sp.name,
    status: sp.status === 'error' ? 'error' : sp.status === 'fresh' ? 'active' : sp.status,
    branch: sp.branch ?? 'main',
    lastDeploy: sp.last_active_at ?? sp.updated_at,
    language: sp.language ?? 'Unknown',
    description: sp.description ?? '',
    path: sp.path ?? '',
    deviceId: sp.device_id,
    packageManager: sp.package_manager,
    isGitRepo: sp.is_git_repo,
    detectedPorts: sp.detected_ports ?? [],
    sourceTools: sp.source_tools ?? [],
  };
}

function serverAiSessionToVibeRun(session: PlatformAiSessionSnapshot, _devices: Device[], projects: Project[]): VibeCodingRun {
  const project = projects.find(p => p.path === session.project_path && p.deviceId === session.device_id)
    ?? projects.find(p => p.path === session.project_path)
    ?? projects.find(p => p.id === session.project_path);
  const model = session.model ?? session.mode;

  return {
    id: session.session_id,
    title: session.title ?? session.objective?.slice(0, 44) ?? `AI ${session.mode} session`,
    deviceId: session.device_id,
    projectId: project?.id ?? '',
    directory: session.project_path ?? '',
    status: mapSessionStatus(session.status),
    objective: session.objective ?? '',
    model,
    timeLimitMinutes: 60,
    elapsedMinutes: 0,
    risk: session.risk ?? 'medium',
    currentStep: session.current_step ?? '',
    branch: session.branch ?? `agent/${session.session_id}`,
    updatedAt: session.last_active_at ?? nowTime(),
    suggestions: ['Ask for plan', 'Open terminal', 'Pause session'],
    transcript: (session.transcript ?? []).map(t => ({
      id: t.id,
      role: t.role,
      mode: t.mode as 'voice' | 'text' | 'action' | undefined,
      content: t.content,
      timestamp: t.timestamp,
    })),
    events: (session.events ?? []).map(e => ({
      id: e.id,
      type: e.type as AgentEvent['type'],
      title: e.title,
      detail: e.detail,
      status: e.status as AgentEvent['status'],
      timestamp: e.timestamp,
    })),
  };
}

function mapSessionStatus(status: string): VibeStatus {
  switch (status) {
    case 'active': return 'running';
    case 'creating': return 'running';
    case 'paused': return 'paused';
    case 'error': return 'failed';
    case 'closed': return 'completed';
    default: return 'idle';
  }
}

function serverApprovalToClient(sa: PlatformApprovalSnapshot): ApprovalRequest {
  return {
    id: sa.id,
    kind: (sa.kind as ApprovalKind) ?? 'dangerous_command',
    title: sa.title,
    summary: sa.summary,
    deviceId: sa.device_id,
    projectId: sa.project_id,
    sessionId: sa.session_id,
    terminalId: sa.terminal_id,
    command: sa.command,
    files: sa.files,
    risk: sa.risk,
    status: sa.status as ApprovalRequest['status'],
    createdAt: sa.created_at,
    resolvedAt: sa.resolved_at,
  };
}

function mapTerminalStatus(status: PlatformTerminalSessionSnapshot['status']): TerminalSessionStatus {
  switch (status) {
    case 'creating':
      return 'idle';
    case 'active':
      return 'running';
    case 'error':
      return 'failed';
    case 'closed':
      return 'completed';
    default:
      return 'idle';
  }
}

function serverTerminalSessionToClient(session: PlatformTerminalSessionSnapshot): TerminalSession {
  return {
    id: session.session_id,
    deviceId: session.device_id,
    directory: session.cwd ?? '~',
    shell: session.shell ?? 'zsh',
    status: mapTerminalStatus(session.status),
    lines: [
      line(
        'system',
        `Terminal session restored from platform state (${session.status}).`,
      ),
    ],
    createdAt: session.created_at,
    updatedAt: session.last_active_at,
  };
}

function serverPreviewToClient(preview: PlatformPreviewSnapshot): PreviewLink {
  const access = ['private', 'team', 'public'].includes(preview.access)
    ? preview.access as PreviewLink['access']
    : 'private';
  return {
    id: preview.id,
    sessionId: preview.sessionId,
    port: preview.port,
    shortUrl: preview.shortUrl,
    targetUrl: preview.targetUrl,
    expiresIn: preview.expiresIn ?? '',
    access,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const payloadString = (payload: Record<string, unknown> | undefined, key: string) => {
  const value = payload?.[key];
  return typeof value === 'string' ? value : undefined;
};

function primitivePayload(payload: unknown): UnifiedEvent['payload'] {
  if (!isRecord(payload)) return undefined;
  const entries = Object.entries(payload)
    .filter(([, value]) =>
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean',
    )
    .slice(0, 8);
  return entries.length ? Object.fromEntries(entries) as UnifiedEvent['payload'] : undefined;
}

function realtimeMessageTypeToEventType(
  messageType: string,
  payload: Record<string, unknown> | undefined,
): UnifiedEventType {
  if (messageType === 'device.updated') {
    const device = isRecord(payload?.device) ? payload.device : undefined;
    return payloadString(device, 'status') === 'offline' ? 'device.offline' : 'device.bound';
  }
  if (messageType === 'project.updated') return 'project.updated';
  if (messageType === 'projects.updated') return 'project.scan.completed';
  if (messageType === 'ai.delta') return 'agent.delta';
  if (messageType === 'ai.done') return 'agent.session.completed';
  if (messageType === 'ai.error') return 'agent.session.failed';
  if (messageType === 'ai.session.created' || messageType === 'ai.session.updated') {
    return 'agent.session.started';
  }
  if (messageType === 'ai.session.deleted') return 'agent.session.terminated';
  if (messageType === 'ai.sessions.updated') return 'agent.session.started';
  if (messageType === 'terminal.output') return 'terminal.output';
  if (messageType.startsWith('terminal.')) return 'command.completed';
  if (messageType === 'approval.requested') return 'approval.requested';
  if (messageType === 'preview.ready') return 'agent.delta';
  return 'platform.event';
}

function realtimeMessageStatus(messageType: string): UnifiedEventStatus {
  if (messageType === 'ai.error' || messageType === 'terminal.error') return 'failed';
  if (messageType === 'approval.requested') return 'waiting';
  if (messageType === 'ai.delta' || messageType === 'terminal.output') return 'running';
  return 'done';
}

function realtimeMessageTitle(
  messageType: string,
  payload: Record<string, unknown> | undefined,
): string {
  const project = isRecord(payload?.project) ? payload.project : undefined;
  const device = isRecord(payload?.device) ? payload.device : undefined;
  const approval = isRecord(payload?.approval) ? payload.approval : undefined;
  if (messageType === 'project.updated') return payloadString(project, 'name') ?? 'Project updated';
  if (messageType === 'device.updated') return payloadString(device, 'name') ?? 'Device updated';
  if (messageType === 'approval.requested') return payloadString(approval, 'title') ?? 'Approval requested';
  if (messageType === 'ai.done') return 'VibeCoding completed';
  if (messageType === 'ai.error') return 'VibeCoding failed';
  if (messageType === 'preview.ready') return 'Preview ready';
  return messageType;
}

function realtimeMessageDetail(
  message: PlatformRealtimeEventSnapshot,
  payload: Record<string, unknown> | undefined,
): string {
  const project = isRecord(payload?.project) ? payload.project : undefined;
  const device = isRecord(payload?.device) ? payload.device : undefined;
  const approval = isRecord(payload?.approval) ? payload.approval : undefined;
  return (
    payloadString(payload, 'detail') ??
    payloadString(payload, 'delta') ??
    payloadString(payload, 'error') ??
    payloadString(project, 'path') ??
    payloadString(device, 'host') ??
    payloadString(approval, 'summary') ??
    message.direction
  );
}

function realtimeEventToUnifiedEvent(message: PlatformRealtimeEventSnapshot): UnifiedEvent {
  const payload = isRecord(message.payload) ? message.payload : undefined;
  return {
    id: message.id,
    type: realtimeMessageTypeToEventType(message.message_type, payload),
    title: realtimeMessageTitle(message.message_type, payload),
    detail: realtimeMessageDetail(message, payload),
    status: realtimeMessageStatus(message.message_type),
    deviceId: message.device_id,
    sessionId: message.session_id,
    timestamp: message.created_at,
    payload: primitivePayload(message.payload),
  };
}

function serverNotificationToClient(
  notification: PlatformNotificationSnapshot,
): PushNotificationItem {
  return {
    id: notification.notification_id || notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    deviceId: notification.device_id,
    sessionId: notification.session_id,
    approvalId: notification.approval_id,
    read: Boolean(notification.read),
    createdAt: notification.created_at,
  };
}

function upsertNotification(
  list: PushNotificationItem[],
  item: PushNotificationItem,
): PushNotificationItem[] {
  return [
    item,
    ...list.filter(existing => existing.id !== item.id),
  ]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 120);
}

const fileNameFromPath = (pathValue: string) =>
  pathValue.split(/[\\/]/).filter(Boolean).pop() ?? pathValue;

const parentPathOf = (pathValue: string) => {
  const normalized = pathValue.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return normalized;
  const prefix = normalized.startsWith('/') ? '/' : '';
  return `${prefix}${parts.slice(0, -1).join('/')}`;
};

const formatBytes = (bytes?: number) => {
  if (bytes === undefined || !Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
};

function serverProjectFileToClient(
  projectId: string,
  directoryPath: string,
  file: PlatformProjectFileListSnapshot['entries'][number],
): ProjectFileEntry {
  const isFolder = file.kind === 'directory';
  return {
    id: `${projectId}:${file.path}`,
    projectId,
    deviceId: file.device_id,
    directoryPath,
    path: file.path,
    name: file.name || fileNameFromPath(file.path),
    kind: isFolder ? 'folder' : 'file',
    status: 'clean',
    language: file.language ?? (isFolder ? 'Folder' : 'File'),
    size: isFolder ? '-' : formatBytes(file.size_bytes),
    sizeBytes: file.size_bytes,
    lastTouched: file.modified_at ?? 'unknown',
    modifiedAt: file.modified_at,
    summary: file.summary ?? (isFolder ? 'Directory' : 'Synced from desktop Agent.'),
  };
}

function serverProjectContentToFileEntry(
  projectId: string,
  content: PlatformProjectFileContentSnapshot,
): ProjectFileEntry {
  return {
    id: `${projectId}:${content.path}`,
    projectId,
    deviceId: content.device_id,
    directoryPath: parentPathOf(content.path),
    path: content.path,
    name: fileNameFromPath(content.path),
    kind: 'file',
    status: 'clean',
    language: content.mime_type ?? 'File',
    size: formatBytes(content.size_bytes),
    sizeBytes: content.size_bytes,
    lastTouched: content.modified_at ?? 'unknown',
    modifiedAt: content.modified_at,
    summary: content.truncated ? 'Loaded preview from desktop Agent. Content was truncated.' : 'Loaded from desktop Agent.',
    content: content.content,
    encoding: content.encoding,
    loadedAt: nowTime(),
    truncated: content.truncated,
  };
}

const activeVibeStatuses: VibeStatus[] = [
  'running',
  'waiting_user',
  'waiting_approval',
  'testing',
  'preview_ready',
  'paused',
];

const mergeIds = (...groups: string[][]): string[] =>
  Array.from(new Set(groups.flat().filter(Boolean)));

const projectBelongsToDevice = (project: Project, device: Device): boolean =>
  project.deviceId === device.id || device.projectIds.includes(project.id);

const attachProjectIds = (
  devices: Device[],
  projects: Project[],
): Device[] =>
  devices.map(device => ({
    ...device,
    projectIds: mergeIds(
      device.projectIds,
      projects
        .filter(project => projectBelongsToDevice(project, device))
        .map(project => project.id),
    ),
  }));

const attachActiveSessionIds = (
  devices: Device[],
  vibeRuns: VibeCodingRun[],
): Device[] => {
  const sessionsByDevice = new Map<string, string[]>();

  for (const run of vibeRuns) {
    if (!activeVibeStatuses.includes(run.status)) continue;
    const existing = sessionsByDevice.get(run.deviceId) ?? [];
    sessionsByDevice.set(run.deviceId, [run.id, ...existing]);
  }

  return devices.map(device => ({
    ...device,
    activeSessionIds: sessionsByDevice.get(device.id) ?? [],
  }));
};

const attachDeviceRelations = (
  devices: Device[],
  projects: Project[],
  vibeRuns: VibeCodingRun[],
): Device[] => attachActiveSessionIds(attachProjectIds(devices, projects), vibeRuns);

const emptySessionData = () => ({
  devices: [],
  projects: [],
  vibeRuns: [],
  previewLinks: [],
  terminalSessions: [],
  scanResults: [],
  approvals: [],
  notifications: [],
  events: [],
  projectFiles: [],
});

// --- Store ---

export const useControlCenterStore = create<ControlCenterState>()(
  persist(
    (set, get) => ({
      // Connection state
      wsConnected: false,
      serverMode: false,

      // Data — initialized empty, populated from server API on platform connection
      devices: [],
      projects: [],
      vibeRuns: [],
      previewLinks: [],
      terminalSessions: [],
      scanResults: [],
      approvals: [],
      notifications: [],
      events: [],
      projectFiles: [],

	      // --- Server initialization ---

		      initializeFromServer: async (token) => {
		        platformTransport.disconnect();
		        set({ ...emptySessionData(), serverMode: true, wsConnected: false });

	        try {
	          const snapshot = await platformTransport.loadSnapshot();
	          const baseDevices = snapshot.devices.map(platformDeviceToClient);
	          const knownDeviceIds = new Set(baseDevices.map(device => device.id));
	          const projects = snapshot.projects
	            .filter(project => knownDeviceIds.has(project.device_id))
	            .map(serverProjectToClient);
	          const vibeRuns = snapshot.aiSessions
	            .filter(session => knownDeviceIds.has(session.device_id))
	            .map(s => serverAiSessionToVibeRun(s, baseDevices, projects));
	          const devices = attachDeviceRelations(baseDevices, projects, vibeRuns);
	          const approvals = snapshot.approvals
	            .filter(approval => knownDeviceIds.has(approval.device_id))
	            .map(serverApprovalToClient);
	          const terminalSessions = snapshot.terminalSessions
	            .filter(session => knownDeviceIds.has(session.device_id))
	            .map(serverTerminalSessionToClient);
	          const knownSessionIds = new Set(vibeRuns.map(session => session.id));
	          const previewLinks = snapshot.previewLinks
	            .filter(preview => knownSessionIds.has(preview.sessionId))
	            .map(serverPreviewToClient);
	          const realtimeEvents = snapshot.realtimeEvents
	            .map(realtimeEventToUnifiedEvent)
	            .filter(item => !item.deviceId || knownDeviceIds.has(item.deviceId))
	            .slice(0, 120);
		          const notifications = snapshot.notifications
		            .map(serverNotificationToClient)
		            .filter(item => !item.deviceId || knownDeviceIds.has(item.deviceId))
		            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
		            .slice(0, 120);
	          const warningEvents = snapshot.warnings.map(detail =>
	            event('command.completed', 'Partial platform sync', detail, 'failed'),
	          );

          set({
            devices,
            projects,
            vibeRuns,
            terminalSessions,
            approvals,
            previewLinks,
            notifications,
            events: [...warningEvents, ...realtimeEvents].slice(0, 120),
          });

          console.log(`[store] Initialized from server: ${devices.length} devices, ${projects.length} projects, ${vibeRuns.length} AI sessions, ${terminalSessions.length} terminals, ${approvals.length} approvals`);

          platformTransport.connect(transportEvent => {
            get().handleTransportEvent(transportEvent);
          }, token);
        } catch (error) {
          console.warn('[store] Failed to initialize from server:', error);
          platformTransport.disconnect();
          set({ wsConnected: false, serverMode: false });
          throw error instanceof Error
            ? error
            : new Error('Unable to connect to the local platform.');
        }
      },

      disconnectFromServer: () => {
        platformTransport.disconnect();
        set({ wsConnected: false, serverMode: false });
      },

      resetSessionData: () => {
        platformTransport.disconnect();
        set({
          ...emptySessionData(),
          wsConnected: false,
          serverMode: false,
        });
      },

      // --- Platform transport event handler ---

      handleTransportEvent: (transportEvent) => {
        switch (transportEvent.type) {
          case 'transport.status':
            set({ wsConnected: transportEvent.status === 'connected' });
            return;

          case 'mobile.connected':
            set({ wsConnected: true });
            return;

          case 'device.updated': {
            const clientDevice = platformDeviceToClient(transportEvent.device);
            set(state => {
              const previous = state.devices.find(d => d.id === clientDevice.id);
              const nextDevice = {
                ...clientDevice,
                projectIds: mergeIds(clientDevice.projectIds, previous?.projectIds ?? []),
                activeSessionIds: previous?.activeSessionIds ?? clientDevice.activeSessionIds,
              };
              const nextDevicesBase = previous
                ? state.devices.map(d => d.id === nextDevice.id ? nextDevice : d)
                : [nextDevice, ...state.devices];
              const nextDevices = attachDeviceRelations(
                nextDevicesBase,
                state.projects,
                state.vibeRuns,
              );
              const nextEvents: UnifiedEvent[] = [];

              if (!previous) {
                nextEvents.push(
                  event('device.bound', 'Device registered', `${nextDevice.name} joined the platform.`, 'done', {
                    deviceId: nextDevice.id,
                  }),
                );
              } else if (previous.status !== 'offline' && nextDevice.status === 'offline') {
                nextEvents.push(
                  event('device.offline', 'Device disconnected', `${nextDevice.name} is no longer reachable.`, 'failed', {
                    deviceId: nextDevice.id,
                  }),
                );
              }

              return {
                devices: nextDevices,
                events: [...nextEvents, ...state.events].slice(0, 120),
              };
            });
            return;
          }

          case 'device.removed':
            set(state => ({
              devices: state.devices.filter(d => d.id !== transportEvent.deviceId),
              events: [
                event('device.offline', 'Device removed', transportEvent.deviceId, 'failed', {
                  deviceId: transportEvent.deviceId,
                }),
                ...state.events,
              ].slice(0, 120),
            }));
            return;

          case 'ai.delta':
            set(state => ({
              vibeRuns: state.vibeRuns.map(run =>
                run.id === transportEvent.sessionId
                  ? {
                      ...run,
                      status: 'running' as VibeStatus,
                      currentStep: transportEvent.currentStep || transportEvent.delta.slice(0, 100) || run.currentStep,
                      updatedAt: 'now',
                      transcript: (() => {
                        const lastMsg = run.transcript[run.transcript.length - 1];
                        const msgId = transportEvent.messageId ?? '';
                        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.id === msgId) {
                          return [
                            ...run.transcript.slice(0, -1),
                            { ...lastMsg, content: lastMsg.content + transportEvent.delta },
                          ];
                        }
                        return [
                          ...run.transcript,
                          {
                            id: msgId || createId('msg'),
                            role: 'assistant' as const,
                            content: transportEvent.delta,
                            timestamp: shortTime(),
                          },
                        ];
                      })(),
                    }
                  : run
              ),
            }));
            return;

          case 'ai.done':
            set(state => {
              const run = state.vibeRuns.find(item => item.id === transportEvent.sessionId);
              const detail = transportEvent.detail || 'VibeCoding session completed.';

              return {
                vibeRuns: state.vibeRuns.map(item =>
                  item.id === transportEvent.sessionId
                    ? {
                        ...item,
                        status: 'completed' as VibeStatus,
                        currentStep: detail,
                        updatedAt: 'now',
                        events: [
                          ...item.events,
                          {
                            id: createId('evt'),
                            type: 'status' as const,
                            title: 'Session completed',
                            detail,
                            status: 'done' as const,
                            timestamp: shortTime(),
                          },
                        ],
                      }
                    : item
                ),
                devices: state.devices.map(device => ({
                  ...device,
                  activeSessionIds: device.activeSessionIds.filter(id => id !== transportEvent.sessionId),
                })),
                events: [
                  event('agent.session.completed', 'VibeCoding completed', run?.title ?? detail, 'done', {
                    deviceId: run?.deviceId,
                    projectId: run?.projectId,
                    sessionId: transportEvent.sessionId,
                  }),
                  ...state.events,
                ].slice(0, 120),
              };
            });
            return;

          case 'ai.error':
            set(state => {
              const run = state.vibeRuns.find(item => item.id === transportEvent.sessionId);
              return {
                vibeRuns: state.vibeRuns.map(item =>
                  item.id === transportEvent.sessionId
                    ? {
                        ...item,
                        status: 'failed' as VibeStatus,
                        currentStep: transportEvent.error,
                        updatedAt: 'now',
                      }
                    : item
                ),
                devices: state.devices.map(device => ({
                  ...device,
                  activeSessionIds: device.activeSessionIds.filter(id => id !== transportEvent.sessionId),
                })),
                events: [
                  event('agent.session.failed', 'VibeCoding failed', transportEvent.error, 'failed', {
                    deviceId: run?.deviceId,
                    projectId: run?.projectId,
                    sessionId: transportEvent.sessionId,
                  }),
                  ...state.events,
                ].slice(0, 120),
              };
            });
            return;

          case 'ai.session.created':
            set(state => ({
              vibeRuns: state.vibeRuns.map(run =>
                run.id === transportEvent.sessionId
                  ? { ...run, status: 'running' as VibeStatus, updatedAt: 'now' }
                  : run
              ),
            }));
            return;

          case 'ai.session.updated': {
            set(state => {
              const nextRun = serverAiSessionToVibeRun(
                transportEvent.session,
                state.devices,
                state.projects,
              );
              const exists = state.vibeRuns.some(run => run.id === nextRun.id);
              const vibeRuns = exists
                ? state.vibeRuns.map(run => run.id === nextRun.id ? nextRun : run)
                : [nextRun, ...state.vibeRuns];
              return {
                vibeRuns,
                devices: attachDeviceRelations(state.devices, state.projects, vibeRuns),
                events: [
                  event('agent.session.started', 'VibeCoding updated', nextRun.title, 'running', {
                    deviceId: nextRun.deviceId,
                    projectId: nextRun.projectId,
                    sessionId: nextRun.id,
                  }),
                  ...state.events,
                ].slice(0, 120),
              };
            });
            return;
          }

          case 'ai.session.deleted':
            set(state => ({
              vibeRuns: state.vibeRuns.filter(run => run.id !== transportEvent.sessionId),
              devices: state.devices.map(device => ({
                ...device,
                activeSessionIds: device.activeSessionIds.filter(id => id !== transportEvent.sessionId),
              })),
              events: [
                event('agent.session.terminated', 'VibeCoding deleted', transportEvent.sessionId, 'done', {
                  sessionId: transportEvent.sessionId,
                }),
                ...state.events,
              ].slice(0, 120),
            }));
            return;

	          case 'ai.sessions.updated':
	            if (get().serverMode) {
	              platformTransport.loadAiSessions().then(serverSessions => {
	                const state = get();
	                const knownDeviceIds = new Set(state.devices.map(device => device.id));
	                const vibeRuns = serverSessions
	                  .filter(session => knownDeviceIds.has(session.device_id))
	                  .map(session =>
	                    serverAiSessionToVibeRun(session, state.devices, state.projects),
	                  );
	                set({
	                  vibeRuns,
	                  devices: attachDeviceRelations(state.devices, state.projects, vibeRuns),
                });
              }).catch(() => {});
            }
            return;

          case 'terminal.output': {
            const handler = terminalOutputHandlers.get(transportEvent.sessionId);
            if (handler) {
              handler(transportEvent.data, transportEvent.encoding);
              return;
            }
            set(state => ({
              terminalSessions: state.terminalSessions.map(ts =>
                ts.id === transportEvent.sessionId
                  ? {
                      ...ts,
                      lines: [...ts.lines, line('stdout', transportEvent.data)],
                      updatedAt: nowTime(),
                    }
                  : ts
              ),
            }));
            return;
          }

          case 'terminal.created':
            set(state => ({
              terminalSessions: state.terminalSessions.map(ts =>
                ts.id === transportEvent.sessionId
                  ? { ...ts, status: 'running' as TerminalSessionStatus }
                  : ts
              ),
            }));
            return;

          case 'terminal.exit':
            set(state => ({
              terminalSessions: state.terminalSessions.map(ts =>
                ts.id === transportEvent.sessionId
                  ? { ...ts, status: transportEvent.failed ? 'failed' as TerminalSessionStatus : 'completed' as TerminalSessionStatus }
                  : ts
              ),
              events: [
                event(
                  'command.completed',
                  transportEvent.failed ? 'Terminal session failed' : 'Terminal session completed',
                  transportEvent.sessionId,
                  transportEvent.failed ? 'failed' : 'done',
                  { terminalId: transportEvent.sessionId },
                ),
                ...state.events,
              ].slice(0, 120),
            }));
            return;

          case 'approval.requested': {
            const approval = serverApprovalToClient(transportEvent.approval);
            set(state => ({
	              approvals: [
	                approval,
	                ...state.approvals.filter(item => item.id !== approval.id),
	              ],
	              events: [
	                event('approval.requested', approval.title, approval.summary, 'waiting', {
	                  deviceId: approval.deviceId,
                  projectId: approval.projectId,
                  sessionId: approval.sessionId,
                  terminalId: approval.terminalId,
                  approvalId: approval.id,
                }),
                ...state.events,
              ].slice(0, 120),
            }));
	            return;
	          }

	          case 'notification.created': {
	            const nextNotification = serverNotificationToClient(transportEvent.notification);
	            set(state => ({
	              notifications: upsertNotification(state.notifications, nextNotification),
	            }));
	            return;
	          }

	          case 'notification.updated': {
	            const nextNotification = serverNotificationToClient(transportEvent.notification);
	            set(state => ({
	              notifications: upsertNotification(state.notifications, nextNotification),
	            }));
	            return;
	          }

	          case 'notifications.updated':
	            if (transportEvent.readAll) {
	              set(state => ({
	                notifications: state.notifications.map(item => ({ ...item, read: true })),
	              }));
	            }
	            return;

	          case 'preview.ready': {
            const preview: PreviewLink = {
              id: transportEvent.preview.id,
              sessionId: transportEvent.preview.sessionId,
              port: transportEvent.preview.port,
              shortUrl: transportEvent.preview.shortUrl,
              targetUrl: transportEvent.preview.targetUrl,
              expiresIn: transportEvent.expiresIn,
              access: transportEvent.preview.access as PreviewLink['access'],
            };
            set(state => ({
              previewLinks: [preview, ...state.previewLinks.filter(p => p.id !== preview.id)],
              vibeRuns: state.vibeRuns.map(run =>
                run.id === preview.sessionId
                  ? { ...run, status: 'preview_ready' as VibeStatus, previewId: preview.id, updatedAt: 'now' }
                  : run
              ),
              events: [
                event('agent.delta', 'Preview ready', preview.shortUrl, 'done', {
                  sessionId: preview.sessionId,
                }),
                ...state.events,
              ].slice(0, 120),
            }));
            return;
          }

          case 'project.updated': {
            const nextProject = serverProjectToClient(transportEvent.project);
            set(state => {
              const exists = state.projects.some(project => project.id === nextProject.id);
              const projects = exists
                ? state.projects.map(project => project.id === nextProject.id ? nextProject : project)
                : [nextProject, ...state.projects];
              return {
                projects,
                devices: attachDeviceRelations(state.devices, projects, state.vibeRuns),
                events: [
                  event('project.updated', 'Project updated', nextProject.path, 'done', {
                    deviceId: nextProject.deviceId,
                    projectId: nextProject.id,
                  }),
                  ...state.events,
                ].slice(0, 120),
              };
            });
            return;
          }

          case 'project.deleted':
            set(state => {
              const projects = state.projects.filter(project => project.id !== transportEvent.projectId);
              const vibeRuns = state.vibeRuns.filter(run => run.projectId !== transportEvent.projectId);
              return {
                projects,
                vibeRuns,
                devices: attachDeviceRelations(state.devices, projects, vibeRuns),
                projectFiles: state.projectFiles.filter(file => file.projectId !== transportEvent.projectId),
                events: [
                  event('project.updated', 'Project deleted', transportEvent.projectId, 'done', {
                    projectId: transportEvent.projectId,
                  }),
                  ...state.events,
                ].slice(0, 120),
              };
            });
            return;

	          case 'projects.updated':
	            if (get().serverMode) {
	              platformTransport.loadProjects().then(serverProjects => {
	                set(state => {
	                  const knownDeviceIds = new Set(state.devices.map(device => device.id));
	                  const projects = serverProjects
	                    .filter(project => knownDeviceIds.has(project.device_id))
	                    .map(serverProjectToClient);
	                  return {
	                    projects,
	                    devices: attachDeviceRelations(state.devices, projects, state.vibeRuns),
                  };
                });
              }).catch(() => {});
            }
            return;

          case 'client.presence.updated':
          case 'raw':
            return;
        }
      },

      // --- Device binding ---

      bindDevice: async (input) => {
        const name = input.name.trim();
        const duplicate = get().devices.some(
          device => device.name.toLowerCase() === name.toLowerCase(),
        );

        if (duplicate) {
          return {
            ok: false,
            error: 'A device with this name already exists.',
          };
        }

        if (get().serverMode && input.pairingCode) {
          try {
            const clientDevice = platformDeviceToClient(
              await platformTransport.pairDevice(input.pairingCode),
            );
            set(state => ({
              devices: [clientDevice, ...state.devices.filter(d => d.id !== clientDevice.id)],
              events: [
                event('device.bound', 'Device bound', `${clientDevice.name} paired successfully.`, 'done', { deviceId: clientDevice.id }),
                ...state.events,
              ],
            }));
            return { ok: true, deviceId: clientDevice.id };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : 'Pairing failed',
            };
          }
        }

        return {
          ok: false,
          error: 'Platform connection is required before binding a device.',
        };
      },

      renameDevice: async (deviceId, name) => {
        const trimmed = name.trim();
        const duplicate = get().devices.some(
          device =>
            device.id !== deviceId &&
            device.name.toLowerCase() === trimmed.toLowerCase(),
        );

        if (duplicate) {
          return {
            ok: false,
            error: 'A device with this name already exists.',
          };
        }

        if (!get().serverMode) {
          return {
            ok: false,
            error: 'Platform connection is required before renaming a device.',
          };
        }

        const updated = platformDeviceToClient(
          await platformTransport.updateDeviceSettings(deviceId, { name: trimmed }),
        );
        set(state => ({
          devices: attachDeviceRelations(
            state.devices.map(device => device.id === deviceId ? updated : device),
            state.projects,
            state.vibeRuns,
          ),
          events: [
            event('device.bound', 'Device renamed', updated.name, 'done', { deviceId }),
            ...state.events,
          ].slice(0, 120),
        }));

        return { ok: true, deviceId };
      },

      scanDeviceProjects: async (deviceId) => {
        if (get().serverMode) {
          try {
            await platformTransport.scanDeviceProjects(deviceId);
            // Projects will be updated via WS message projects.updated
          } catch {
            // Silently fail — WS may still deliver results
          }
          return;
        }
      },

      createProject: async input => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before creating a project.');
        }
        const serverProject = await platformTransport.createProject({
          device_id: input.deviceId,
          path: input.path,
          name: input.name,
          language: input.language,
          description: input.description,
          status: 'fresh',
          source_tools: ['mobile'],
        });
        const project = serverProjectToClient(serverProject);
        set(state => {
          const projects = [project, ...state.projects.filter(item => item.id !== project.id)];
          return {
            projects,
            devices: attachDeviceRelations(state.devices, projects, state.vibeRuns),
            events: [
              event('project.updated', 'Project created', project.path, 'done', {
                deviceId: project.deviceId,
                projectId: project.id,
              }),
              ...state.events,
            ].slice(0, 120),
          };
        });
        return project.id;
      },

      updateProject: async (projectId, input) => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before updating a project.');
        }
        const serverProject = await platformTransport.updateProject(projectId, {
          name: input.name,
          path: input.path,
          branch: input.branch,
          language: input.language,
          description: input.description,
          status: input.status,
        });
        const project = serverProjectToClient(serverProject);
        set(state => {
          const projects = state.projects.map(item => item.id === project.id ? project : item);
          return {
            projects,
            devices: attachDeviceRelations(state.devices, projects, state.vibeRuns),
          };
        });
      },

      deleteProject: async projectId => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before deleting a project.');
        }
        await platformTransport.deleteProject(projectId);
        set(state => {
          const projects = state.projects.filter(item => item.id !== projectId);
          const vibeRuns = state.vibeRuns.filter(run => run.projectId !== projectId);
          return {
            projects,
            vibeRuns,
            projectFiles: state.projectFiles.filter(file => file.projectId !== projectId),
            devices: attachDeviceRelations(state.devices, projects, vibeRuns),
          };
        });
      },

      loadProjectFiles: async (projectId, path) => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before loading project files.');
        }

        try {
          const result = await platformTransport.loadProjectFiles(projectId, path);
          const nextEntries = result.entries.map(entry =>
            serverProjectFileToClient(result.project_id, result.path, entry),
          );

          set(state => {
            const existingByPath = new Map(
              state.projectFiles
                .filter(item => item.projectId === result.project_id)
                .map(item => [item.path, item]),
            );
            const mergedEntries = nextEntries.map(entry => {
              const existing = existingByPath.get(entry.path);
              return existing
                ? {
                    ...entry,
                    content: existing.content,
                    encoding: existing.encoding,
                    loadedAt: existing.loadedAt,
                    truncated: existing.truncated,
                  }
                : entry;
            });

            return {
              projectFiles: [
                ...state.projectFiles.filter(
                  item =>
                    item.projectId !== result.project_id ||
                    item.directoryPath !== result.path,
                ),
                ...mergedEntries,
              ],
              events: [
                event(
                  'project.scan.completed',
                  'Project files loaded',
                  `${mergedEntries.length} entries from ${result.path}`,
                  'done',
                  { projectId: result.project_id, deviceId: result.device_id },
                ),
                ...state.events,
              ].slice(0, 120),
            };
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Project file list failed';
          set(state => ({
            events: [
              event('project.scan.completed', 'Project file load failed', detail, 'failed', {
                projectId,
              }),
              ...state.events,
            ].slice(0, 120),
          }));
          throw error;
        }
      },

      loadProjectFileContent: async (projectId, path) => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before reading project files.');
        }

        try {
          const result = await platformTransport.loadProjectFileContent(projectId, path);
          const loadedEntry = serverProjectContentToFileEntry(result.project_id, result);

          set(state => {
            const hasExisting = state.projectFiles.some(
              item => item.projectId === result.project_id && item.path === result.path,
            );
            const nextFiles = hasExisting
              ? state.projectFiles.map(item =>
                  item.projectId === result.project_id && item.path === result.path
                    ? {
                        ...item,
                        content: result.content,
                        encoding: result.encoding,
                        loadedAt: nowTime(),
                        truncated: result.truncated,
                        sizeBytes: result.size_bytes ?? item.sizeBytes,
                        size: result.size_bytes !== undefined ? formatBytes(result.size_bytes) : item.size,
                        modifiedAt: result.modified_at ?? item.modifiedAt,
                        lastTouched: result.modified_at ?? item.lastTouched,
                        error: undefined,
                      }
                    : item,
                )
              : [...state.projectFiles, loadedEntry];

            return {
              projectFiles: nextFiles,
              events: [
                event('file.changed', 'Project file loaded', result.path, 'done', {
                  projectId: result.project_id,
                  deviceId: result.device_id,
                }),
                ...state.events,
              ].slice(0, 120),
            };
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Project file read failed';
          set(state => ({
            projectFiles: state.projectFiles.map(item =>
              item.projectId === projectId && item.path === path
                ? { ...item, error: detail }
                : item,
            ),
            events: [
              event('file.changed', 'Project file read failed', detail, 'failed', {
                projectId,
              }),
              ...state.events,
            ].slice(0, 120),
          }));
          throw error;
        }
      },

      createTerminalSession: async (deviceId, directory) => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before opening a terminal.');
        }
        const device = get().devices.find(item => item.id === deviceId);
        const selectedDirectory =
          directory ?? device?.authorizedDirectories[0] ?? '~';
        const serverSession = await platformTransport.createTerminalSession({
          device_id: deviceId,
          cwd: selectedDirectory,
          cols: 80,
          rows: 24,
        });
        const terminal = serverTerminalSessionToClient(serverSession);

        set(state => ({
          terminalSessions: [
            {
              ...terminal,
              shell: terminal.shell || (device?.os.toLowerCase().includes('windows') ? 'pwsh' : 'zsh'),
              lines: [
                line('system', device ? `Terminal session opened on ${device.name}.` : 'Device is unavailable.'),
                line('system', `Working directory: ${selectedDirectory}`),
              ],
            },
            ...state.terminalSessions.filter(item => item.id !== terminal.id),
          ],
          events: [
            event('command.started', 'Terminal session opened', selectedDirectory, 'running', {
              deviceId,
              terminalId: terminal.id,
            }),
            ...state.events,
          ].slice(0, 120),
        }));

        return terminal.id;
      },

      executeTerminalCommand: (terminalId, command) => {
        const trimmed = command.trim();
        const terminal = get().terminalSessions.find(item => item.id === terminalId);
        const device = terminal
          ? get().devices.find(item => item.id === terminal.deviceId)
          : undefined;

        if (!terminal || !trimmed || !device || device.status === 'offline') {
          return;
        }

        // Send via WebSocket if connected
        if (get().serverMode) {
          const sent = platformTransport.send({
            type: 'terminal.input',
            session_id: terminalId,
            data: `${trimmed}\n`,
            encoding: 'text',
          });
          if (sent) {
            set(state => ({
              terminalSessions: state.terminalSessions.map(item =>
                item.id === terminalId
                  ? {
                      ...item,
                      status: 'running' as TerminalSessionStatus,
                      lines: [...item.lines, line('command', `${item.directory} $ ${trimmed}`)],
                      updatedAt: nowTime(),
                    }
                  : item
              ),
            }));
            return;
          }
        }
      },

      clearTerminal: terminalId => {
        set(state => ({
          terminalSessions: state.terminalSessions.map(item =>
            item.id === terminalId
              ? {
                  ...item,
                  status: 'idle',
                  updatedAt: nowTime(),
                  lines: [
                    line('system', 'Terminal output cleared.'),
                    line('system', `Working directory: ${item.directory}`),
                  ],
                }
              : item
          ),
        }));
      },

      stopTerminal: async terminalId => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before stopping a terminal.');
        }
        const serverSession = await platformTransport.closeTerminalSession(terminalId);
        const closed = serverTerminalSessionToClient(serverSession);
        terminalOutputHandlers.delete(terminalId);
        set(state => ({
          terminalSessions: state.terminalSessions.map(item =>
            item.id === terminalId
              ? {
                  ...item,
                  status: closed.status === 'completed' ? 'stopped' : closed.status,
                  updatedAt: closed.updatedAt,
                  lines: [...item.lines, line('system', 'Terminal session closed from mobile control.')],
                }
              : item
          ),
          events: [
            event('command.completed', 'Terminal session closed', terminalId, 'done', {
              terminalId,
            }),
            ...state.events,
          ].slice(0, 120),
        }));
      },

      startAgentSession: async (input) => {
        const model = input.provider === 'claude_code' ? 'Claude Code' : 'GPT-5 Codex';

        if (get().serverMode) {
          try {
            let projectId = input.projectId;
            if (!projectId) {
              projectId = await get().createProject({
                deviceId: input.deviceId,
                path: input.directory,
                name: fileNameFromPath(input.directory),
                description: 'Created from mobile VibeCoding.',
              });
            }
            const session = await platformTransport.createAiSession({
              device_id: input.deviceId,
              project_id: projectId || undefined,
              project_path: input.directory,
              mode: 'vibe',
              title: input.objective.slice(0, 44) || 'New VibeCoding session',
              objective: input.objective,
              model,
              risk: input.provider === 'claude_code' ? 'medium' : 'low',
            });

            const sessionId = session.session_id;
            const project = get().projects.find(item => item.id === projectId);

            const nextRun: VibeCodingRun = {
              id: sessionId,
              title: session.title ?? input.objective.slice(0, 44),
              deviceId: input.deviceId,
              projectId,
              directory: input.directory,
              status: 'running',
              objective: input.objective,
              model,
              timeLimitMinutes: input.timeLimitMinutes,
              elapsedMinutes: 1,
              risk: input.provider === 'claude_code' ? 'medium' : 'low',
              currentStep: `${model} is reading the project and preparing a plan.`,
              branch: `agent/${sessionId}`,
              updatedAt: 'now',
              suggestions: ['Ask for plan', 'Open terminal', 'Pause session'],
              transcript: [
                {
                  id: createId('msg'),
                  role: 'user',
                  mode: 'text',
                  content: input.objective,
                  timestamp: shortTime(),
                },
              ],
              events: [
                {
                  id: createId('agent-event'),
                  type: 'status',
                  title: 'Agent session started',
                  detail: `${model} started on ${project?.name ?? input.projectId}`,
                  status: 'running',
                  timestamp: shortTime(),
                },
              ],
            };

            set(state => ({
              vibeRuns: [nextRun, ...state.vibeRuns],
              devices: state.devices.map(device =>
                device.id === input.deviceId
                  ? { ...device, activeSessionIds: [sessionId, ...device.activeSessionIds] }
                  : device
              ),
              events: [
                event('agent.session.started', 'Agent session started', `${model} started in ${input.directory}.`, 'running', {
                  deviceId: input.deviceId,
                  projectId,
                  sessionId,
                }),
                ...state.events,
              ],
            }));

            return sessionId;
          } catch (error) {
            console.warn('[store] Failed to create agent session:', error);
            throw error;
          }
        }

        throw new Error('Platform connection is required to start a VibeCoding session.');
      },

      pauseAgentSession: async sessionId => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before pausing a VibeCoding session.');
        }
        const serverSession = await platformTransport.pauseAiSession(sessionId);
        set(state => {
          const nextRun = serverAiSessionToVibeRun(serverSession, state.devices, state.projects);
          const vibeRuns = state.vibeRuns.map(run => run.id === nextRun.id ? nextRun : run);
          return {
            vibeRuns,
            devices: attachDeviceRelations(state.devices, state.projects, vibeRuns),
            events: [
              event('agent.session.paused', 'VibeCoding paused', nextRun.title, 'done', {
                deviceId: nextRun.deviceId,
                projectId: nextRun.projectId,
                sessionId: nextRun.id,
              }),
              ...state.events,
            ].slice(0, 120),
          };
        });
      },

      resumeAgentSession: async sessionId => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before resuming a VibeCoding session.');
        }
        const serverSession = await platformTransport.resumeAiSession(sessionId);
        set(state => {
          const nextRun = serverAiSessionToVibeRun(serverSession, state.devices, state.projects);
          const vibeRuns = state.vibeRuns.map(run => run.id === nextRun.id ? nextRun : run);
          return {
            vibeRuns,
            devices: attachDeviceRelations(state.devices, state.projects, vibeRuns),
            events: [
              event('agent.session.resumed', 'VibeCoding resumed', nextRun.title, 'running', {
                deviceId: nextRun.deviceId,
                projectId: nextRun.projectId,
                sessionId: nextRun.id,
              }),
              ...state.events,
            ].slice(0, 120),
          };
        });
      },

      terminateAgentSession: async sessionId => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before terminating a VibeCoding session.');
        }
        const serverSession = await platformTransport.terminateAiSession(sessionId);
        set(state => {
          const nextRun = serverAiSessionToVibeRun(serverSession, state.devices, state.projects);
          const vibeRuns = state.vibeRuns.map(run => run.id === nextRun.id ? nextRun : run);
          return {
            vibeRuns,
            devices: attachDeviceRelations(state.devices, state.projects, vibeRuns),
            events: [
              event('agent.session.terminated', 'VibeCoding terminated', nextRun.title, 'done', {
                deviceId: nextRun.deviceId,
                projectId: nextRun.projectId,
                sessionId: nextRun.id,
              }),
              ...state.events,
            ].slice(0, 120),
          };
        });
      },

      updateAgentSession: async (sessionId, input) => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before updating a VibeCoding session.');
        }
        const serverSession = await platformTransport.updateAiSession(sessionId, {
          title: input.title,
          objective: input.objective,
          status: input.status,
          current_step: input.currentStep,
          risk: input.risk,
        });
        set(state => {
          const nextRun = serverAiSessionToVibeRun(serverSession, state.devices, state.projects);
          return {
            vibeRuns: state.vibeRuns.map(run => run.id === nextRun.id ? nextRun : run),
          };
        });
      },

      deleteAgentSession: async sessionId => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before deleting a VibeCoding session.');
        }
        await platformTransport.deleteAiSession(sessionId);
        set(state => ({
          vibeRuns: state.vibeRuns.filter(item => item.id !== sessionId),
          devices: state.devices.map(device => ({
            ...device,
            activeSessionIds: device.activeSessionIds.filter(id => id !== sessionId),
          })),
        }));
      },

      appendAgentMessage: async (sessionId, content, mode) => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before sending a VibeCoding message.');
        }
        await platformTransport.sendAiMessage(sessionId, content);
      },

      resolveApproval: async (approvalId, decision) => {
        const approval = get().approvals.find(item => item.id === approvalId);
        if (!approval) return;

        if (!get().serverMode) {
          throw new Error('Platform connection is required before resolving an approval.');
        }

	        const resolved = serverApprovalToClient(
	          await platformTransport.respondApproval(approvalId, decision),
	        );
	        set(state => ({
	          approvals: state.approvals.map(item =>
	            item.id === approvalId ? resolved : item
	          ),
	        }));
	      },

	      markNotificationRead: async notificationId => {
	        if (!get().serverMode) {
	          throw new Error('Platform connection is required before marking notifications read.');
	        }
	        const updated = serverNotificationToClient(
	          await platformTransport.markNotificationRead(notificationId),
	        );
	        set(state => ({
	          notifications: upsertNotification(state.notifications, updated),
	        }));
	      },

	      markAllNotificationsRead: async () => {
	        if (!get().serverMode) {
	          throw new Error('Platform connection is required before marking notifications read.');
	        }
	        await platformTransport.markAllNotificationsRead();
	        set(state => ({
	          notifications: state.notifications.map(item => ({ ...item, read: true })),
	        }));
      },

      createPtySession: async (deviceId, options) => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before opening a terminal.');
        }
	        const serverSession = await platformTransport.createTerminalSession({
	          device_id: deviceId,
	          cwd: options?.cwd,
	          cols: options?.cols ?? 80,
	          rows: options?.rows ?? 24,
	        });
	        const device = get().devices.find(item => item.id === deviceId);
	        const terminal = serverTerminalSessionToClient(serverSession);
	        set(state => ({
	          terminalSessions: [
	            {
	              ...terminal,
	              lines: [
	                line('system', device ? `PTY session opened on ${device.name}.` : 'Device is unavailable.'),
	              ],
	            },
	            ...state.terminalSessions.filter(item => item.id !== terminal.id),
	          ],
	        }));
	        return terminal.id;
	      },

      sendTerminalInput: (sessionId, data, encoding = 'base64') => {
        platformTransport.send({
          type: 'terminal.input',
          session_id: sessionId,
          encoding,
          data,
        });
      },

      resizeTerminal: (sessionId, cols, rows) => {
        platformTransport.send({
          type: 'terminal.resize',
          session_id: sessionId,
          cols,
          rows,
        });
      },

      closeTerminalSession: async (sessionId) => {
        if (!get().serverMode) {
          throw new Error('Platform connection is required before closing a terminal.');
        }
        const serverSession = await platformTransport.closeTerminalSession(sessionId);
        const closed = serverTerminalSessionToClient(serverSession);
        terminalOutputHandlers.delete(sessionId);
        set(state => ({
          terminalSessions: state.terminalSessions.map(item =>
            item.id === sessionId
              ? {
                  ...item,
                  status: closed.status === 'completed' ? 'stopped' as TerminalSessionStatus : closed.status,
                  updatedAt: closed.updatedAt,
                }
              : item
          ),
        }));
      },
    }),
    {
      name: 'aliang-vibecoding-control-center',
      storage: createJSONStorage(() => AsyncStorage),
      version: 4,
      migrate: () => ({
        ...emptySessionData(),
        wsConnected: false,
        serverMode: false,
      }),
      partialize: () => ({}),
    },
  ),
);
