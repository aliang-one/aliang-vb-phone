import type { StateCreator } from 'zustand';
import { platformTransport } from '../../services/platformTransport';
import type { ControlCenterState } from '../types';
import {
  serverApprovalToClient,
  serverNotificationToClient,
  upsertNotification,
} from '../internals';

type ApprovalSlice = Pick<
  ControlCenterState,
  'approvals' | 'notifications' | 'resolveApproval' | 'markNotificationRead' | 'markAllNotificationsRead'
>;

export const createApprovalSlice: StateCreator<ControlCenterState, [], [], ApprovalSlice> = (set, get) => ({
  approvals: [],
  notifications: [],

  resolveApproval: async (approvalId, decision) => {
    const approval = get().approvals.find(item => item.id === approvalId);
    if (!approval) return;

    if (!get().serverMode) {
      throw new Error('Platform connection is required before resolving an approval.');
    }

    const resolved = serverApprovalToClient(
      await platformTransport.respondApproval(approvalId, decision),
    );
    set(state => ({
      approvals: state.approvals.map(item =>
        item.id === approvalId ? resolved : item
      ),
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

