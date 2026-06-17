import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

type StatusType = 'success' | 'warning' | 'error' | 'neutral' | 'info';

interface StatusChipProps {
  label: string;
  type: StatusType;
  style?: object;
}

// VSCode Dark+ inspired status colors
const statusColorMap: Record<StatusType, { bg: string; text: string }> = {
  success: { bg: 'rgba(106, 153, 85, 0.18)', text: '#6A9955' },   // VSCode comment green
  warning: { bg: 'rgba(206, 145, 120, 0.18)', text: '#CE9178' },   // VSCode string orange
  error: { bg: 'rgba(244, 135, 113, 0.18)', text: '#F48771' },     // VSCode error red
  neutral: { bg: 'rgba(204, 204, 204, 0.08)', text: '#9D9D9D' },   // muted gray
  info: { bg: 'rgba(86, 156, 214, 0.18)', text: '#569CD6' },       // VSCode keyword blue
};

export const StatusChip: React.FC<StatusChipProps> = ({ label, type, style }) => {
  const { theme, isDark } = useTheme();
  const colors = isDark
    ? statusColorMap[type]
    : {
        bg:
          type === 'success'
            ? 'rgba(9, 105, 218, 0.1)'
            : type === 'warning'
            ? 'rgba(254, 177, 39, 0.15)'
            : type === 'error'
            ? 'rgba(186, 26, 26, 0.1)'
            : type === 'info'
            ? 'rgba(0, 81, 174, 0.1)'
            : 'rgba(0, 0, 0, 0.05)',
        text:
          type === 'success'
            ? '#0969DA'
            : type === 'warning'
            ? '#B8860B'
            : type === 'error'
            ? '#BA1A1A'
            : type === 'info'
            ? '#0051AE'
            : '#424753',
      };

  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: colors.bg,
          borderRadius: theme.borderRadius.full,
          borderColor: colors.text,
        },
        style,
      ]}>
      <View style={[styles.dot, { backgroundColor: colors.text }]} />
      <Text
        style={[
          theme.typography.codeSm,
          { color: colors.text },
          styles.label,
        ]}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});
