import React from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/theme/ThemeContext';
import { useTheme } from './src/theme/useTheme';
import { RootNavigator } from './src/app/navigation/RootNavigator';
import { usePresenceHeartbeat } from './src/hooks/usePresenceHeartbeat';
import type { AppInitialProps } from './src/app/debugInitialProps';

function AppContent({ debugDeviceTerminal }: AppInitialProps = {}) {
  const { theme, isDark } = useTheme();
  // App-level presence: keeps the user's terminals alive while the app is in the
  // foreground (the server's idle reaper closes them after N min of no activity).
  usePresenceHeartbeat();

  return (
    <>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      <NavigationContainer
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
          <AppContent debugDeviceTerminal={props.debugDeviceTerminal} />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
