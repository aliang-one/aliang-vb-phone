export interface AppTheme {
  mode: 'dark' | 'light';
  colors: {
    background: string;
    surface: string;
    surfaceDim: string;
    surfaceBright: string;
    surfaceContainerLowest: string;
    surfaceContainerLow: string;
    surfaceContainer: string;
    surfaceContainerHigh: string;
    surfaceContainerHighest: string;
    onSurface: string;
    onSurfaceVariant: string;
    inverseSurface: string;
    inverseOnSurface: string;
    outline: string;
    outlineVariant: string;
    surfaceTint: string;
    primary: string;
    onPrimary: string;
    primaryContainer: string;
    onPrimaryContainer: string;
    inversePrimary: string;
    /** 主蓝的降饱和同族色(蓝灰)——完成态强调色,与 primary 保持色相家族统一。 */
    primaryMuted: string;
    secondary: string;
    onSecondary: string;
    secondaryContainer: string;
    onSecondaryContainer: string;
    tertiary: string;
    onTertiary: string;
    tertiaryContainer: string;
    onTertiaryContainer: string;
    error: string;
    onError: string;
    errorContainer: string;
    onErrorContainer: string;
    success: string;
    warning: string;
  };
  typography: {
    displayLg: TextStyle;
    headlineMd: TextStyle;
    titleLg: TextStyle;
    titleMd: TextStyle;
    bodyLg: TextStyle;
    bodyMd: TextStyle;
    bodySm: TextStyle;
    codeMd: TextStyle;
    codeSm: TextStyle;
    labelCaps: TextStyle;
    labelMd: TextStyle;
    labelSm: TextStyle;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    gutter: number;
    margin: number;
  };
  borderRadius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    full: number;
  };
  elevation: {
    level0: object;
    level1: object;
    level2: object;
  };
  glow: {
    primary: object;
    secondary: object;
    error: object;
    success: object;
    warning: object;
  };
}

import { TextStyle } from 'react-native';
