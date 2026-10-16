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
  // tool_ask(自有 MCP 交互工具):interaction_id 是 agent bridge 生成的幂等键,
  // tool_input 携带原始提问载荷(allow_custom/multi 渲染判定用),expires_at 为
  // agent 计算的作答 SLA(ms epoch)。
  interaction_id?: string;
  tool_input?: Record<string, unknown>;
  expires_at?: number;
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
