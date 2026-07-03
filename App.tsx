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
import { usePresenceHeartbeat } from './src/hooks/usePresenceHeartbeat';
import { useBackgroundNotifications } from './src/hooks/useBackgroundNotifications';
import {
  onNotificationPress,
  getInitialNotificationData,
} from './src/services/localNotifications';
import {
  resolveNotificationTapTarget,
  type NotificationTapData,
} from './src/utils/notificationTap';
import { useSessionStore } from './stores/useSettingsStore';
import type { AppInitialProps } from './src/app/debugInitialProps';

function AppContent({ debugDeviceTerminal }: AppInitialProps = {}) {
  const { theme, isDark } = useTheme();
  // App-level presence: keeps the user's terminals alive while the app is in the
  // foreground (the server's idle reaper closes them after N min of no activity).
  usePresenceHeartbeat();
  // Android 后台本地通知:后台收到 approval / 回合结算 → 弹系统通知;点击跳会话。
  // iOS / 未 rebuild → 降级 no-op(见 services/localNotifications)。
  useBackgroundNotifications();

  // 通知点击 → 跳对应会话。两条路径:onForegroundEvent(后台点开拉起)+
  // getInitialNotification(冷启动被通知拉起)。后者需等 hydrate+登录+navigator 就绪。
  useEffect(() => {
    const unsub = onNotificationPress(data => {
      const target = resolveNotificationTapTarget(
        data as unknown as NotificationTapData | undefined,
      );
      if (target && navigationRef.isReady()) {
        navigationRef.navigate(target.route, target.params);
      }
    });
    let cancelled = false;
    void getInitialNotificationData().then(data => {
      const target = resolveNotificationTapTarget(
        data as unknown as NotificationTapData | undefined,
      );
      if (!target) return;
      const tryNav = () => {
        if (cancelled) return;
        const { hasHydrated, token } = useSessionStore.getState();
        if (hasHydrated && token && navigationRef.isReady()) {
          navigationRef.navigate(target.route, target.params);
        } else {
          setTimeout(tryNav, 200);
        }
      };
      tryNav();
    });
    return () => {
      cancelled = true;
      unsub();
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
