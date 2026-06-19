import {
  pairDevice as apiPairDevice,
  updateDeviceSettings as apiUpdateDeviceSettings,
  type ServerDevice,
} from '../api/devices';
import {
  createProject as apiCreateProject,
  deleteProject as apiDeleteProject,
  fetchProjectFileContent,
  fetchProjectFiles,
  fetchProjects,
  scanDeviceProjects as apiScanProjects,
  updateProject as apiUpdateProject,
  type ServerProjectFileContent,
  type ServerProjectFileList,
  type ServerProject,
} from '../api/projects';
import {
  closeTerminalSession as apiCloseTerminalSession,
  createAiSession as apiCreateAiSession,
  deleteAiSession as apiDeleteAiSession,
  createTerminalSession as apiCreateTerminalSession,
  fetchDeviceTerminalCommands,
  fetchAiSession,
  fetchAiSessionMessages,
  fetchAiSessions,
  fetchTerminalSessionCommands,
  pauseAiSession as apiPauseAiSession,
  resumeAiSession as apiResumeAiSession,
  sendAiMessage as apiSendAiMessage,
  terminateAiSession as apiTerminateAiSession,
  updateAiSession as apiUpdateAiSession,
  type ServerAiSession,
  type ServerAiMessagesPageResponse,
  type ServerTerminalCommand,
  type ServerTerminalSession,
} from '../api/sessions';
import {
  respondApproval as apiRespondApproval,
  type ServerApproval,
} from '../api/approvals';
import {
  markAllNotificationsRead as apiMarkAllNotificationsRead,
  markNotificationRead as apiMarkNotificationRead,
  type ServerNotification,
} from '../api/notifications';
import {
  fetchMobileSnapshot,
  type ServerPreviewLink,
  type ServerRealtimeEvent,
} from '../api/platformState';
import {
  connectMobileSocket,
  disconnectMobileSocket,
  getActiveSocket,
  type WsConnectionState,
} from './websocket';

export interface PlatformDeviceSnapshot {
  id: string;
  deviceId: string;
  userId: string;
  name: string;
  platform: string;
  status: 'online' | 'offline';
  uniqueCode?: string;
  agentVersion?: string;
  capabilities: string[];
  tools: ServerDevice['tools'];
  history: ServerDevice['history'];
  agentStartedAt?: string;
  lastSeenAt?: string;
  remoteTerminalEnabled: boolean;
  aiControlEnabled: boolean;
  createdAt?: string;
  pairedAt?: string;
  boundAt?: string;
  location?: string;
  host?: string;
  cpuLoad?: number;
  memLoad?: number;
  battery?: number;
  activePorts: number[];
  authorizedDirectories: string[];
  projectIds: string[];
  raw: ServerDevice;
}

export type PlatformProjectSnapshot = ServerProject;
export type PlatformProjectFileListSnapshot = ServerProjectFileList;
export type PlatformProjectFileContentSnapshot = ServerProjectFileContent;
export type PlatformAiSessionSnapshot = ServerAiSession;
export type PlatformApprovalSnapshot = ServerApproval;
export type PlatformTerminalSessionSnapshot = ServerTerminalSession;
export type PlatformTerminalCommandSnapshot = ServerTerminalCommand;
export type PlatformRealtimeEventSnapshot = ServerRealtimeEvent;
export type PlatformNotificationSnapshot = ServerNotification;

export interface PlatformSnapshot {
  devices: PlatformDeviceSnapshot[];
  projects: PlatformProjectSnapshot[];
  aiSessions: PlatformAiSessionSnapshot[];
  terminalSessions: PlatformTerminalSessionSnapshot[];
  approvals: PlatformApprovalSnapshot[];
  notifications: PlatformNotificationSnapshot[];
  previewLinks: PlatformPreviewSnapshot[];
  realtimeEvents: PlatformRealtimeEventSnapshot[];
  loadedAt: string;
  warnings: string[];
}

export interface PlatformPreviewSnapshot {
  id: string;
  sessionId: string;
  port: number;
  shortUrl: string;
  targetUrl: string;
  expiresIn?: string;
  access: string;
  createdAt?: string;
}

export type PlatformTransportEvent =
  | { type: 'transport.status'; status: WsConnectionState }
  | { type: 'mobile.connected'; user?: unknown; raw: Record<string, unknown> }
  | { type: 'device.updated'; device: PlatformDeviceSnapshot; raw: Record<string, unknown> }
  | { type: 'device.removed'; deviceId: string; raw: Record<string, unknown> }
  | { type: 'ai.delta'; sessionId: string; delta: string; currentStep: string; messageId?: string; raw: Record<string, unknown> }
  | { type: 'ai.done'; sessionId: string; detail: string; raw: Record<string, unknown> }
  | { type: 'ai.error'; sessionId: string; error: string; raw: Record<string, unknown> }
  | { type: 'ai.session.created'; sessionId: string; raw: Record<string, unknown> }
  | { type: 'ai.session.updated'; session: PlatformAiSessionSnapshot; raw: Record<string, unknown> }
  | { type: 'ai.session.deleted'; sessionId: string; raw: Record<string, unknown> }
  | { type: 'ai.sessions.updated'; deviceId?: string; raw: Record<string, unknown> }
  | { type: 'terminal.output'; sessionId: string; data: string; encoding: string; raw: Record<string, unknown> }
  | { type: 'terminal.created'; sessionId: string; raw: Record<string, unknown> }
  | { type: 'terminal.closed'; sessionId: string; raw: Record<string, unknown> }
  | { type: 'terminal.exit'; sessionId: string; failed: boolean; raw: Record<string, unknown> }
  | { type: 'approval.requested'; approval: PlatformApprovalSnapshot; raw: Record<string, unknown> }
  | { type: 'notification.created'; notification: PlatformNotificationSnapshot; raw: Record<string, unknown> }
  | { type: 'notification.updated'; notification: PlatformNotificationSnapshot; raw: Record<string, unknown> }
  | { type: 'notifications.updated'; readAll: boolean; raw: Record<string, unknown> }
  | { type: 'preview.ready'; preview: PlatformPreviewSnapshot; expiresIn: string; raw: Record<string, unknown> }
  | { type: 'project.updated'; project: PlatformProjectSnapshot; raw: Record<string, unknown> }
  | { type: 'project.deleted'; projectId: string; raw: Record<string, unknown> }
  | { type: 'projects.updated'; deviceId?: string; raw: Record<string, unknown> }
  | { type: 'client.presence.updated'; raw: Record<string, unknown> }
  | { type: 'raw'; raw: Record<string, unknown> };

type TransportEventHandler = (event: PlatformTransportEvent) => void;

const asString = (value: unknown) =>
  typeof value === 'string' ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : [];

const asNumberArray = (value: unknown): number[] =>
  Array.isArray(value)
    ? value
        .map(item => Number(item))
        .filter(item => Number.isFinite(item))
    : [];

const isServerDevice = (value: unknown): value is ServerDevice =>
  Boolean(value && typeof value === 'object');

const isServerApproval = (value: unknown): value is ServerApproval =>
  Boolean(value && typeof value === 'object');

const isServerNotification = (value: unknown): value is ServerNotification =>
  Boolean(value && typeof value === 'object');

const isServerProject = (value: unknown): value is ServerProject =>
  Boolean(value && typeof value === 'object');

const isServerAiSession = (value: unknown): value is ServerAiSession =>
  Boolean(value && typeof value === 'object');

export function normalizeServerDevice(device: ServerDevice): PlatformDeviceSnapshot {
  const id = device.id || device.device_id;
  const deviceId = device.device_id || device.id;

  return {
    id,
    deviceId,
    userId: device.user_id,
    name: device.name || deviceId,
    platform: device.platform || 'unknown',
    status: device.status === 'online' ? 'online' : 'offline',
    uniqueCode: device.unique_code,
    agentVersion: device.agent_version,
    capabilities: asStringArray(device.capabilities),
    tools: Array.isArray(device.tools) ? device.tools : [],
    history: Array.isArray(device.history) ? device.history : [],
    agentStartedAt: device.agent_started_at,
    lastSeenAt: device.last_seen_at,
    remoteTerminalEnabled: Boolean(device.remote_terminal_enabled),
    aiControlEnabled: Boolean(device.ai_control_enabled),
    createdAt: device.created_at,
    pairedAt: device.paired_at,
    boundAt: device.bound_at,
    location: device.location,
    host: device.host,
    cpuLoad: typeof device.cpu_load === 'number' ? device.cpu_load : undefined,
    memLoad: typeof device.mem_load === 'number' ? device.mem_load : undefined,
    battery: typeof device.battery === 'number' ? device.battery : undefined,
    activePorts: asNumberArray(device.active_ports),
    authorizedDirectories: asStringArray(device.authorized_directories),
    projectIds: asStringArray(device.project_ids),
    raw: device,
  };
}

function normalizeServerPreviewLink(link: ServerPreviewLink): PlatformPreviewSnapshot {
  return {
    id: link.id || link.preview_id,
    sessionId: link.session_id,
    port: link.port,
    shortUrl: link.short_url,
    targetUrl: link.target_url,
    expiresIn: link.expires_in,
    access: link.access,
    createdAt: link.created_at,
  };
}

class PlatformTransport {
  private handler: TransportEventHandler | null = null;

  get connected(): boolean {
    return Boolean(getActiveSocket()?.connected);
  }

  async loadSnapshot(): Promise<PlatformSnapshot> {
    const snapshot = await fetchMobileSnapshot();

    return {
      devices: snapshot.devices.map(normalizeServerDevice),
      projects: snapshot.projects,
      aiSessions: snapshot.ai_sessions,
      terminalSessions: snapshot.terminal_sessions,
      approvals: snapshot.approvals,
      notifications: snapshot.notifications ?? [],
      previewLinks: snapshot.preview_links.map(normalizeServerPreviewLink),
      realtimeEvents: snapshot.realtime_events,
      loadedAt: snapshot.generated_at,
      warnings: [],
    };
  }

  async loadProjects(): Promise<PlatformProjectSnapshot[]> {
    return fetchProjects();
  }

  async loadAiSessions(): Promise<PlatformAiSessionSnapshot[]> {
    return fetchAiSessions();
  }

  async loadAiSession(
    sessionId: string,
    options?: { refresh?: boolean },
  ): Promise<PlatformAiSessionSnapshot> {
    return fetchAiSession(sessionId, options);
  }

  async loadAiSessionMessages(
    sessionId: string,
    options?: { limit?: number; before?: string; refresh?: boolean },
  ): Promise<ServerAiMessagesPageResponse> {
    return fetchAiSessionMessages(sessionId, options);
  }

  createProject(input: Parameters<typeof apiCreateProject>[0]): Promise<PlatformProjectSnapshot> {
    return apiCreateProject(input);
  }

  updateProject(projectId: string, input: Parameters<typeof apiUpdateProject>[1]): Promise<PlatformProjectSnapshot> {
    return apiUpdateProject(projectId, input);
  }

  deleteProject(projectId: string): Promise<{ status: string; project_id: string }> {
    return apiDeleteProject(projectId);
  }

  connect(handler: TransportEventHandler, token?: string): void {
    this.handler = handler;
    connectMobileSocket(
      message => this.emit(this.toEvent(message)),
      {
        onStateChange: status => this.emit({ type: 'transport.status', status }),
        token,
      },
    );
  }

  disconnect(): void {
    disconnectMobileSocket();
    this.handler = null;
  }

  send(message: Record<string, unknown>): boolean {
    return getActiveSocket()?.send(message) ?? false;
  }

  async pairDevice(uniqueCode: string): Promise<PlatformDeviceSnapshot> {
    const result = await apiPairDevice(uniqueCode);
    return normalizeServerDevice(result.device);
  }

  async updateDeviceSettings(
    deviceId: string,
    input: Parameters<typeof apiUpdateDeviceSettings>[1],
  ): Promise<PlatformDeviceSnapshot> {
    const result = await apiUpdateDeviceSettings(deviceId, input);
    return normalizeServerDevice(result);
  }

  scanDeviceProjects(deviceId: string): Promise<{ status: string; device_id: string }> {
    return apiScanProjects(deviceId);
  }

  loadProjectFiles(projectId: string, path?: string): Promise<PlatformProjectFileListSnapshot> {
    return fetchProjectFiles(projectId, path);
  }

  loadProjectFileContent(projectId: string, path: string): Promise<PlatformProjectFileContentSnapshot> {
    return fetchProjectFileContent(projectId, path);
  }

  createAiSession(input: Parameters<typeof apiCreateAiSession>[0]): Promise<PlatformAiSessionSnapshot> {
    return apiCreateAiSession(input);
  }

  updateAiSession(sessionId: string, input: Parameters<typeof apiUpdateAiSession>[1]): Promise<PlatformAiSessionSnapshot> {
    return apiUpdateAiSession(sessionId, input);
  }

  pauseAiSession(sessionId: string): Promise<PlatformAiSessionSnapshot> {
    return apiPauseAiSession(sessionId);
  }

  resumeAiSession(sessionId: string): Promise<PlatformAiSessionSnapshot> {
    return apiResumeAiSession(sessionId);
  }

  terminateAiSession(sessionId: string): Promise<PlatformAiSessionSnapshot> {
    return apiTerminateAiSession(sessionId);
  }

  deleteAiSession(sessionId: string): Promise<{ status: string; session_id: string }> {
    return apiDeleteAiSession(sessionId);
  }

  sendAiMessage(
    sessionId: string,
    content: string,
    mode: 'voice' | 'text' = 'text',
  ): Promise<{ message_id: string; status: string }> {
    return apiSendAiMessage(sessionId, content, [], mode);
  }

  respondApproval(
    approvalId: string,
    decision: 'approved' | 'denied',
    options?: { selectedOptionId?: string; message?: string },
  ): Promise<PlatformApprovalSnapshot> {
    return apiRespondApproval(approvalId, decision, options);
  }

  markNotificationRead(notificationId: string): Promise<PlatformNotificationSnapshot> {
    return apiMarkNotificationRead(notificationId);
  }

  markAllNotificationsRead(): Promise<{ status: string; count: number }> {
    return apiMarkAllNotificationsRead();
  }

  createTerminalSession(input: Parameters<typeof apiCreateTerminalSession>[0]): Promise<ServerTerminalSession> {
    return apiCreateTerminalSession(input);
  }

  closeTerminalSession(sessionId: string): Promise<ServerTerminalSession> {
    return apiCloseTerminalSession(sessionId);
  }

  async loadTerminalSessionCommands(
    sessionId: string,
    limit = 20,
  ): Promise<PlatformTerminalCommandSnapshot[]> {
    const result = await fetchTerminalSessionCommands(sessionId, limit);
    return result.commands;
  }

  async loadDeviceTerminalCommands(
    deviceId: string,
    limit = 20,
  ): Promise<PlatformTerminalCommandSnapshot[]> {
    const result = await fetchDeviceTerminalCommands(deviceId, limit);
    return result.commands;
  }

  private emit(event: PlatformTransportEvent): void {
    this.handler?.(event);
  }

  private toEvent(message: Record<string, unknown>): PlatformTransportEvent {
    const type = String(message.type ?? '');

    if (type === 'mobile.connected') {
      return { type: 'mobile.connected', user: message.user, raw: message };
    }

    if (type === 'device.updated' && isServerDevice(message.device)) {
      return {
        type: 'device.updated',
        device: normalizeServerDevice(message.device),
        raw: message,
      };
    }

    if (type === 'device.removed') {
      return {
        type: 'device.removed',
        deviceId: String(message.device_id ?? ''),
        raw: message,
      };
    }

    if (type === 'ai.delta') {
      return {
        type: 'ai.delta',
        sessionId: String(message.session_id ?? ''),
        delta: String(message.delta ?? ''),
        currentStep: String(message.current_step ?? ''),
        messageId: asString(message.message_id),
        raw: message,
      };
    }

    if (type === 'ai.done') {
      return {
        type: 'ai.done',
        sessionId: String(message.session_id ?? ''),
        detail: String(message.detail ?? ''),
        raw: message,
      };
    }

    if (type === 'ai.error') {
      return {
        type: 'ai.error',
        sessionId: String(message.session_id ?? ''),
        error: String(message.error ?? message.detail ?? 'AI session failed'),
        raw: message,
      };
    }

    if (type === 'ai.session.created') {
      return {
        type: 'ai.session.created',
        sessionId: String(message.session_id ?? ''),
        raw: message,
      };
    }

    if (type === 'ai.session.updated' && isServerAiSession(message.session)) {
      return {
        type: 'ai.session.updated',
        session: message.session,
        raw: message,
      };
    }

    if (type === 'ai.session.deleted') {
      return {
        type: 'ai.session.deleted',
        sessionId: String(message.session_id ?? ''),
        raw: message,
      };
    }

    if (type === 'ai.sessions.updated') {
      return {
        type: 'ai.sessions.updated',
        deviceId: asString(message.device_id),
        raw: message,
      };
    }

    if (type === 'terminal.output') {
      return {
        type: 'terminal.output',
        sessionId: String(message.session_id ?? ''),
        data: String(message.data ?? ''),
        encoding: String(message.encoding ?? 'text'),
        raw: message,
      };
    }

    if (type === 'terminal.created') {
      return {
        type: 'terminal.created',
        sessionId: String(message.session_id ?? ''),
        raw: message,
      };
    }

    if (type === 'terminal.closed') {
      return {
        type: 'terminal.closed',
        sessionId: String(message.session_id ?? ''),
        raw: message,
      };
    }

    if (type === 'terminal.exit' || type === 'terminal.error') {
      return {
        type: 'terminal.exit',
        sessionId: String(message.session_id ?? ''),
        failed: type === 'terminal.error',
        raw: message,
      };
    }

    if (type === 'approval.requested' && isServerApproval(message.approval)) {
      return {
        type: 'approval.requested',
        approval: message.approval,
        raw: message,
      };
    }

    if (type === 'notification.created' && isServerNotification(message.notification)) {
      return {
        type: 'notification.created',
        notification: message.notification,
        raw: message,
      };
    }

    if (type === 'notification.updated' && isServerNotification(message.notification)) {
      return {
        type: 'notification.updated',
        notification: message.notification,
        raw: message,
      };
    }

    if (type === 'notifications.updated') {
      return {
        type: 'notifications.updated',
        readAll: Boolean(message.read_all),
        raw: message,
      };
    }

    if (type === 'preview.ready' && message.preview && typeof message.preview === 'object') {
      const preview = message.preview as Record<string, unknown>;
      return {
        type: 'preview.ready',
        preview: {
          id: String(preview.id ?? ''),
          sessionId: String(preview.session_id ?? ''),
          port: Number(preview.port ?? 0),
          shortUrl: String(preview.short_url ?? ''),
          targetUrl: String(preview.target_url ?? ''),
          expiresIn: asString(preview.expires_in),
          access: String(preview.access ?? 'private'),
          createdAt: asString(preview.created_at),
        },
        expiresIn: String(message.expires_in ?? preview.expires_in ?? ''),
        raw: message,
      };
    }

    if (type === 'project.updated' && isServerProject(message.project)) {
      return {
        type: 'project.updated',
        project: message.project,
        raw: message,
      };
    }

    if (type === 'project.deleted') {
      return {
        type: 'project.deleted',
        projectId: String(message.project_id ?? ''),
        raw: message,
      };
    }

    if (type === 'projects.updated') {
      return {
        type: 'projects.updated',
        deviceId: asString(message.device_id),
        raw: message,
      };
    }

    if (type === 'client.presence.updated') {
      return { type: 'client.presence.updated', raw: message };
    }

    return { type: 'raw', raw: message };
  }
}

export const platformTransport = new PlatformTransport();
