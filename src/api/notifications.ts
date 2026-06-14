import { apiGet, apiPost } from './client';

export interface ServerNotification {
  id: string;
  notification_id: string;
  user_id: string;
  type: 'approval' | 'completed' | 'error' | 'device_offline';
  title: string;
  body: string;
  device_id?: string;
  session_id?: string;
  approval_id?: string;
  read: boolean;
  created_at: string;
  read_at?: string;
}

export const fetchNotifications = (): Promise<ServerNotification[]> =>
  apiGet<ServerNotification[]>('/api/notifications');

export const markNotificationRead = (notificationId: string): Promise<ServerNotification> =>
  apiPost<ServerNotification>(`/api/notifications/${notificationId}/read`);

export const markAllNotificationsRead = (): Promise<{ status: string; count: number }> =>
  apiPost<{ status: string; count: number }>('/api/notifications/read-all');
