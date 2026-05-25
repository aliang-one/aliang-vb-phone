import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface TopAppBarProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({
  title,
  subtitle,
  onBack,
  rightAction,
}) => {
  const { theme, isDark } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? 'rgba(11, 14, 17, 0.9)'
            : 'rgba(247, 249, 255, 0.9)',
          borderBottomColor: isDark
            ? 'rgba(255, 255, 255, 0.06)'
            : theme.colors.outlineVariant,
        },
      ]}>
      <View style={styles.content}>
        <View style={styles.left}>
          {onBack && (
            <TouchableOpacity onPress={onBack} style={styles.backBtn}>
              <Text
                style={[
                  theme.typography.codeMd,
                  { color: theme.colors.primary },
                ]}>
                {'<'}
              </Text>
            </TouchableOpacity>
          )}
          <View>
            <Text
              style={[
                theme.typography.headlineMd,
                { color: theme.colors.onSurface },
              ]}>
              {title}
            </Text>
            {subtitle && (
              <Text
                style={[
                  theme.typography.labelCaps,
                  { color: theme.colors.onSurfaceVariant },
                  styles.subtitle,
                ]}>
                {subtitle}
              </Text>
            )}
          </View>
        </View>
        {rightAction && <View>{rightAction}</View>}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backBtn: {
    padding: 4,
  },
  subtitle: {
    marginTop: 2,
  },
});
