import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

type StatusType = 'success' | 'warning' | 'error' | 'neutral' | 'info';

interface StatusChipProps {
  label: string;
  type: StatusType;
  style?: object;
}

const statusColorMap: Record<StatusType, { bg: string; text: string }> = {
  success: { bg: 'rgba(47, 248, 1, 0.15)', text: '#2FF801' },
  warning: { bg: 'rgba(254, 177, 39, 0.15)', text: '#FEB127' },
  error: { bg: 'rgba(255, 180, 171, 0.15)', text: '#FF6B6B' },
  neutral: { bg: 'rgba(255, 255, 255, 0.08)', text: '#BBC9CF' },
  info: { bg: 'rgba(0, 209, 255, 0.15)', text: '#00D1FF' },
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
        { backgroundColor: colors.bg, borderRadius: theme.borderRadius.full },
        style,
      ]}>
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
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});
