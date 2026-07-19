import {
  resolveNotificationTapTarget,
  type NotificationTapData,
  type NotificationTapTarget,
} from './notificationTap';

export type NotificationTapResult =
  | 'navigated'
  | 'invalid'
  | 'unauthenticated'
  | 'account_mismatch'
  | 'timeout'
  | 'cancelled';

export interface NotificationSessionSnapshot {
  hasHydrated: boolean;
  token: string | null;
  userId?: string;
}

interface NotificationNavigationDependencies {
  getSession: () => NotificationSessionSnapshot;
  isNavigationReady: () => boolean;
  navigate: (target: NotificationTapTarget) => void;
  markRead: (notificationId: string) => void | Promise<void>;
  isCancelled?: () => boolean;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

interface NotificationNavigationOptions {
  timeoutMs?: number;
  pollMs?: number;
}

const defaultDelay = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));

/**
 * Waits for persisted auth and React Navigation with a hard deadline. This is
 * shared by warm and cold notification taps so neither path drops a valid tap
 * nor creates an immortal polling loop.
 */
export async function processNotificationTap(
  data: NotificationTapData | null | undefined,
  dependencies: NotificationNavigationDependencies,
  options: NotificationNavigationOptions = {},
): Promise<NotificationTapResult> {
  const target = resolveNotificationTapTarget(data);
  if (!target) return 'invalid';

  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollMs = options.pollMs ?? 100;
  const now = dependencies.now ?? Date.now;
  const delay = dependencies.delay ?? defaultDelay;
  const deadline = now() + timeoutMs;

  while (now() <= deadline) {
    if (dependencies.isCancelled?.()) return 'cancelled';
    const session = dependencies.getSession();
    if (session.hasHydrated) {
      if (!session.token) return 'unauthenticated';
      if (data?.userId && session.userId && data.userId !== session.userId) {
        return 'account_mismatch';
      }
      const waitingForExpectedUser = Boolean(data?.userId && !session.userId);
      if (!waitingForExpectedUser && dependencies.isNavigationReady()) {
        dependencies.navigate(target);
        if (data?.notificationId) {
          await dependencies.markRead(data.notificationId);
        }
        return 'navigated';
      }
    }
    await delay(pollMs);
  }
  return 'timeout';
}

export function notificationTapIdentity(
  data: NotificationTapData | null | undefined,
): string | undefined {
  return data?.notificationId || data?.nativeId;
}
