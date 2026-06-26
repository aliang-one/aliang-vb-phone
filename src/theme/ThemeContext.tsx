import React, { createContext, useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { AppTheme } from '../types';
import { darkTheme } from './themes/darkTheme';
import { utilityMinimalist } from './themes/utilityMinimalist';
import { resolveSystemMode } from './systemTheme';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeContextValue {
  theme: AppTheme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}

const THEME_KEY = '@theme_mode';

// "system" mode follows the device's local wall-clock (day → light, else dark),
// NOT the OS appearance setting. While the app sits in the foreground we
// re-resolve on this cadence so an open app flips at the 07:00 / 19:00 boundary
// without needing a relaunch.
const SYSTEM_REEVAL_INTERVAL_MS = 60_000;

export const ThemeContext = createContext<ThemeContextValue>({
  theme: darkTheme,
  mode: 'system',
  setMode: () => {},
  isDark: true,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [mode, setModeState] = useState<ThemeMode>('system');
  // Bumped periodically / on foreground so a time-based "system" mode
  // re-resolves as the wall clock crosses the day/night boundary. Explicit
  // 'dark' / 'light' choices are static and never depend on this tick.
  const [, setReevalTick] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then(stored => {
      if (stored === 'dark' || stored === 'light' || stored === 'system') {
        setModeState(stored);
      }
    });
  }, []);

  // Only "system" depends on the wall clock; arm a lightweight re-evaluation
  // (a slow periodic tick + an immediate bump on return-to-foreground) for
  // that mode alone. Torn down when the user picks an explicit theme.
  useEffect(() => {
    if (mode !== 'system') {
      return;
    }
    const interval = setInterval(() => {
      setReevalTick(t => t + 1);
    }, SYSTEM_REEVAL_INTERVAL_MS);
    const subscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state === 'active') {
          setReevalTick(t => t + 1);
        }
      },
    );
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [mode]);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    AsyncStorage.setItem(THEME_KEY, newMode);
  };

  const effectiveMode = mode === 'system' ? resolveSystemMode() : mode;
  const isDark = effectiveMode === 'dark';
  const theme = isDark ? darkTheme : utilityMinimalist;

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};
