import type { StateCreator } from 'zustand';
import type { VibeCodingRun } from '../../data/platformModels';
import { platformTransport } from '../../services/platformTransport';
import type { ControlCenterState } from '../types';
import {
  formatActivityLabel,
  MAX_RUN_EVENTS,
  mergeApprovalReconcile,
  serverApprovalToClient,
  serverNotificationToClient,
  tail,
  upsertNotification,
} from '../internals';
import { ApiResponseError } from '../../api/client';
import {
  emptyHistoryPage,
  historyPageFromServer,
  mergeHistoryById,
} from '../historyPaging';

/**
 * Whether a failed approval-resolve should DROP the local pending copy so it
 * doesn't linger on the phone. Drop when:
 *  - the server is unreachable / timed out (no HTTP response — a network-level
 *    error, not an ApiResponseError; "server gone" from the phone's view), OR
 *  - the approval no longer exists server-side (404/410) or was already resolved
 *    (409) — nothing left for the user to act on.
 * Keep + propagate for retryable server errors (5xx etc.) — the next
 * reconcileSessionApprovals pass re-syncs from the server's truth.
 */
function shouldDropPendingApproval(error: unknown): boolean {
  if (error instanceof ApiResponseError) {
    return error.status === 404 || error.status === 410 || error.status === 409;
  }
  return true; // network / timeout — server unreachable
}

type ApprovalSlice = Pick<
  ControlCenterState,
  | 'approvals' | 'approvalHistory' | 'approvalHistoryPage'
  | 'notifications' | 'notificationHistory' | 'notificationHistoryPage'
  | 'unreadNotificationsTotal' | 'resolveApproval'
  | 'loadApprovalHistory' | 'loadNotificationHistory'
  | 'reconcileSessionApprovals'
  | 'refreshRecentApprovals'
  | 'markNotificationRead' | 'markAllNotificationsRead'
>;

export const createApprovalSlice: StateCreator<ControlCenterState, [], [], ApprovalSlice> = (set, get) => ({
  approvals: [],
  approvalHistory: [],
  approvalHistoryPage: emptyHistoryPage(),
  notifications: [],
  notificationHistory: [],
  notificationHistoryPage: emptyHistoryPage(),
  unreadNotificationsTotal: 0,

  loadApprovalHistory: async options => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before loading approval history.');
    }
    const currentPage = get().approvalHistoryPage;
    if (currentPage.loading) return;
    const reset = options?.reset === true;
    if (!reset && currentPage.initialized && !currentPage.hasMore) return;
    set({
      approvalHistoryPage: { ...currentPage, loading: true, error: undefined },
    });
    try {
      const response = await platformTransport.loadApprovalsPage({
        limit: 30,
        before: reset ? undefined : currentPage.nextBeforeCursor,
      });
      const incoming = response.items.map(serverApprovalToClient);
      set(state => ({
        approvalHistory: mergeHistoryById(incoming, state.approvalHistory),
        approvalHistoryPage: historyPageFromServer(response.page),
      }));
    } catch (error) {
      set(state => ({
        approvalHistoryPage: {
          ...state.approvalHistoryPage,
          initialized: true,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
      throw error;
    }
  },

  loadNotificationHistory: async options => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before loading notification history.');
    }
    const currentPage = get().notificationHistoryPage;
    if (currentPage.loading) return;
    const reset = options?.reset === true;
    if (!reset && currentPage.initialized && !currentPage.hasMore) return;
    set({
      notificationHistoryPage: { ...currentPage, loading: true, error: undefined },
    });
    try {
      const response = await platformTransport.loadNotificationsPage({
        limit: 30,
        before: reset ? undefined : currentPage.nextBeforeCursor,
      });
      const incoming = response.items.map(serverNotificationToClient);
      set(state => ({
        notificationHistory: mergeHistoryById(incoming, state.notificationHistory),
        notificationHistoryPage: historyPageFromServer(response.page),
      }));
    } catch (error) {
      set(state => ({
        notificationHistoryPage: {
          ...state.notificationHistoryPage,
          initialized: true,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
      throw error;
    }
  },

  // Session-level approval reconcile (会话级对账闭环). GET
  // /api/approvals?session_id= returns the server's FULL pending+resolved list
  // for this session (the endpoint was built for exactly this — its comment
  // says 手机端靠它对账自愈 — but the phone never called it). Upserting the
  // server records dissolves ghost pends: once the store holds the server's
  // authoritative resolved record, the session screen's byId guard stops the
  // event-fallback resurrection (the ghost itself is a screen-memo artifact,
  // never a store row, so nothing needs deleting here). Cursor-loaded history
  // archive stays in sync; other sessions' approvals are untouched. Failure is
  // swallowed: live WS events remain the first line, and the next
  // focus/refresh reconciles again — the loop always closes, one cycle later.
  reconcileSessionApprovals: async sessionId => {
    if (!get().serverMode) return;
    const incoming = (
      await platformTransport.loadSessionApprovals(sessionId)
    ).map(serverApprovalToClient);
    set(state => {
      const pendingCount = (items: { status: string }[]) =>
        items.filter(item => item.status === 'pending').length;
      return {
        approvals: mergeApprovalReconcile(state.approvals, incoming),
        approvalHistory: mergeHistoryById(
          incoming.filter(item => item.status !== 'pending'),
          state.approvalHistory,
        ),
        // 未读口径同步:对账前本会话本地 pending 与服务端真值的差值(幽灵
        // 多算→下调;漏算→上调),不触碰其他会话的计数。
        unreadNotificationsTotal: Math.max(
          0,
          state.unreadNotificationsTotal +
            pendingCount(incoming) -
            state.approvals.filter(
              item =>
                item.sessionId === sessionId && item.status === 'pending',
            ).length,
        ),
      };
    });
  },

  // 全局近期审批拉取(真相通道另一半)。派生 client_response 卡按设计幸存
  // run 终态,但它的到达通道只有 WS 实时事件——事件在服务端重放缓存里只活
  // 分钟级(500 条环形),App 恰好不在前台的那几分钟 = 卡片对手机永久不可见
  // (2026-11-01 审批卡不可见事故)。启动/恢复时用分页接口拉最新一批
  // (pending 卡几乎总在最新页)按 id upsert,堵死这条缺口。与
  // reconcileSessionApprovals 同用 mergeApprovalReconcile(同题顶替规则一致);
  // 失败静默,由下一次 init/refresh 重试。
  refreshRecentApprovals: async () => {
    if (!get().serverMode) return;
    const page = await platformTransport.loadApprovalsPage({ limit: 100 });
    const incoming = page.items.map(serverApprovalToClient);
    set(state => ({
      approvals: mergeApprovalReconcile(state.approvals, incoming),
    }));
  },

  resolveApproval: async (approvalId, decision, options) => {
    const approval = get().approvals.find(item => item.id === approvalId);
    if (!approval) return;

    if (!get().serverMode) {
      throw new Error('Platform connection is required before resolving an approval.');
    }

    let resolved;
    try {
      resolved = serverApprovalToClient(
        await platformTransport.respondApproval(approvalId, decision, options),
      );
    } catch (error) {
      // Server unreachable (network/timeout) OR approval gone server-side
      // (404/410/409): drop the local pending copy so it doesn't linger. A
      // reconnect refresh re-syncs the server's truth. Retryable errors (5xx)
      // keep it pending; the error propagates so the UI can toast/retry.
      if (shouldDropPendingApproval(error)) {
        set(state => ({
          approvals: state.approvals.filter(item => item.id !== approvalId),
        }));
      }
      throw error;
    }
    set(state => ({
      approvals: state.approvals.map(item =>
        item.id === approvalId ? resolved : item
      ),
      approvalHistory: mergeHistoryById([resolved], state.approvalHistory),
      notifications: state.notifications.map(item =>
        item.type === 'approval' && item.approvalId === approvalId
          ? { ...item, read: true }
          : item,
      ),
      notificationHistory: state.notificationHistory.map(item =>
        item.type === 'approval' && item.approvalId === approvalId
          ? { ...item, read: true }
          : item,
      ),
      unreadNotificationsTotal: Math.max(
        0,
        state.unreadNotificationsTotal -
          (state.notifications.some(item => item.approvalId === approvalId && !item.read) ||
          state.notificationHistory.some(item => item.approvalId === approvalId && !item.read)
            ? 1
            : 0),
      ),
      vibeRuns: state.vibeRuns.map(run => {
        if (run.id !== resolved.sessionId) return run;
        const resolvedAtMs = Date.parse(resolved.resolvedAt ?? '') || Date.now();
        const status: VibeCodingRun['events'][number]['status'] =
          decision === 'approved' ? 'done' : 'failed';
        const nextEvent: VibeCodingRun['events'][number] = {
          id: `approval-${approvalId}`,
          type: 'approval' as const,
          title:
            decision === 'approved'
              ? 'Approval granted'
              : 'Approval denied',
          detail: resolved.title,
          status,
          timestamp: resolved.resolvedAt ?? new Date(resolvedAtMs).toISOString(),
        };
        return {
          ...run,
          status:
            run.runStateVersion !== undefined
              ? run.status
              : decision === 'approved'
                ? run.status === 'waiting_approval'
                  ? 'running'
                  : run.status
                : 'failed',
          currentStep:
            decision === 'approved'
              ? 'Approval granted. Waiting for agent to continue.'
              : 'Approval denied from mobile.',
          lastActivityMs: Math.max(run.lastActivityMs ?? 0, resolvedAtMs),
          updatedAt: formatActivityLabel(
            Math.max(run.lastActivityMs ?? 0, resolvedAtMs),
          ),
          events: tail(
            [
              ...run.events.filter(item => item.id !== nextEvent.id),
              nextEvent,
            ],
            MAX_RUN_EVENTS,
          ),
        };
      }),
    }));
  },

  markNotificationRead: async notificationId => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before marking notifications read.');
    }
    const previous =
      get().notifications.find(item => item.id === notificationId) ??
      get().notificationHistory.find(item => item.id === notificationId);
    const updated = serverNotificationToClient(
      await platformTransport.markNotificationRead(notificationId),
    );
    set(state => ({
      notifications: upsertNotification(state.notifications, updated),
      notificationHistory: upsertNotification(state.notificationHistory, updated),
      unreadNotificationsTotal:
        previous && !previous.read && updated.read
          ? Math.max(0, state.unreadNotificationsTotal - 1)
          : state.unreadNotificationsTotal,
    }));
  },

  markAllNotificationsRead: async () => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before marking notifications read.');
    }
    await platformTransport.markAllNotificationsRead();
    set(state => ({
      notifications: state.notifications.map(item => ({ ...item, read: true })),
      notificationHistory: state.notificationHistory.map(item => ({ ...item, read: true })),
      unreadNotificationsTotal: 0,
    }));
  },
});
