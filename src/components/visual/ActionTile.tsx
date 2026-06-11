import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { IconBadge, IconName } from './IconBadge';

type Tone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'error'
  | 'neutral'
  | 'info'
  | 'success';

interface ActionTileProps {
  icon: IconName;
  label: string;
  value?: string;
  caption?: string;
  tone?: Tone;
  onPress: () => void;
  compact?: boolean;
  style?: object;
}

const toneToGlow: Record<Tone, 'primary' | 'secondary' | 'error' | 'none'> = {
  primary: 'primary',
  secondary: 'secondary',
  success: 'secondary',
  info: 'primary',
  tertiary: 'none',
  error: 'error',
  neutral: 'none',
};

export const ActionTile: React.FC<ActionTileProps> = ({
  icon,
  label,
  value,
  caption,
  tone = 'primary',
  onPress,
  compact = false,
  style,
}) => {
  const { theme } = useTheme();
  const iconTone =
    tone === 'success'
      ? 'secondary'
      : tone === 'info'
      ? 'primary'
      : tone;

  return (
    <TouchableOpacity activeOpacity={0.76} onPress={onPress} style={style}>
      <GlassPanel glowColor={toneToGlow[tone]} style={[styles.tile, compact && styles.compact]}>
        <View style={styles.topRow}>
          <IconBadge name={icon} tone={iconTone} size={compact ? 34 : 42} iconSize={compact ? 18 : 21} />
          {value ? (
            <Text style={[theme.typography.headlineMd, { color: theme.colors.onSurface }]}>
              {value}
            </Text>
          ) : null}
        </View>
        <View style={styles.copy}>
          <Text
            numberOfLines={1}
            style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
            {label}
          </Text>
          {caption ? (
            <Text
              numberOfLines={2}
              style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {caption}
            </Text>
          ) : null}
        </View>
      </GlassPanel>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  tile: {
    minHeight: 104,
    padding: 12,
    justifyContent: 'space-between',
    gap: 12,
  },
  compact: {
    minHeight: 86,
    padding: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  copy: {
    gap: 3,
  },
});
