import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import type { RootStackParamList } from '../../app/navigation/types';
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
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const handleBack = () => {
    if (navigation.canGoBack()) {
      onBack?.();
      return;
    }
    navigation.navigate('MainTabs');
  };

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
            <TouchableOpacity
              onPress={handleBack}
              activeOpacity={0.72}
              style={[
                styles.backBtn,
                {
                  borderColor: isDark
                    ? 'rgba(255,255,255,0.12)'
                    : theme.colors.outlineVariant,
                  backgroundColor: isDark
                    ? 'rgba(255,255,255,0.05)'
                    : theme.colors.surfaceContainerLow,
                  borderRadius: theme.borderRadius.full,
                },
              ]}>
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
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  subtitle: {
    marginTop: 2,
  },
});
