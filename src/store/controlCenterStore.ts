import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  AgentEvent,
  AgentMessage,
  Device,
  PreviewLink,
  Project,
  VibeCodingRun,
  VibeStatus,
} from '../data/mockData';
import { terminalOutputHandlers } from '../components/terminal/TerminalEmulator';
import {
  platformTransport,
  type PlatformAiSessionSnapshot,
  type PlatformApprovalSnapshot,
  type PlatformDeviceSnapshot,
  type PlatformProjectFileContentSnapshot,
  type PlatformProjectFileListSnapshot,
  type PlatformProjectSnapshot,
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
  | 'command.started'
  | 'command.completed'
  | 'approval.requested'
  | 'file.changed'
  | 'device.bound'
  | 'device.offline'
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
  initializeFromServer: () => Promise<void>;
  disconnectFromServer: () => void;
  resetSessionData: () => void;
  handleTransportEvent: (event: PlatformTransportEvent) => void;
  bindDevice: (input: BindDeviceInput) => Promise<BindDeviceResult>;
  renameDevice: (deviceId: string, name: string) => BindDeviceResult;
  scanDeviceProjects: (deviceId: string) => Promise<void>;
  loadProjectFiles: (projectId: string, path?: string) => Promise<void>;
  loadProjectFileContent: (projectId: string, path: string) => Promise<void>;
  createTerminalSession: (deviceId: string, directory?: string) => string;
  executeTerminalCommand: (terminalId: string, command: string) => void;
  clearTerminal: (terminalId: string) => void;
  stopTerminal: (terminalId: string) => void;
  startAgentSession: (input: StartAgentInput) => Promise<string>;
  pauseAgentSession: (sessionId: string) => void;
  resumeAgentSession: (sessionId: string) => void;
  terminateAgentSession: (sessionId: string) => void;
  deleteAgentSession: (sessionId: string) => void;
  appendAgentMessage: (
    sessionId: string,
    content: string,
    mode: 'voice' | 'text',
  ) => void;
  resolveApproval: (approvalId: string, decision: 'approved' | 'denied') => void;
  markNotificationRead: (notificationId: string) => void;
  markAllNotificationsRead: () => void;
  createPtySession: (deviceId: string, options?: { cwd?: string; cols?: number; rows?: number }) => Promise<string>;
  sendTerminalInput: (sessionId: string, data: string, encoding?: string) => void;
  resizeTerminal: (sessionId: string, cols: number, rows: number) => void;
  closeTerminalSession: (sessionId: string) => void;
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

const notification = (
  type: PushNotificationItem['type'],
  title: string,
  body: string,
  meta: Partial<PushNotificationItem> = {},
): PushNotificationItem => ({
  id: createId('push'),
  type,
  title,
  body,
  read: false,
  createdAt: nowTime(),
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

	      initializeFromServer: async () => {
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
	          const warningEvents = snapshot.warnings.map(detail =>
	            event('command.completed', 'Partial platform sync', detail, 'failed'),
	          );

          set({
            devices,
            projects,
            vibeRuns,
            approvals,
            events: warningEvents,
          });

          console.log(`[store] Initialized from server: ${devices.length} devices, ${projects.length} projects, ${vibeRuns.length} AI sessions, ${approvals.length} approvals`);

          platformTransport.connect(transportEvent => {
            get().handleTransportEvent(transportEvent);
          });
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
              const nextNotifications: PushNotificationItem[] = [];

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
                nextNotifications.push(
                  notification('device_offline', 'Device disconnected', `${nextDevice.name} is no longer reachable.`, {
                    deviceId: nextDevice.id,
                  }),
                );
              }

              return {
                devices: nextDevices,
                events: [...nextEvents, ...state.events].slice(0, 120),
                notifications: [...nextNotifications, ...state.notifications].slice(0, 120),
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
                notifications: [
                  notification('completed', 'VibeCoding completed', run?.title ?? detail, {
                    deviceId: run?.deviceId,
                    sessionId: transportEvent.sessionId,
                  }),
                  ...state.notifications,
                ].slice(0, 120),
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
                notifications: [
                  notification('error', 'VibeCoding failed', run?.title ?? transportEvent.error, {
                    deviceId: run?.deviceId,
                    sessionId: transportEvent.sessionId,
                  }),
                  ...state.notifications,
                ].slice(0, 120),
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
              notifications: [
                notification('approval', approval.title, approval.summary, {
                  deviceId: approval.deviceId,
                  sessionId: approval.sessionId,
                  approvalId: approval.id,
                }),
                ...state.notifications,
              ].slice(0, 120),
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

      renameDevice: (deviceId, name) => {
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

        set(state => ({
          devices: state.devices.map(device =>
            device.id === deviceId ? { ...device, name: trimmed } : device,
          ),
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

      createTerminalSession: (deviceId, directory) => {
        const device = get().devices.find(item => item.id === deviceId);
        const selectedDirectory =
          directory ?? device?.authorizedDirectories[0] ?? '~';
        const terminalId = createId('term');

        set(state => ({
          terminalSessions: [
            {
              id: terminalId,
              deviceId,
              directory: selectedDirectory,
              shell: device?.os.toLowerCase().includes('windows') ? 'pwsh' : 'zsh',
              status: device?.status === 'offline' ? 'stopped' : 'idle',
              lines: [
                line('system', device ? `Terminal session opened on ${device.name}.` : 'Device is unavailable.'),
                line('system', `Working directory: ${selectedDirectory}`),
              ],
              createdAt: nowTime(),
              updatedAt: nowTime(),
            },
            ...state.terminalSessions,
          ],
        }));

        return terminalId;
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

      stopTerminal: terminalId => {
        // Send close via WS or HTTP
        if (get().serverMode) {
          platformTransport.send({ type: 'terminal.close', session_id: terminalId });
        }
        set(state => ({
          terminalSessions: state.terminalSessions.map(item =>
            item.id === terminalId
              ? {
                  ...item,
                  status: 'stopped',
                  updatedAt: nowTime(),
                  lines: [...item.lines, line('system', 'Process interrupted from mobile control.')],
                }
              : item
          ),
        }));
      },

      startAgentSession: async (input) => {
        const model = input.provider === 'claude_code' ? 'Claude Code' : 'GPT-5 Codex';

        if (get().serverMode) {
          try {
            const session = await platformTransport.createAiSession({
              device_id: input.deviceId,
              project_path: input.directory,
              mode: 'vibe',
              title: input.objective.slice(0, 44) || 'New VibeCoding session',
              objective: input.objective,
              model,
              risk: input.provider === 'claude_code' ? 'medium' : 'low',
            });

            const sessionId = session.session_id;
            const project = get().projects.find(item => item.id === input.projectId);

            const nextRun: VibeCodingRun = {
              id: sessionId,
              title: session.title ?? input.objective.slice(0, 44),
              deviceId: input.deviceId,
              projectId: input.projectId,
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
                  projectId: input.projectId,
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

      pauseAgentSession: sessionId => {
        if (get().serverMode) {
          platformTransport.send({ type: 'ai.stop', session_id: sessionId });
        }
        set(state => ({
          vibeRuns: state.vibeRuns.map(run =>
            run.id === sessionId ? { ...run, status: 'paused' as VibeStatus, currentStep: 'Paused from mobile control.' } : run
          ),
        }));
      },

      resumeAgentSession: sessionId => {
        set(state => ({
          vibeRuns: state.vibeRuns.map(run =>
            run.id === sessionId ? { ...run, status: 'running' as VibeStatus, currentStep: 'Agent resumed and is syncing workspace state.' } : run
          ),
        }));
      },

      terminateAgentSession: sessionId => {
        if (get().serverMode) {
          platformTransport.send({ type: 'ai.stop', session_id: sessionId });
        }
        set(state => ({
          vibeRuns: state.vibeRuns.map(run =>
            run.id === sessionId ? { ...run, status: 'completed' as VibeStatus, currentStep: 'Session terminated from mobile control.' } : run
          ),
          devices: state.devices.map(device => ({
            ...device,
            activeSessionIds: device.activeSessionIds.filter(id => id !== sessionId),
          })),
        }));
      },

      deleteAgentSession: sessionId => {
        set(state => ({
          vibeRuns: state.vibeRuns.filter(item => item.id !== sessionId),
          devices: state.devices.map(device => ({
            ...device,
            activeSessionIds: device.activeSessionIds.filter(id => id !== sessionId),
          })),
        }));
      },

      appendAgentMessage: (sessionId, content, mode) => {
        if (get().serverMode) {
          const sent = platformTransport.send({
            type: 'ai.message',
            session_id: sessionId,
            content,
            mode,
          });
          if (!sent) {
            platformTransport.sendAiMessage(sessionId, content).catch(() => {});
          }
        }

        const userMessage: AgentMessage = {
          id: createId('msg'),
          role: 'user',
          mode,
          content,
          timestamp: shortTime(),
        };

        set(state => ({
          vibeRuns: state.vibeRuns.map(run =>
            run.id === sessionId
              ? { ...run, status: 'running' as VibeStatus, transcript: [...run.transcript, userMessage], updatedAt: 'now' }
              : run
          ),
        }));
      },

      resolveApproval: (approvalId, decision) => {
        const approval = get().approvals.find(item => item.id === approvalId);
        if (!approval) return;

        if (get().serverMode) {
          platformTransport.respondApproval(approvalId, decision).catch(() => {});
        }

        const approved = decision === 'approved';
        set(state => ({
          approvals: state.approvals.map(item =>
            item.id === approvalId ? { ...item, status: decision, resolvedAt: nowTime() } : item
          ),
          notifications: [
            notification(approved ? 'completed' : 'error', approved ? 'Approval granted' : 'Approval denied', approval.title, {
              deviceId: approval.deviceId,
              approvalId,
            }),
            ...state.notifications,
          ],
        }));
      },

      markNotificationRead: notificationId => {
        set(state => ({
          notifications: state.notifications.map(item =>
            item.id === notificationId ? { ...item, read: true } : item
          ),
        }));
      },

      markAllNotificationsRead: () => {
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
        const sessionId = serverSession.session_id;
        // Track locally as well
        const device = get().devices.find(item => item.id === deviceId);
        set(state => ({
          terminalSessions: [
            {
              id: sessionId,
              deviceId,
              directory: options?.cwd ?? device?.authorizedDirectories[0] ?? '~',
              shell: device?.os.toLowerCase().includes('windows') ? 'pwsh' : 'zsh',
              status: 'idle' as TerminalSessionStatus,
              lines: [
                line('system', device ? `PTY session opened on ${device.name}.` : 'Device is unavailable.'),
              ],
              createdAt: nowTime(),
              updatedAt: nowTime(),
            },
            ...state.terminalSessions,
          ],
        }));
        return sessionId;
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

      closeTerminalSession: (sessionId) => {
        platformTransport.send({
          type: 'terminal.close',
          session_id: sessionId,
        });
        terminalOutputHandlers.delete(sessionId);
        set(state => ({
          terminalSessions: state.terminalSessions.map(item =>
            item.id === sessionId
              ? { ...item, status: 'stopped' as TerminalSessionStatus, updatedAt: nowTime() }
              : item
          ),
        }));
        if (get().serverMode) {
          platformTransport.closeTerminalSession(sessionId).catch(() => {});
        }
      },
    }),
    {
      name: 'aliang-vibecoding-control-center',
      storage: createJSONStorage(() => AsyncStorage),
      version: 3,
      migrate: persistedState => persistedState as Partial<ControlCenterState>,
      partialize: state => ({
        devices: state.devices,
        projects: state.projects,
        vibeRuns: state.vibeRuns,
        previewLinks: state.previewLinks,
        terminalSessions: state.terminalSessions,
        scanResults: state.scanResults,
        approvals: state.approvals,
        notifications: state.notifications,
        events: state.events,
        projectFiles: state.projectFiles,
      }),
    },
  ),
);
