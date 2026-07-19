import { processNotificationTap } from '../notificationNavigation';

const tap = {
  type: 'session_done',
  sessionId: 'session-1',
  notificationId: 'notification-1',
  userId: 'user-1',
};

describe('processNotificationTap', () => {
  it('waits for hydration/navigation, then navigates and marks read', async () => {
    let now = 0;
    let iterations = 0;
    const navigate = jest.fn();
    const markRead = jest.fn(async () => undefined);
    const result = await processNotificationTap(
      tap,
      {
        getSession: () => ({
          hasHydrated: iterations >= 1,
          token: iterations >= 1 ? 'token' : null,
          userId: iterations >= 1 ? 'user-1' : undefined,
        }),
        isNavigationReady: () => iterations >= 2,
        navigate,
        markRead,
        now: () => now,
        delay: async milliseconds => {
          iterations += 1;
          now += milliseconds;
        },
      },
      { timeoutMs: 1_000, pollMs: 100 },
    );
    expect(result).toBe('navigated');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith('notification-1');
  });

  it('does not open a notification belonging to another account', async () => {
    const navigate = jest.fn();
    const result = await processNotificationTap(tap, {
      getSession: () => ({
        hasHydrated: true,
        token: 'token',
        userId: 'user-2',
      }),
      isNavigationReady: () => true,
      navigate,
      markRead: jest.fn(),
    });
    expect(result).toBe('account_mismatch');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('stops immediately after hydration when signed out', async () => {
    const result = await processNotificationTap(tap, {
      getSession: () => ({ hasHydrated: true, token: null }),
      isNavigationReady: () => true,
      navigate: jest.fn(),
      markRead: jest.fn(),
    });
    expect(result).toBe('unauthenticated');
  });

  it('has a hard deadline when navigation never becomes ready', async () => {
    let now = 0;
    const result = await processNotificationTap(
      tap,
      {
        getSession: () => ({
          hasHydrated: true,
          token: 'token',
          userId: 'user-1',
        }),
        isNavigationReady: () => false,
        navigate: jest.fn(),
        markRead: jest.fn(),
        now: () => now,
        delay: async milliseconds => {
          now += milliseconds;
        },
      },
      { timeoutMs: 250, pollMs: 100 },
    );
    expect(result).toBe('timeout');
    expect(now).toBe(300);
  });
});
