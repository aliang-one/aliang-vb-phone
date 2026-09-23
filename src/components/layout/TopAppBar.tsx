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
    // MainTabs 参数类型为 NavigatorScreenParams({screen,params} 或 {state}
    // 的联合,空对象不合法);不指定嵌套 screen 时传 { state: undefined },
    // 保持「回到当前 tab」的原行为。
    navigation.navigate('MainTabs', { state: undefined });
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
          <View style={styles.titleBlock}>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                theme.typography.headlineMd,
                { color: theme.colors.onSurface },
              ]}>
              {title}
            </Text>
            {subtitle && (
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
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
        {rightAction && <View style={styles.rightAction}>{rightAction}</View>}
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
  // RN flex 默认 flexShrink:0,不限宽时过长的设备名/标题会顶挤右侧状态区。
  // 左侧整体占剩余宽度并允许收缩,标题/副标题单行省略;右侧保持固有宽度不压缩。
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleBlock: {
    flexShrink: 1,
  },
  rightAction: {
    flexShrink: 0,
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
