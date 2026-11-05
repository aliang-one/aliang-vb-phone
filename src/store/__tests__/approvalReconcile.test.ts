// 会话级审批对账(mergeApprovalReconcile + reconcileSessionApprovals):
// 服务端 GET /api/approvals?session_id= 是该会话 pending+resolved 全量真值,
// 手机端 upsert 后,会话屏 byId 守卫即可压制事件兜底复活的幽灵 pending。
import { platformTransport, type PlatformApprovalSnapshot } from '../../services/platformTransport';
import {
  mergeApprovalReconcile,
  serverApprovalToClient,
} from '../internals';
import { useControlCenterStore } from '../controlCenterStore';

jest.mock('../../services/platformTransport', () => ({
  platformTransport: {
    loadSessionApprovals: jest.fn(),
  },
}));

const mockedLoadSessionApprovals =
  platformTransport.loadSessionApprovals as jest.MockedFunction<
    typeof platformTransport.loadSessionApprovals
  >;

const baseApproval: PlatformApprovalSnapshot = {
  id: 'appr_1',
  approval_id: 'appr_1',
  user_id: 'u1',
  device_id: 'd1',
  session_id: 'ais_1',
  kind: 'client_response',
  title: '要继续吗?',
  summary: '等待确认',
  risk: 'low',
  status: 'pending',
  created_at: '2026-10-30T00:00:00Z',
};

const server = (
  overrides: Partial<PlatformApprovalSnapshot>,
): PlatformApprovalSnapshot => ({
  ...baseApproval,
  ...overrides,
});

describe('mergeApprovalReconcile', () => {
  it('upserts the server record over the local row (ghost fix core)', () => {
    const localResolvedGone = serverApprovalToClient(
      server({ id: 'appr_1', status: 'denied', resolved_at: '2026-10-30T01:00:00Z' }),
    );
    const other = serverApprovalToClient(
      server({ id: 'appr_2', session_id: 'ais_other' }),
    );
    const merged = mergeApprovalReconcile([localResolvedGone, other], [
      serverApprovalToClient(server({ id: 'appr_1', status: 'denied' })),
    ]);
    const merged1 = merged.find(item => item.id === 'appr_1');
    expect(merged1?.status).toBe('denied');
    // 其他会话不受影响
    expect(merged.find(item => item.id === 'appr_2')?.sessionId).toBe('ais_other');
  });

  it('keeps local-only entries (a reconcile response cannot repudiate what it never carried)', () => {
    const localOnly = serverApprovalToClient(
      server({ id: 'appr_local', status: 'pending' }),
    );
    const merged = mergeApprovalReconcile([localOnly], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('appr_local');
  });

  it('demotes same-ask local pends when the server reports a newer pending (supersede)', () => {
    const localGhost = serverApprovalToClient(
      server({ id: 'appr_old', status: 'pending' }),
    );
    const serverNewerPending = serverApprovalToClient(
      server({ id: 'appr_new', status: 'pending' }),
    );
    const merged = mergeApprovalReconcile([localGhost], [serverNewerPending]);
    expect(merged.find(item => item.id === 'appr_old')?.status).toBe('denied');
    expect(merged.find(item => item.id === 'appr_new')?.status).toBe('pending');
  });
});

describe('reconcileSessionApprovals', () => {
  beforeEach(() => {
    mockedLoadSessionApprovals.mockReset();
    useControlCenterStore.setState({
      serverMode: true,
      approvals: [],
      approvalHistory: [],
      unreadNotificationsTotal: 0,
    });
  });

  it('replaces the session approvals with server truth and syncs the unread delta', async () => {
    // 幽灵场景:本地只剩 pending 幽灵快照(权威 resolved 记录已被快照替换丢弃)。
    useControlCenterStore.setState({
      approvals: [
        serverApprovalToClient(server({ id: 'appr_ghost', status: 'pending' })),
      ],
      unreadNotificationsTotal: 3, // 幽灵把 1 个已答复的算进了未读
    });
    mockedLoadSessionApprovals.mockResolvedValue([
      server({ id: 'appr_ghost', status: 'denied', resolved_at: '2026-10-30T01:00:00Z' }),
    ]);

    await useControlCenterStore.getState().reconcileSessionApprovals('ais_1');

    const state = useControlCenterStore.getState();
    expect(state.approvals.find(item => item.id === 'appr_ghost')?.status).toBe('denied');
    // 本会话 pending 从 1 降到 0,未读按行数差值下调 1(3 → 2)。
    expect(state.unreadNotificationsTotal).toBe(2);
  });

  it('raises unread when the server has more pending than the local session', async () => {
    // 漏算场景:WS 事件丢了,服务端有 2 个 pending 本地只有 1 个。
    useControlCenterStore.setState({
      approvals: [
        serverApprovalToClient(server({ id: 'appr_a', status: 'pending' })),
      ],
      unreadNotificationsTotal: 1,
    });
    mockedLoadSessionApprovals.mockResolvedValue([
      server({ id: 'appr_a', status: 'pending' }),
      server({ id: 'appr_b', status: 'pending' }),
    ]);

    await useControlCenterStore.getState().reconcileSessionApprovals('ais_1');

    expect(useControlCenterStore.getState().unreadNotificationsTotal).toBe(2);
  });

  it('merges resolved records into the cursor history archive', async () => {
    mockedLoadSessionApprovals.mockResolvedValue([
      server({ id: 'appr_ghost', status: 'approved', resolved_at: '2026-10-30T01:00:00Z' }),
    ]);

    await useControlCenterStore.getState().reconcileSessionApprovals('ais_1');

    expect(
      useControlCenterStore.getState().approvalHistory.map(item => item.id),
    ).toContain('appr_ghost');
  });

  it('no-ops without a platform connection', async () => {
    useControlCenterStore.setState({ serverMode: false });
    await useControlCenterStore.getState().reconcileSessionApprovals('ais_1');
    expect(mockedLoadSessionApprovals).not.toHaveBeenCalled();
  });
});
