import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { IconBadge, IconName } from '../visual/IconBadge';
import { GlassPanel } from './GlassPanel';

interface ActionCardProps {
  icon: IconName;
  title: string;
  stats: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'default' | 'highlight';
  style?: object;
}

export const ActionCard: React.FC<ActionCardProps> = ({
  icon,
  title,
  stats,
  onPress,
  disabled = false,
  variant = 'default',
  style,
}) => {
  const { theme, isDark } = useTheme();

  const iconTone = disabled ? 'neutral' : variant === 'highlight' ? 'primary' : 'primary';

  const titleColor = disabled
    ? theme.colors.onSurfaceVariant
    : theme.colors.onSurface;

  const statsColor = disabled
    ? theme.colors.onSurfaceVariant
    : theme.colors.primary;

  const borderColor = variant === 'highlight' && !disabled
    ? theme.colors.primary
    : isDark
    ? 'rgba(255,255,255,0.08)'
    : theme.colors.outlineVariant;

  return (
    <GlassPanel
      style={[
        styles.container,
        { borderColor },
        disabled && styles.disabledContainer,
        style,
      ]}>
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.75}
        style={styles.touchable}>
        <View style={styles.header}>
          <IconBadge
            name={icon}
            tone={iconTone}
            size={32}
            iconSize={16}
            filled={variant === 'highlight' && !disabled}
          />
          <Text
            style={[
              theme.typography.labelMd,
              { color: titleColor },
              styles.title,
            ]}>
            {title}
          </Text>
          <Text
            style={[
              theme.typography.codeSm,
              { color: statsColor },
              styles.stats,
            ]}>
            {stats}
          </Text>
        </View>
      </TouchableOpacity>
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 10,
    marginBottom: 6,
  },
  disabledContainer: {
    opacity: 0.5,
  },
  touchable: {
    gap: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontWeight: '600',
    flex: 1,
  },
  stats: {
    letterSpacing: 0.1,
  },
});