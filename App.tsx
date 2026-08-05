import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/theme/ThemeContext';
import { useTheme } from './src/theme/useTheme';
import './src/i18n';
import { LocaleProvider } from './src/i18n/useLocale';
import { RootNavigator } from './src/app/navigation/RootNavigator';
import { navigationRef } from './src/app/navigation/navigationRef';
import { ToastViewport } from './src/components/shared/ToastViewport';
import { usePresenceHeartbeat } from './src/hooks/usePresenceHeartbeat';
import { useBackgroundNotifications } from './src/hooks/useBackgroundNotifications';
import {
  cancelNotification,
  getInitialNotificationData,
  onNotificationAction,
  onNotificationPress,
} from './src/services/localNotifications';
import {
  type NotificationTapData,
  resolveApprovalAction,
} from './src/utils/notificationTap';
import {
  notificationTapIdentity,
  processNotificationTap,
} from './src/utils/notificationNavigation';
import { useSessionStore } from './stores/useSettingsStore';
import { useControlCenterStore } from './src/store/controlCenterStore';
import type { AppInitialProps } from './src/app/debugInitialProps';

function AppContent({ debugDeviceTerminal }: AppInitialProps = {}) {
  const { theme, isDark } = useTheme();
  // App-level presence: keeps the user's terminals alive while the app is in the
  // foreground (the server's idle reaper closes them after N min of no activity).
  usePresenceHeartbeat();
  // Android 后台本地通知:后台收到 approval / 回合结算 → 弹系统通知;点击跳会话。
  // iOS / 未 rebuild → 降级 no-op(见 services/localNotifications)。
  const hasHydrated = useSessionStore(state => state.hasHydrated);
  const token = useSessionStore(state => state.token);
  const userId = useSessionStore(state => state.user?.id);
  useBackgroundNotifications({
    enabled: hasHydrated && Boolean(token && userId),
    userId,
  });

  // 通知点击 → 跳对应会话。两条路径:onForegroundEvent(后台点开拉起)+
  // getInitialNotification(冷启动被通知拉起)。后者需等 hydrate+登录+navigator 就绪。
  useEffect(() => {
    let cancelled = false;
    const handled = new Set<string>();
    const handleTap = (raw: Record<string, unknown> | undefined) => {
      const data = raw as NotificationTapData | undefined;
      const identity = notificationTapIdentity(data);
      if (identity && handled.has(identity)) return;
      if (identity) {
        handled.add(identity);
        if (handled.size > 50) handled.delete(handled.values().next().value!);
      }
      void processNotificationTap(data, {
        getSession: () => {
          const session = useSessionStore.getState();
          return {
            hasHydrated: session.hasHydrated,
            token: session.token,
            userId: session.user?.id,
          };
        },
        isNavigationReady: () => navigationRef.isReady(),
        navigate: target => {
          if (target.route === 'VibeCodingSession') {
            navigationRef.navigate('VibeCodingSession', target.params);
          } else if (target.route === 'DeviceDetail') {
            navigationRef.navigate('DeviceDetail', target.params);
          } else {
            navigationRef.navigate('NotificationCenter');
          }
        },
        markRead: async notificationId => {
          useControlCenterStore.setState(state => ({
            notifications: state.notifications.map(item =>
              item.id === notificationId ? { ...item, read: true } : item,
            ),
          }));
          const deadline = Date.now() + 10_000;
          while (!cancelled && Date.now() <= deadline) {
            const controlCenter = useControlCenterStore.getState();
            if (controlCenter.serverMode) {
              await controlCenter.markNotificationRead(notificationId).catch(
                error => {
                  console.warn('[notifications] failed to sync read state', error);
                },
              );
              return;
            }
            await new Promise<void>(resolve => setTimeout(resolve, 200));
          }
        },
        isCancelled: () => cancelled,
      }).then(result => {
        if (
          identity &&
          (result === 'timeout' || result === 'cancelled' || result === 'invalid')
        ) {
          handled.delete(identity);
        }
      });
    };
    const unsub = onNotificationPress(handleTap);
    // Approval action buttons (批准/拒绝) on the notification itself: resolve
    // server-side via the same store action the in-app card uses, then dismiss
    // the notification. Falls back to body-tap → session for multi-option cases.
    const handleAction = (
      raw: Record<string, unknown> | undefined,
      actionId: string,
    ) => {
      const decision = resolveApprovalAction(
        raw as NotificationTapData | undefined,
        actionId,
      );
      if (!decision) return;
      void useControlCenterStore
        .getState()
        .resolveApproval(
          decision.approvalId,
          decision.kind === 'approve' ? 'approved' : 'denied',
        )
        .then(() => {
          const nativeId = raw?.nativeId;
          if (typeof nativeId === 'string' && nativeId) {
            void cancelNotification(nativeId);
          }
        })
        .catch((error: unknown) => {
          console.warn('[notifications] approval action failed', error);
        });
    };
    const unsubActions = onNotificationAction(handleAction);
    void getInitialNotificationData().then(data => {
      if (!cancelled) {
        handleTap(data);
      }
    });
    return () => {
      cancelled = true;
      unsub();
      unsubActions();
    };
  }, []);

  return (
    <>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      <NavigationContainer
        ref={navigationRef}
        theme={{
          dark: isDark,
          colors: {
            primary: theme.colors.primary,
            background: theme.colors.background,
            card: theme.colors.surface,
            text: theme.colors.onSurface,
            border: theme.colors.outlineVariant,
            notification: theme.colors.error,
          },
          fonts: {
            regular: { fontFamily: 'Inter', fontWeight: '400' },
            medium: { fontFamily: 'Inter', fontWeight: '500' },
            bold: { fontFamily: 'Inter', fontWeight: '700' },
            heavy: { fontFamily: 'Inter', fontWeight: '900' },
          },
        }}>
        <RootNavigator debugDeviceTerminal={debugDeviceTerminal} />
      </NavigationContainer>
      <ToastViewport />
    </>
  );
}

function App(props: AppInitialProps = {}) {
  // GestureHandlerRootView must wrap the navigation tree: React Navigation 7's
  // stack gestures and react-native-reanimated 4 pan gestures both expect a
  // gesture root. Without it they fall back to the legacy responder system,
  // which adds overhead and drops frames during screen transitions.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <LocaleProvider>
            <AppContent debugDeviceTerminal={props.debugDeviceTerminal} />
          </LocaleProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
