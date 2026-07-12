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
  'approvals' | 'notifications' | 'resolveApproval' | 'markNotificationRead' | 'markAllNotificationsRead'
>;

export const createApprovalSlice: StateCreator<ControlCenterState, [], [], ApprovalSlice> = (set, get) => ({
  approvals: [],
  notifications: [],

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
      notifications: state.notifications.map(item =>
        item.type === 'approval' && item.approvalId === approvalId
          ? { ...item, read: true }
          : item,
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
    const updated = serverNotificationToClient(
      await platformTransport.markNotificationRead(notificationId),
    );
    set(state => ({
      notifications: upsertNotification(state.notifications, updated),
    }));
  },

  markAllNotificationsRead: async () => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before marking notifications read.');
    }
    await platformTransport.markAllNotificationsRead();
    set(state => ({
      notifications: state.notifications.map(item => ({ ...item, read: true })),
    }));
  },
});
