import { apiGet } from './client';
import type { PlatformUser } from './auth';
import type { ServerApproval } from './approvals';
import type { ServerDevice } from './devices';
import type { ServerProject } from './projects';
import type { ServerAiSession, ServerTerminalSession } from './sessions';

export interface ServerPreviewLink {
  id: string;
  preview_id: string;
  session_id: string;
  device_id: string;
  port: number;
  short_url: string;
  target_url: string;
  expires_in?: string;
  access: 'private' | 'team' | 'public';
  created_at: string;
}

export interface ServerRealtimeEvent {
  id: string;
  origin_instance_id: string;
  created_at: string;
  user_id: string;
  device_id?: string;
  session_id?: string;
  message_type: string;
  direction: string;
  source: {
    kind: string;
    user_id?: string;
    device_id?: string;
    connection_id?: string;
  };
  target: {
    kind: string;
    user_id?: string;
    device_id?: string;
  };
  payload: unknown;
}

export interface MobilePlatformSnapshot {
  generated_at: string;
  user: PlatformUser;
  summary: {
    devices_online: number;
    devices_total: number;
    projects_total: number;
    ai_sessions_active: number;
    ai_sessions_total: number;
    terminal_sessions_total: number;
    pending_approvals: number;
    preview_links_total: number;
  };
  stats: unknown;
  devices: ServerDevice[];
  projects: ServerProject[];
  ai_sessions: ServerAiSession[];
  terminal_sessions: ServerTerminalSession[];
  approvals: ServerApproval[];
  preview_links: ServerPreviewLink[];
  realtime_events: ServerRealtimeEvent[];
}

export const fetchMobileSnapshot = (eventLimit = 80): Promise<MobilePlatformSnapshot> =>
  apiGet<MobilePlatformSnapshot>(`/api/mobile/snapshot?event_limit=${eventLimit}`);
