import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface GlassPanelProps {
  children: React.ReactNode;
  style?: object;
  glowColor?: 'primary' | 'secondary' | 'error' | 'success' | 'warning' | 'none';
  bordered?: boolean;
  /**
   * Render with a SOLID surface fill instead of the near-transparent glass fill.
   * Use for panels shown inside a Modal/overlay: the glass fill (dark:
   * rgba(255,255,255,0.04)) is meant to float on a solid in-app surface, so
   * inside a Modal whose backdrop is only a semi-transparent dim, it lets the
   * dimmed content behind bleed through and the dialog reads as transparent.
   */
  opaque?: boolean;
}

// Surface tokens the fill depends on. Structurally typed so the helper stays
// decoupled from the full theme shape (and is trivially unit-testable).
export type GlassPanelColors = {
  surfaceContainerHigh: string;
  surfaceContainerLow: string;
};

/**
 * Pick the GlassPanel background. `opaque` returns a solid surface token for
 * Modal/overlay use; otherwise the glass fill (dark) / low surface (light) for
 * ordinary in-screen cards. Extracted as a pure function so the decision is
 * unit-testable without rendering.
 */
export function glassPanelBackground(opts: {
  isDark: boolean;
  opaque: boolean;
  colors: GlassPanelColors;
}): string {
  const { isDark, opaque, colors } = opts;
  if (opaque) {
    return colors.surfaceContainerHigh;
  }
  return isDark ? 'rgba(255, 255, 255, 0.04)' : colors.surfaceContainerLow;
}

export const GlassPanel: React.FC<GlassPanelProps> = ({
  children,
  style,
  glowColor = 'none',
  bordered = true,
  opaque = false,
}) => {
  const { theme, isDark } = useTheme();

  const glowStyles =
    glowColor !== 'none' && isDark ? theme.glow[glowColor] : {};

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: glassPanelBackground({
            isDark,
            opaque,
            colors: theme.colors,
          }),
          borderColor: bordered
            ? isDark
              ? 'rgba(255, 255, 255, 0.08)'
              : theme.colors.outlineVariant
            : 'transparent',
          borderRadius: theme.borderRadius.md,
        },
        glowStyles,
        style,
      ]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    overflow: 'hidden',
  },
});
