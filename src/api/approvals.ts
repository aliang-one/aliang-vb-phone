import { apiGet, apiPost } from './client';
import { cursorPageQuery, type ServerCursorPageResponse } from './pagination';

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
  tool_name?: string;
  files?: string[];
  options?: Array<{
    id: string;
    label: string;
    description?: string;
    response?: string;
  }>;
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
  resolved_at?: string;
}

export const fetchApprovals = (): Promise<ServerApproval[]> =>
  apiGet<ServerApproval[]>('/api/approvals');

export const fetchApprovalsPage = (options?: {
  limit?: number;
  before?: string;
}): Promise<ServerCursorPageResponse<ServerApproval>> =>
  apiGet<ServerCursorPageResponse<ServerApproval>>(
    `/api/approvals?${cursorPageQuery(options)}`,
  );

export const respondApproval = (
  approvalId: string,
  decision: 'approved' | 'denied',
  input: { selectedOptionId?: string; message?: string } = {},
): Promise<ServerApproval> =>
  apiPost(`/api/approvals/${approvalId}/respond`, {
    decision,
    selected_option_id: input.selectedOptionId,
    message: input.message,
  });
