import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useControlCenterStore } from '../store/controlCenterStore';
import { decideBackgroundNotifications } from '../utils/backgroundNotifications';
import {
  displayManagedNotification,
  getNotificationPermissionStatus,
  requestPermission,
} from '../services/localNotifications';

interface BackgroundNotificationOptions {
  enabled: boolean;
  userId?: string;
}

/**
 * Delivers new unread server notifications while the authenticated Android app
 * is alive in the background. Server notification IDs are the canonical dedupe
 * source; native IDs collapse related terminal-state/device updates.
 */
export function useBackgroundNotifications({
  enabled,
  userId,
}: BackgroundNotificationOptions): void {
  const isBackgroundRef = useRef(false);
  const baselineNotificationIdsRef = useRef<Set<string>>(new Set());
  const alreadyNotifiedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  const permissionGrantedRef = useRef(false);
  const checkRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!enabled || !userId) {
      permissionGrantedRef.current = false;
      return;
    }
    let cancelled = false;
    void requestPermission().then(granted => {
      if (!cancelled) {
        permissionGrantedRef.current = granted;
        if (granted) checkRef.current();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, userId]);

  useEffect(() => {
    const snapshot = () => {
      baselineNotificationIdsRef.current = new Set(
        useControlCenterStore.getState().notifications.map(item => item.id),
      );
      alreadyNotifiedRef.current = new Set();
      inFlightRef.current = new Set();
    };

    if (!enabled || !userId) {
      isBackgroundRef.current = false;
      snapshot();
      return;
    }

    const check = () => {
      if (!isBackgroundRef.current || !permissionGrantedRef.current) return;
      const state = useControlCenterStore.getState();
      const excluded = new Set([
        ...alreadyNotifiedRef.current,
        ...inFlightRef.current,
      ]);
      const result = decideBackgroundNotifications({
        isBackground: true,
        notifications: state.notifications,
        baselineNotificationIds: baselineNotificationIdsRef.current,
        alreadyNotified: excluded,
        userId,
      });
      for (const notification of result.notifications) {
        inFlightRef.current.add(notification.key);
        void displayManagedNotification({
          id: notification.nativeId,
          title: notification.title,
          body: notification.body,
          createdAt: notification.createdAt,
          data: {
            type: notification.data.type,
            notificationId: notification.data.notificationId,
            sessionId: notification.data.sessionId ?? '',
            approvalId: notification.data.approvalId ?? '',
            deviceId: notification.data.deviceId ?? '',
            userId: notification.data.userId ?? '',
          },
        }).then(displayed => {
          inFlightRef.current.delete(notification.key);
          if (displayed) alreadyNotifiedRef.current.add(notification.key);
        });
      }
    };
    checkRef.current = check;

    const unsubscribeStore = useControlCenterStore.subscribe(check);
    const onChange = (next: AppStateStatus) => {
      const goingBackground = next !== 'active';
      if (goingBackground && !isBackgroundRef.current) {
        snapshot();
        isBackgroundRef.current = true;
        void getNotificationPermissionStatus().then(status => {
          permissionGrantedRef.current = status === 'authorized';
          if (status === 'authorized') checkRef.current();
        });
      } else if (!goingBackground && isBackgroundRef.current) {
        isBackgroundRef.current = false;
        snapshot();
      }
    };
    const appStateSubscription = AppState.addEventListener('change', onChange);
    isBackgroundRef.current = AppState.currentState !== 'active';
    snapshot();

    return () => {
      unsubscribeStore();
      appStateSubscription.remove();
      checkRef.current = () => undefined;
      isBackgroundRef.current = false;
      inFlightRef.current.clear();
    };
  }, [enabled, userId]);
}
