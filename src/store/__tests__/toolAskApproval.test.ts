// tool_ask 卡片映射(批次③手机侧):server 的 kind=tool_ask 审批卡把
// interaction_id/tool_input/expires_at 带进 store,自定义回复入口对
// tool_ask 开放(纯自由文本提问没有 options,只有 custom reply + deny)。
import { serverApprovalToClient } from '../internals';

const serverApproval = {
  id: 'appr_1',
  approval_id: 'appr_1',
  user_id: 'u1',
  device_id: 'd1',
  session_id: 'ais_1',
  kind: 'tool_ask',
  title: '选个方案',
  summary: 'AI 交互提问',
  tool_name: 'mcp__aliang__ask_user',
  options: [
    { id: 'a', label: '方案A' },
    { id: 'b', label: '方案B', response: '走B' },
  ],
  risk: 'low' as const,
  status: 'pending' as const,
  created_at: '2026-10-16T00:00:00Z',
  interaction_id: 'ta_abc',
  tool_input: { title: '选个方案', allow_custom: true },
  expires_at: 1792000000000,
};

describe('serverApprovalToClient tool_ask mapping', () => {
  it('carries interaction/toolInput/expiresAt into the client shape', () => {
    const approval = serverApprovalToClient(serverApproval as never);
    expect(approval.kind).toBe('tool_ask');
    expect(approval.interactionId).toBe('ta_abc');
    expect(approval.toolInput).toEqual({ title: '选个方案', allow_custom: true });
    expect(approval.expiresAt).toBe(1792000000000);
    expect(approval.options).toHaveLength(2);
  });

  it('leaves legacy approvals untouched (no tool_ask fields)', () => {
    const { interaction_id: _i, tool_input: _t, expires_at: _e, ...legacy } =
      serverApproval;
    const approval = serverApprovalToClient({
      ...legacy,
      kind: 'dangerous_command',
    } as never);
    expect(approval.kind).toBe('dangerous_command');
    expect(approval.interactionId).toBeUndefined();
    expect(approval.toolInput).toBeUndefined();
    expect(approval.expiresAt).toBeUndefined();
  });
});
