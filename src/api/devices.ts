import { apiGet, apiPost, apiPatch } from './client';
import type { ServerAiSession } from './sessions';

export interface ServerDevice {
  id: string;
  device_id: string;
  user_id: string;
  user?: {
    id: string;
    email?: string;
    name?: string;
    role?: string;
  };
  name: string;
  platform: string;
  unique_code?: string;
  agent_version?: string;
  status: 'online' | 'offline';
  capabilities: string[];
  tools: Array<{
    id: string;
    name?: string;
    command?: string;
    path?: string;
    available?: boolean;
    description?: string;
    commands?: Array<{
      name: string;
      description?: string;
      argHint?: string;
      scope?: string;
    }>;
  }>;
  history: Array<{
    tool: string;
    path: string;
    exists?: boolean;
    file_count?: number;
    total_size?: number;
    updated_at?: string;
  }>;
  agent_started_at?: string;
  last_seen_at?: string;
  remote_terminal_enabled: boolean;
  ai_control_enabled: boolean;
  created_at: string;
  paired_at?: string;
  bound_at?: string;
  location?: string;
  host?: string;
  cpu_load?: number;
  mem_load?: number;
  battery?: number;
  active_ports: number[];
  authorized_directories: string[];
  project_ids: string[];
  approval_policy?: {
    scheme: 'balanced' | 'allow_all' | 'custom';
    version: number;
    hash: string;
  };
}

export interface DeviceDetail extends ServerDevice {
  agent_connected: boolean;
  terminal_sessions: unknown[];
  ai_sessions: ServerAiSession[];
}

export type ApprovalScheme = 'balanced' | 'allow_all' | 'custom';
export type ApprovalDecision = 'auto_approve' | 'require_approval' | 'auto_deny';

export const fetchDevices = (): Promise<ServerDevice[]> =>
  apiGet<ServerDevice[]>('/api/devices');

export const fetchDeviceDetail = (deviceId: string): Promise<DeviceDetail> =>
  apiGet<DeviceDetail>(`/api/devices/${deviceId}`);

export const fetchDeviceAiSessions = (deviceId: string): Promise<ServerAiSession[]> =>
  apiGet<ServerAiSession[]>(`/api/devices/${deviceId}/ai-sessions`);

export const fetchDeviceTerminalSessions = (deviceId: string): Promise<unknown[]> =>
  apiGet<unknown[]>(`/api/devices/${deviceId}/terminal-sessions`);

export const updateDeviceSettings = (
  deviceId: string,
  settings: {
    name?: string;
    remote_terminal_enabled?: boolean;
    ai_control_enabled?: boolean;
    approval_policy?: {
      scheme?: ApprovalScheme;
      custom_rule_overrides?: Record<string, ApprovalDecision>;
    };
  }
): Promise<ServerDevice> =>
  apiPatch(`/api/devices/${deviceId}/settings`, settings);

// Switch a device's approval-policy scheme (balanced / allow_all / custom).
export const updateDeviceApprovalScheme = (
  deviceId: string,
  scheme: ApprovalScheme,
): Promise<ServerDevice> =>
  apiPatch(`/api/devices/${deviceId}/settings`, { approval_policy: { scheme } });

// Toggle per-rule decisions on a device's custom policy (rule id -> decision).
export const patchDeviceCustomPolicy = (
  deviceId: string,
  customRuleOverrides: Record<string, ApprovalDecision>,
): Promise<ServerDevice> =>
  apiPatch(`/api/devices/${deviceId}/approval-policy/custom`, {
    custom_rule_overrides: customRuleOverrides,
  });

export const unbindDevice = (deviceId: string): Promise<{ status: string; device_id: string }> =>
  apiPost(`/api/devices/${deviceId}/unbind`);
