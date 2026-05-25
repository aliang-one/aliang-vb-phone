import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface GlowButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline';
  loading?: boolean;
  disabled?: boolean;
  style?: object;
  textStyle?: object;
}

export const GlowButton: React.FC<GlowButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  textStyle,
}) => {
  const { theme, isDark } = useTheme();

  const getButtonStyle = () => {
    if (disabled) {
      return {
        backgroundColor: isDark
          ? 'rgba(255,255,255,0.08)'
          : theme.colors.surfaceContainerHigh,
      };
    }
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: theme.colors.primary,
          ...(isDark ? theme.glow.primary : {}),
        };
      case 'secondary':
        return {
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderColor: theme.colors.primary,
        };
      case 'outline':
        return {
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderColor: isDark
            ? 'rgba(255,255,255,0.15)'
            : theme.colors.outline,
        };
    }
  };

  const textColor =
    disabled
      ? theme.colors.onSurfaceVariant
      : variant === 'primary'
      ? theme.colors.onPrimary
      : theme.colors.primary;

  return (
    <TouchableOpacity
      style={[
        styles.button,
        { borderRadius: theme.borderRadius.md },
        getButtonStyle(),
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}>
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <Text
          style={[
            theme.typography.labelMd,
            { color: textColor },
            styles.text,
            textStyle,
          ]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
