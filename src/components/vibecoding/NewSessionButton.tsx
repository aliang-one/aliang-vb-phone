import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { IconBadge } from '../visual/IconBadge';

interface NewSessionButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

export const NewSessionButton: React.FC<NewSessionButtonProps> = ({
  onPress,
  disabled = false,
}) => {
  const { theme, isDark } = useTheme();

  const backgroundColor = isDark
    ? 'rgba(86, 156, 214, 0.08)'
    : 'rgba(0, 81, 174, 0.06)';

  const borderColor = disabled
    ? theme.colors.outlineVariant
    : theme.colors.primary;

  const textColor = disabled
    ? theme.colors.onSurfaceVariant
    : theme.colors.primary;

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {
          backgroundColor,
          borderColor,
          borderRadius: theme.borderRadius.lg,
          borderLeftWidth: 3,
          borderLeftColor: disabled ? theme.colors.outlineVariant : theme.colors.primary,
        },
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}>
      <View style={styles.left}>
        <IconBadge
          name="plus"
          tone={disabled ? 'neutral' : 'primary'}
          size={30}
          iconSize={15}
          filled
        />
        <View style={styles.textBlock}>
          <Text
            style={[
              theme.typography.labelMd,
              { color: textColor },
              styles.title,
            ]}>
            NEW VIBECODING SESSION
          </Text>
          <Text
            style={[
              theme.typography.labelSm,
              { color: theme.colors.onSurfaceVariant },
            ]}>
            Start a new AI coding task
          </Text>
        </View>
      </View>
      <IconBadge
        name="play"
        tone={disabled ? 'neutral' : 'primary'}
        size={24}
        iconSize={12}
      />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  disabled: {
    opacity: 0.5,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  textBlock: {
    gap: 1,
  },
  title: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});