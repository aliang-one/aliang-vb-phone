import { apiGet } from './client';
import type { ServerAiSession } from './sessions';
import type { ServerApproval } from './approvals';
import type { ServerDevice } from './devices';

export interface DashboardData {
  generated_at: string;
  summary: {
    devices_online: number;
    devices_total: number;
    ai_sessions_active: number;
    ai_sessions_total: number;
    projects_total: number;
    pending_approvals: number;
  };
  active_vibecodings: ServerAiSession[];
  recent_vibecodings: ServerAiSession[];
  pending_approvals: ServerApproval[];
  online_devices: ServerDevice[];
}

export const fetchDashboard = (): Promise<DashboardData> =>
  apiGet<DashboardData>('/api/dashboard');
