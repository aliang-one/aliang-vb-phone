import React, { createContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { AppTheme } from '../types';
import { cyberLogic } from './themes/cyberLogic';
import { utilityMinimalist } from './themes/utilityMinimalist';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeContextValue {
  theme: AppTheme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}

const THEME_KEY = '@theme_mode';

export const ThemeContext = createContext<ThemeContextValue>({
  theme: cyberLogic,
  mode: 'system',
  setMode: () => {},
  isDark: true,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then(stored => {
      if (stored === 'dark' || stored === 'light' || stored === 'system') {
        setModeState(stored);
      }
    });
  }, []);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    AsyncStorage.setItem(THEME_KEY, newMode);
  };

  const effectiveMode =
    mode === 'system' ? (systemScheme ?? 'dark') : mode;
  const isDark = effectiveMode === 'dark';
  const theme = isDark ? cyberLogic : utilityMinimalist;

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};
