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
    // v2:每选项预览行(≤8×200);仅展示,不进作答。
    previews?: string[];
  }>;
  // tool_ask(自有 MCP 交互工具):interaction_id 是 agent bridge 生成的幂等键,
  // tool_input 携带原始提问载荷(allow_custom/multi 渲染判定用),expires_at 为
  // agent 计算的作答 SLA(ms epoch)。
  interaction_id?: string;
  tool_input?: Record<string, unknown>;
  expires_at?: number;
  // v2 aliang-options 协议字段(server 透传;v1 块缺省不 emit)。
  multi?: boolean;
  allow_custom?: boolean;
  header?: string;
  v?: number;
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
  resolved_at?: string;
}

export const fetchApprovals = (): Promise<ServerApproval[]> =>
  apiGet<ServerApproval[]>('/api/approvals');

// 会话级对账数据源:服务端返回该会话 pending+resolved 的全量真值(注释明写
// 「手机端会话级审批对账」),不带分页时直接返回数组。手机端用它整体替换
// 本地该会话的审批,清掉快照刷新/事件兜底复活出来的幽灵 pending。
export const fetchSessionApprovals = (sessionId: string): Promise<ServerApproval[]> =>
  apiGet<ServerApproval[]>(
    `/api/approvals?session_id=${encodeURIComponent(sessionId)}`,
  );

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
  input: {
    selectedOptionId?: string;
    // v2 多选:multi 卡传 id 数组(按选项声明顺序)。
    selectedOptionIds?: string[];
    message?: string;
  } = {},
): Promise<ServerApproval> =>
  apiPost(`/api/approvals/${approvalId}/respond`, {
    decision,
    selected_option_id: input.selectedOptionId,
    selected_option_ids: input.selectedOptionIds,
    message: input.message,
  });
