import { apiDelete, apiGet, apiPost } from './client';

export type PortMappingStatus = 'active' | 'revoked';
export type TunnelConnectionStatus =
  | 'disabled'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

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
  tunnel_status?: TunnelConnectionStatus;
}

export interface CreatePortMappingInput {
  deviceId: string;
  targetHost: string;
  targetPort: number;
  expiresInSeconds: number;
}

export const fetchPortMappings = async (): Promise<PortMapping[]> => {
  const response = await apiGet<{ mappings: PortMapping[] }>('/api/port-mappings');
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
    { timeoutMs: 20_000 },
  );

export const revokePortMapping = (mappingId: string): Promise<PortMapping> =>
  apiDelete<PortMapping>(
    `/api/port-mappings/${encodeURIComponent(mappingId)}`,
  );
