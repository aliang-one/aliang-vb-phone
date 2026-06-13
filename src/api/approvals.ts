import { apiGet, apiPost } from './client';

export interface ServerApproval {
  id: string;
  approval_id: string;
  user_id: string;
  device_id: string;
  project_id?: string;
  session_id?: string;
  terminal_id?: string;
  kind: string;
  title: string;
  summary: string;
  command?: string;
  files?: string[];
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
  resolved_at?: string;
}

export const fetchApprovals = (): Promise<ServerApproval[]> =>
  apiGet<ServerApproval[]>('/api/approvals');

export const respondApproval = (
  approvalId: string,
  decision: 'approved' | 'denied'
): Promise<ServerApproval> =>
  apiPost(`/api/approvals/${approvalId}/respond`, { decision });
