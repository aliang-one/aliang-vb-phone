import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface ProgressBarProps {
  progress: number;
  color?: string;
  height?: number;
  style?: object;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  color,
  height = 4,
  style,
}) => {
  const { theme, isDark } = useTheme();
  const barColor = color || theme.colors.primary;
  const clampedProgress = Math.max(0, Math.min(100, progress));

  return (
    <View
      style={[
        styles.track,
        {
          height,
          backgroundColor: isDark
            ? 'rgba(255, 255, 255, 0.08)'
            : theme.colors.surfaceContainerHigh,
          borderRadius: height / 2,
        },
        style,
      ]}>
      <View
        style={[
          styles.fill,
          {
            width: `${clampedProgress}%`,
            backgroundColor: barColor,
            borderRadius: height / 2,
            ...(isDark
              ? {
                  shadowColor: barColor,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.6,
                  shadowRadius: 4,
                }
              : {}),
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});
