import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { IconBadge, IconName } from '../visual/IconBadge';

interface ActionGridCardProps {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
  accent?: boolean;
  test?: 'primary' | 'secondary' | 'tertiary';
}

export const ActionGridCard: React.FC<ActionGridCardProps> = ({
  icon,
  title,
  subtitle,
  onPress,
  disabled = false,
  accent = false,
}) => {
  const { theme, isDark } = useTheme();

  const bg = disabled
    ? isDark
      ? 'rgba(255,255,255,0.03)'
      : theme.colors.surfaceContainerHigh
    : isDark
    ? 'rgba(255,255,255,0.06)'
    : theme.colors.surfaceContainer;

  const borderCol = accent
    ? theme.colors.primary
    : isDark
    ? 'rgba(255,255,255,0.08)'
    : theme.colors.outlineVariant;

  const titleCol = disabled
    ? theme.colors.onSurfaceVariant
    : theme.colors.onSurface;

  const subCol = disabled
    ? theme.colors.onSurfaceVariant
    : theme.colors.onSurfaceVariant;

  const iconTone = disabled ? 'neutral' : accent ? 'primary' : 'primary';
  const iconFilled = accent && !disabled;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: bg,
          borderColor: borderCol,
          borderRadius: theme.borderRadius.lg,
        },
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}>
      <IconBadge
        name={icon}
        tone={iconTone}
        size={30}
        iconSize={15}
        filled={iconFilled}
      />
      <View style={styles.textBlock}>
        <Text
          numberOfLines={1}
          style={[theme.typography.labelMd, { color: titleCol }, styles.title]}>
          {title}
        </Text>
        <Text
          numberOfLines={1}
          style={[theme.typography.labelSm, { color: subCol }, styles.sub]}>
          {subtitle}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1,
    gap: 6,
    minWidth: 0,
  },
  disabled: {
    opacity: 0.45,
  },
  textBlock: {
    gap: 1,
  },
  title: {
    fontWeight: '600',
    letterSpacing: 0.3,
    fontSize: 11,
  },
  sub: {
    fontSize: 10,
    lineHeight: 13,
  },
});
