import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface GlassPanelProps {
  children: React.ReactNode;
  style?: object;
  glowColor?: 'primary' | 'secondary' | 'error' | 'success' | 'warning' | 'none';
  bordered?: boolean;
}

export const GlassPanel: React.FC<GlassPanelProps> = ({
  children,
  style,
  glowColor = 'none',
  bordered = true,
}) => {
  const { theme, isDark } = useTheme();

  const glowStyles =
    glowColor !== 'none' && isDark ? theme.glow[glowColor] : {};

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? 'rgba(255, 255, 255, 0.04)'
            : theme.colors.surfaceContainerLow,
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
