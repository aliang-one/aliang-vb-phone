import type { StateCreator } from 'zustand';
import type { VibeCodingRun } from '../../data/platformModels';
import { platformTransport } from '../../services/platformTransport';
import type { ControlCenterState } from '../types';
import {
  formatActivityLabel,
  MAX_RUN_EVENTS,
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
 * Keep + propagate for retryable server errors (5xx etc.) so the user can retry.
 * A reconnect/foreground refresh re-syncs `approvals` from the server's truth, so
 * a dropped approval reappears if it still exists server-side.
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
