import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface LoadMoreRowProps {
  visibleCount: number;
  totalCount: number;
  onPress: () => void;
  label?: string;
  serverHasMore?: boolean;
  loading?: boolean;
  error?: string;
}

export const LoadMoreRow: React.FC<LoadMoreRowProps> = ({
  visibleCount,
  totalCount,
  onPress,
  label = 'LOAD MORE',
  serverHasMore = false,
  loading = false,
  error,
}) => {
  const { theme, isDark } = useTheme();

  if (visibleCount >= totalCount && !serverHasMore && !error) {
    return null;
  }

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      disabled={loading}
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
      ]}
    >
      <View style={styles.copy}>
        <Text
          style={[theme.typography.labelCaps, { color: theme.colors.primary }]}
        >
          {loading ? 'LOADING...' : error ? 'RETRY' : label}
        </Text>
        <Text
          style={[
            theme.typography.labelSm,
            { color: theme.colors.onSurfaceVariant },
          ]}
        >
          {visibleCount} / {totalCount}
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={theme.colors.primary} />
      ) : (
        <Text
          style={[theme.typography.codeMd, { color: theme.colors.primary }]}
        >
        +
      </Text>
      )}
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
