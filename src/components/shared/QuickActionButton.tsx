import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { IconBadge, IconName } from '../visual/IconBadge';

interface QuickActionButtonProps {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  style?: object;
}

export const QuickActionButton: React.FC<QuickActionButtonProps> = ({
  icon,
  title,
  subtitle,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}) => {
  const { theme, isDark } = useTheme();

  const getBackgroundColor = () => {
    if (disabled) {
      return isDark
        ? 'rgba(255,255,255,0.06)'
        : theme.colors.surfaceContainerHigh;
    }
    if (variant === 'primary') {
      return theme.colors.primary;
    }
    return isDark
      ? 'rgba(255,255,255,0.08)'
      : theme.colors.surfaceContainer;
  };

  const iconTone = disabled
    ? 'neutral'
    : variant === 'primary'
    ? 'primary'
    : 'primary';

  const iconFilled = variant === 'primary' && !disabled;

  const textColor = disabled
    ? theme.colors.onSurfaceVariant
    : variant === 'primary'
    ? theme.colors.onPrimary
    : theme.colors.onSurface;

  const subtextColor = disabled
    ? theme.colors.onSurfaceVariant
    : variant === 'primary'
    ? theme.colors.onPrimary
    : theme.colors.onSurfaceVariant;

  const glowStyle = variant === 'primary' && !disabled && isDark
    ? theme.glow.primary
    : {};

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {
          backgroundColor: getBackgroundColor(),
          borderRadius: theme.borderRadius.lg,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: isDark
            ? 'rgba(255,255,255,0.12)'
            : theme.colors.outlineVariant,
        },
        glowStyle,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}>
      <IconBadge
        name={icon}
        tone={iconTone}
        size={34}
        iconSize={17}
        filled={iconFilled}
      />
      <View style={styles.textContainer}>
        <Text
          style={[
            theme.typography.labelMd,
            { color: textColor },
            styles.title,
          ]}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[
              theme.typography.labelSm,
              { color: subtextColor },
            ]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  textContainer: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
