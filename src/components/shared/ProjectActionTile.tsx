import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { IconBadge, IconName } from '../visual/IconBadge';

export type ActionTileTone = 'primary' | 'secondary' | 'tertiary' | 'neutral';

interface ProjectActionTileProps {
  icon: IconName;
  title: string;
  subtitle: string;
  tone?: ActionTileTone;
  onPress?: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}

const resolveTone = (
  tone: ActionTileTone,
  colors: ReturnType<typeof useTheme>['theme']['colors'],
) => {
  switch (tone) {
    case 'secondary':
      return colors.secondary;
    case 'tertiary':
      return colors.tertiary;
    case 'neutral':
      return colors.onSurfaceVariant;
    default:
      return colors.primary;
  }
};

// A richer alternative to the flat outline action buttons: a tinted command
// tile with a top accent bar, icon, title, one-line subtitle, and a trailing
// chevron. Tone drives the accent colour so each action in the grid reads as
// distinct without breaking the VSCode-dark palette.
export const ProjectActionTile: React.FC<ProjectActionTileProps> = ({
  icon,
  title,
  subtitle,
  tone = 'primary',
  onPress,
  disabled = false,
  style,
}) => {
  const { theme, isDark } = useTheme();
  const color = resolveTone(tone, theme.colors);

  const backgroundColor = disabled
    ? isDark
      ? 'rgba(255,255,255,0.025)'
      : theme.colors.surfaceContainerLow
    : isDark
    ? `${color}14`
    : `${color}0D`;

  const borderColor = disabled
    ? isDark
      ? 'rgba(255,255,255,0.06)'
      : theme.colors.outlineVariant
    : `${color}55`;

  return (
    <TouchableOpacity
      activeOpacity={0.72}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.tile,
        {
          backgroundColor,
          borderColor,
          borderRadius: theme.borderRadius.lg,
        },
        disabled && styles.disabled,
        style,
      ]}>
      <View style={[styles.accentBar, { backgroundColor: color }]} />
      <View style={styles.tileHead}>
        <IconBadge
          name={icon}
          tone={tone === 'neutral' ? 'neutral' : tone}
          size={32}
          iconSize={16}
        />
        <IconBadge
          name="chevron"
          tone={tone === 'neutral' ? 'neutral' : tone}
          size={20}
          iconSize={11}
          style={styles.chevron}
        />
      </View>
      <Text
        numberOfLines={1}
        style={[theme.typography.labelMd, styles.title, { color: theme.colors.onSurface }]}>
        {title}
      </Text>
      <Text
        numberOfLines={1}
        style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
        {subtitle}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 0,
    paddingTop: 13,
    paddingBottom: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    overflow: 'hidden',
    gap: 5,
  },
  accentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  tileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  chevron: {
    opacity: 0.5,
  },
  title: {
    fontWeight: '700',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  disabled: {
    opacity: 0.45,
  },
});
