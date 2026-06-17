import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/theme/ThemeContext';
import { useTheme } from './src/theme/useTheme';
import { RootNavigator } from './src/app/navigation/RootNavigator';
import type { AppInitialProps } from './src/app/debugInitialProps';

function AppContent({ debugDeviceTerminal }: AppInitialProps = {}) {
  const { theme, isDark } = useTheme();

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
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppContent debugDeviceTerminal={props.debugDeviceTerminal} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default App;
