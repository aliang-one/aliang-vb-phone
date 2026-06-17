import { AppTheme } from '../../types';

// VSCode Dark+ Theme inspired colors
export const cyberLogic: AppTheme = {
  mode: 'dark',
  colors: {
    // Background layers - VSCode classic dark
    background: '#1E1E1E',
    surface: '#252526',
    surfaceDim: '#1E1E1E',
    surfaceBright: '#2D2D2D',
    surfaceContainerLowest: '#1E1E1E',
    surfaceContainerLow: '#252526',
    surfaceContainer: '#2D2D2D',
    surfaceContainerHigh: '#333333',
    surfaceContainerHighest: '#3C3C3C',

    // Text colors
    onSurface: '#CCCCCC',
    onSurfaceVariant: '#9CDCFE',  // VSCode light blue for properties
    inverseSurface: '#D4D4D4',
    inverseOnSurface: '#1E1E1E',

    // Borders and outlines
    outline: '#6E6E6E',
    outlineVariant: '#454545',
    surfaceTint: '#569CD6',

    // Primary - VSCode blue for keywords/functions
    primary: '#569CD6',
    onPrimary: '#1E1E1E',
    primaryContainer: '#264F78',
    onPrimaryContainer: '#DCEBEB',
    inversePrimary: '#4FC1FF',

    // Secondary - VSCode teal for types
    secondary: '#4EC9B0',
    onSecondary: '#1E1E1E',
    secondaryContainer: '#2D5A56',
    onSecondaryContainer: '#B4D4C9',

    // Tertiary - VSCode purple for control keywords
    tertiary: '#C586C0',
    onTertiary: '#1E1E1E',
    tertiaryContainer: '#4D3557',
    onTertiaryContainer: '#D4A8C8',

    // Error/Warning
    error: '#F14C4C',
    onError: '#1E1E1E',
    errorContainer: '#5A1D1D',
    onErrorContainer: '#F48771',
  },
  typography: {
    displayLg: {
      fontFamily: 'Inter',
      fontSize: 28,
      fontWeight: '700' as const,
      lineHeight: 34,
      letterSpacing: -0.02 * 28,
    },
    headlineMd: {
      fontFamily: 'Inter',
      fontSize: 20,
      fontWeight: '600' as const,
      lineHeight: 26,
      letterSpacing: -0.01 * 20,
    },
    titleLg: {
      fontFamily: 'Inter',
      fontSize: 18,
      fontWeight: '600' as const,
      lineHeight: 24,
    },
    titleMd: {
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: '600' as const,
      lineHeight: 22,
    },
    bodyLg: {
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: '400' as const,
      lineHeight: 24,
    },
    bodyMd: {
      fontFamily: 'Inter',
      fontSize: 14,
      fontWeight: '400' as const,
      lineHeight: 20,
    },
    bodySm: {
      fontFamily: 'Inter',
      fontSize: 12,
      fontWeight: '400' as const,
      lineHeight: 18,
    },
    codeMd: {
      fontFamily: 'JetBrains Mono',
      fontSize: 14,
      fontWeight: '400' as const,
      lineHeight: 20,
    },
    codeSm: {
      fontFamily: 'JetBrains Mono',
      fontSize: 13,
      fontWeight: '400' as const,
      lineHeight: 18,
    },
    labelCaps: {
      fontFamily: 'Space Grotesk',
      fontSize: 11,
      fontWeight: '600' as const,
      lineHeight: 14,
      letterSpacing: 0.55,
    },
    labelMd: {
      fontFamily: 'Inter',
      fontSize: 14,
      fontWeight: '500' as const,
      lineHeight: 20,
    },
    labelSm: {
      fontFamily: 'Inter',
      fontSize: 12,
      fontWeight: '500' as const,
      lineHeight: 16,
    },
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    gutter: 12,
    margin: 16,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
  },
  elevation: {
    level0: {
      backgroundColor: '#1E1E1E',
    },
    level1: {
      backgroundColor: '#252526',
      borderWidth: 1,
      borderColor: '#3C3C3C',
    },
    level2: {
      backgroundColor: '#2D2D2D',
      borderWidth: 1,
      borderColor: '#454545',
    },
  },
  glow: {
    primary: {
      shadowColor: '#569CD6',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
    },
    secondary: {
      shadowColor: '#4EC9B0',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
    },
    error: {
      shadowColor: '#F14C4C',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },
  },
};