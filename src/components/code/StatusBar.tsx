import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

type StatusBarState = 'thinking' | 'applying' | 'success' | 'paused';

interface StatusBarProps {
  status: StatusBarState;
  file?: string;
}

// VSCode Dark+ inspired colors
const statusConfig: Record<
  StatusBarState,
  { label: string; color: string; lightColor: string }
> = {
  thinking: { label: 'AI THINKING', color: '#569CD6', lightColor: '#0051AE' },  // VSCode keyword blue
  applying: { label: 'APPLYING', color: '#CE9178', lightColor: '#B8860B' },    // VSCode string orange
  success: { label: 'SUCCESS', color: '#6A9955', lightColor: '#0969DA' },      // VSCode comment green
  paused: { label: 'PAUSED', color: '#C586C0', lightColor: '#BA1A1A' },        // VSCode purple
};

export const StatusBar: React.FC<StatusBarProps> = ({ status, file }) => {
  const { theme, isDark } = useTheme();
  const config = statusConfig[status];
  const color = isDark ? config.color : config.lightColor;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? `${color}15`
            : `${config.lightColor}10`,
          borderRadius: theme.borderRadius.full,
        },
      ]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text
        style={[
          theme.typography.labelCaps,
          { color },
        ]}>
        {config.label}
      </Text>
      {file && (
        <Text
          style={[
            theme.typography.codeSm,
            { color: theme.colors.onSurfaceVariant },
            styles.file,
          ]}
          numberOfLines={1}>
          {file}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  file: {
    flex: 1,
    fontSize: 11,
  },
});
