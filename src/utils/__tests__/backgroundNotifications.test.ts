import {
  decideBackgroundNotifications,
  nativeNotificationId,
} from '../backgroundNotifications';
import type { PushNotificationItem } from '../../store/types';

// Fixed delivery clock injected via `now` so every test is deterministic
// against the 30-minute expiry window.
const NOW = 1_758_000_000_000;

const notification = (
  overrides: Partial<PushNotificationItem> & { id: string },
): PushNotificationItem => ({
  type: 'approval',
  title: 'Title',
  body: 'Body',
  read: false,
  createdAt: new Date(NOW - 60_000).toISOString(),
  ...overrides,
});

const baseInput = {
  isBackground: true,
  notifications: [] as PushNotificationItem[],
  baselineNotificationIds: new Set<string>(),
  alreadyNotified: new Set<string>(),
  userId: 'user-1',
  now: NOW,
};

describe('decideBackgroundNotifications', () => {
  it('suppresses all native delivery while foregrounded', () => {
    const result = decideBackgroundNotifications({
      ...baseInput,
      isBackground: false,
      notifications: [notification({ id: 'n1' })],
    });
    expect(result.notifications).toEqual([]);
  });

  it('delivers a new unread server notification with canonical identity', () => {
    const result = decideBackgroundNotifications({
      ...baseInput,
      notifications: [
        notification({
          id: 'n1',
          approvalId: 'approval-1',
          sessionId: 'session-1',
        }),
      ],
    });
    expect(result.notifications).toEqual([
      expect.objectContaining({
        key: 'notification:n1',
        nativeId: 'vibe_approval_approval-1',
        data: {
          type: 'approval',
          notificationId: 'n1',
          sessionId: 'session-1',
          approvalId: 'approval-1',
          deviceId: undefined,
          userId: 'user-1',
        },
      }),
    ]);
  });

  it('does not redeliver baseline, read, or already delivered records', () => {
    const result = decideBackgroundNotifications({
      ...baseInput,
      notifications: [
        notification({ id: 'baseline' }),
        notification({ id: 'read', read: true }),
        notification({ id: 'delivered' }),
        notification({ id: 'new' }),
      ],
      baselineNotificationIds: new Set(['baseline']),
      alreadyNotified: new Set(['notification:delivered']),
    });
    expect(result.notifications.map(item => item.key)).toEqual([
      'notification:new',
    ]);
  });

  it('orders a burst oldest first so the final tray state is authoritative', () => {
    const result = decideBackgroundNotifications({
      ...baseInput,
      notifications: [
        notification({ id: 'later', createdAt: '2026-07-15T00:00:02.000Z' }),
        notification({ id: 'earlier', createdAt: '2026-07-15T00:00:01.000Z' }),
      ],
    });
    expect(result.notifications.map(item => item.key)).toEqual([
      'notification:earlier',
      'notification:later',
    ]);
  });

  it('uses one stable native ID for contradictory session terminal updates', () => {
    const failed = notification({
      id: 'failed',
      type: 'error',
      sessionId: 'session/1',
    });
    const completed = notification({
      id: 'completed',
      type: 'completed',
      sessionId: 'session/1',
    });
    expect(nativeNotificationId(failed)).toBe(
      'vibe_session_session_1_terminal',
    );
    expect(nativeNotificationId(completed)).toBe(
      'vibe_session_session_1_terminal',
    );
  });

  it('maps completion, error, and device records to navigation data', () => {
    const result = decideBackgroundNotifications({
      ...baseInput,
      notifications: [
        notification({ id: 'done', type: 'completed', sessionId: 's1' }),
        notification({ id: 'error', type: 'error', sessionId: 's2' }),
        notification({
          id: 'offline',
          type: 'device_offline',
          deviceId: 'd1',
        }),
      ],
    });
    expect(result.notifications.map(item => item.data.type)).toEqual([
      'session_done',
      'session_failed',
      'device_offline',
    ]);
    expect(result.notifications[2].nativeId).toBe('vibe_device_d1_offline');
  });

  // 时效过滤（用户定版 30min）：历史未读只进 App 内通知中心，不发系统通知。
  // 否则登录/重连时的积压会整批炸成系统通知（baseline 快照拦不住 bulk 回填）。
  describe('expiry window', () => {
    it('delivers a fresh unread notification (within the window)', () => {
      const result = decideBackgroundNotifications({
        ...baseInput,
        now: NOW,
        notifications: [
          notification({ id: 'n1', createdAt: new Date(NOW - 60_000).toISOString() }),
        ],
      });
      expect(result.notifications).toHaveLength(1);
    });

    it('never delivers history older than the window, still delivers fresh ones', () => {
      const result = decideBackgroundNotifications({
        ...baseInput,
        now: NOW,
        notifications: [
          notification({ id: 'old', createdAt: new Date(NOW - 31 * 60_000).toISOString() }),
          notification({ id: 'fresh', createdAt: new Date(NOW - 30_000).toISOString() }),
        ],
      });
      expect(result.notifications.map(item => item.key)).toEqual([
        'notification:fresh',
      ]);
    });

    it('treats exactly-window-old as fresh (> window is the skip rule)', () => {
      const result = decideBackgroundNotifications({
        ...baseInput,
        now: NOW,
        notifications: [
          notification({ id: 'edge', createdAt: new Date(NOW - 30 * 60_000).toISOString() }),
        ],
      });
      expect(result.notifications).toHaveLength(1);
    });

    it('treats missing/unparseable createdAt as expired (fail silent)', () => {
      const result = decideBackgroundNotifications({
        ...baseInput,
        now: NOW,
        notifications: [notification({ id: 'n1', createdAt: 'not-a-date' })],
      });
      expect(result.notifications).toEqual([]);
    });
  });
});
