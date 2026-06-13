import {
  fetchDevices,
  pairDevice as apiPairDevice,
  type ServerDevice,
} from '../api/devices';
import {
  fetchProjectFileContent,
  fetchProjectFiles,
  fetchProjects,
  scanDeviceProjects as apiScanProjects,
  type ServerProjectFileContent,
  type ServerProjectFileList,
  type ServerProject,
} from '../api/projects';
import {
  closeTerminalSession as apiCloseTerminalSession,
  createAiSession as apiCreateAiSession,
  createTerminalSession as apiCreateTerminalSession,
  fetchAiSessions,
  sendAiMessage as apiSendAiMessage,
  type ServerAiSession,
  type ServerTerminalSession,
} from '../api/sessions';
import {
  fetchApprovals,
  respondApproval as apiRespondApproval,
  type ServerApproval,
} from '../api/approvals';
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

export interface PlatformSnapshot {
  devices: PlatformDeviceSnapshot[];
  projects: PlatformProjectSnapshot[];
  aiSessions: PlatformAiSessionSnapshot[];
  approvals: PlatformApprovalSnapshot[];
  loadedAt: string;
  warnings: string[];
}

export interface PlatformPreviewSnapshot {
  id: string;
  sessionId: string;
  port: number;
  shortUrl: string;
  targetUrl: string;
  access: string;
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
  | { type: 'ai.sessions.updated'; deviceId?: string; raw: Record<string, unknown> }
  | { type: 'terminal.output'; sessionId: string; data: string; encoding: string; raw: Record<string, unknown> }
  | { type: 'terminal.created'; sessionId: string; raw: Record<string, unknown> }
  | { type: 'terminal.exit'; sessionId: string; failed: boolean; raw: Record<string, unknown> }
  | { type: 'approval.requested'; approval: PlatformApprovalSnapshot; raw: Record<string, unknown> }
  | { type: 'preview.ready'; preview: PlatformPreviewSnapshot; expiresIn: string; raw: Record<string, unknown> }
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

const safeLoad = async <T>(
  label: string,
  loader: () => Promise<T>,
  fallback: T,
  warnings: string[],
): Promise<T> => {
  try {
    return await loader();
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    warnings.push(`${label}: ${detail}`);
    console.warn(`[platformTransport] ${label} failed:`, error);
    return fallback;
  }
};

class PlatformTransport {
  private handler: TransportEventHandler | null = null;

  get connected(): boolean {
    return Boolean(getActiveSocket()?.connected);
  }

  async loadSnapshot(): Promise<PlatformSnapshot> {
    const warnings: string[] = [];
    const serverDevices = await fetchDevices();
    const [projects, aiSessions, approvals] = await Promise.all([
      safeLoad('projects', fetchProjects, [] as PlatformProjectSnapshot[], warnings),
      safeLoad('aiSessions', fetchAiSessions, [] as PlatformAiSessionSnapshot[], warnings),
      safeLoad('approvals', fetchApprovals, [] as PlatformApprovalSnapshot[], warnings),
    ]);

    return {
      devices: serverDevices.map(normalizeServerDevice),
      projects,
      aiSessions,
      approvals,
      loadedAt: new Date().toISOString(),
      warnings,
    };
  }

  async loadProjects(): Promise<PlatformProjectSnapshot[]> {
    return fetchProjects();
  }

  async loadAiSessions(): Promise<PlatformAiSessionSnapshot[]> {
    return fetchAiSessions();
  }

  connect(handler: TransportEventHandler): void {
    this.handler = handler;
    connectMobileSocket(
      message => this.emit(this.toEvent(message)),
      {
        onStateChange: status => this.emit({ type: 'transport.status', status }),
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

  sendAiMessage(sessionId: string, content: string): Promise<{ message_id: string; status: string }> {
    return apiSendAiMessage(sessionId, content);
  }

  respondApproval(approvalId: string, decision: 'approved' | 'denied'): Promise<PlatformApprovalSnapshot> {
    return apiRespondApproval(approvalId, decision);
  }

  createTerminalSession(input: Parameters<typeof apiCreateTerminalSession>[0]): Promise<ServerTerminalSession> {
    return apiCreateTerminalSession(input);
  }

  closeTerminalSession(sessionId: string): Promise<ServerTerminalSession> {
    return apiCloseTerminalSession(sessionId);
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
          access: String(preview.access ?? 'private'),
        },
        expiresIn: String(message.expires_in ?? ''),
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
