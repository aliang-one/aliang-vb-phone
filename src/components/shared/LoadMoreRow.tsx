import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface LoadMoreRowProps {
  visibleCount: number;
  totalCount: number;
  onPress: () => void;
  label?: string;
}

export const LoadMoreRow: React.FC<LoadMoreRowProps> = ({
  visibleCount,
  totalCount,
  onPress,
  label = 'LOAD MORE',
}) => {
  const { theme, isDark } = useTheme();

  if (visibleCount >= totalCount) {
    return null;
  }

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={[
        styles.row,
        {
          borderRadius: theme.borderRadius.md,
          borderColor: theme.colors.outlineVariant,
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.03)'
            : theme.colors.surfaceContainerLow,
        },
      ]}>
      <View style={styles.copy}>
        <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
          {label}
        </Text>
        <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
          {visibleCount} / {totalCount}
        </Text>
      </View>
      <Text style={[theme.typography.codeMd, { color: theme.colors.primary }]}>
        +
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copy: {
    gap: 2,
  },
});
