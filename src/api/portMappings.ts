import { apiDelete, apiGet, apiPost } from './client';

export type PortMappingStatus = 'active' | 'revoked';
// Live tunnel states exactly as the server emits them (tunnel/control.ts and
// the alianggate agent's tunnel.Manager / piko state logger). Unknown future
// states degrade to 'unknown' health instead of breaking the union.
export type TunnelConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'stopped'
  | 'control_disconnected';

export interface TunnelStatusInfo {
  deviceId: string;
  state: TunnelConnectionStatus | string;
  updatedAt: string;
  error?: string;
  expiresAt?: string;
}

export interface PortMapping {
  id: string;
  slug: string;
  user_id: string;
  device_id: string;
  target_host: string;
  target_port: number;
  upstream_scheme: 'http';
  status: PortMappingStatus;
  created_at: string;
  expires_at: string;
  revoked_at?: string;
  short_url: string;
  tunnel_status?: TunnelStatusInfo;
}

export interface CreatePortMappingInput {
  deviceId: string;
  targetHost: string;
  targetPort: number;
  expiresInSeconds: number;
}

export const fetchPortMappings = async (
  deviceId?: string,
): Promise<PortMapping[]> => {
  const path = deviceId
    ? `/api/port-mappings?device_id=${encodeURIComponent(deviceId)}`
    : '/api/port-mappings';
  const response = await apiGet<{ mappings: PortMapping[] }>(path);
  return response.mappings;
};

export const createPortMapping = (
  input: CreatePortMappingInput,
): Promise<PortMapping> =>
  apiPost<PortMapping>(
    '/api/port-mappings',
    {
      device_id: input.deviceId,
      target_host: input.targetHost,
      target_port: input.targetPort,
      expires_in_seconds: input.expiresInSeconds,
    },
    // The server chains tunnel.configure (35s fence covering the Agent's 30s
    // Piko WSS handshake budget) before creating the mapping; a 20s abort cut
    // off slow networks the server would have served fine.
    { timeoutMs: 40_000 },
  );

export const revokePortMapping = (mappingId: string): Promise<PortMapping> =>
  apiDelete<PortMapping>(
    `/api/port-mappings/${encodeURIComponent(mappingId)}`,
  );

// Tunnel health buckets for UI display. The tunnel is per-device, so every
// mapping of one device shares the same status; 'unknown' means the server
// sent no status (older server) or an unrecognized state.
export type TunnelHealth = 'ok' | 'pending' | 'down' | 'unknown';

export const tunnelHealth = (
  status: TunnelStatusInfo | undefined,
): TunnelHealth => {
  switch (status?.state) {
    case 'connected':
      return 'ok';
    case 'connecting':
    case 'reconnecting':
      return 'pending';
    case 'failed':
    case 'stopped':
    case 'control_disconnected':
      return 'down';
    default:
      return 'unknown';
  }
};
