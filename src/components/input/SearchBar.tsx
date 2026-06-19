import React, { useState } from 'react';
import { View, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Explicit clear handler. Falls back to onChangeText(''). */
  onClear?: () => void;
  autoFocus?: boolean;
  testID?: string;
}

/**
 * Glass search field. Leading magnifier + trailing clear button (revealed only
 * when there is text). Focus lifts the border to the primary accent and adds
 * the signature glow in dark mode, so the field reads as live, not decorative.
 */
export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChangeText,
  placeholder = 'Search...',
  onClear,
  autoFocus = false,
  testID,
}) => {
  const { theme, isDark } = useTheme();
  const [focused, setFocused] = useState(false);
  const hasText = value.trim().length > 0;
  const accent = theme.colors.primary;

  const borderColor = focused
    ? accent
    : isDark
      ? 'rgba(255, 255, 255, 0.08)'
      : theme.colors.outlineVariant;
  const iconColor = focused ? accent : theme.colors.onSurfaceVariant;

  const handleClear = () => {
    if (onClear) {
      onClear();
    } else {
      onChangeText('');
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? 'rgba(255, 255, 255, 0.04)'
            : theme.colors.surfaceContainer,
          borderRadius: theme.borderRadius.md,
          borderColor,
        },
        focused && isDark ? theme.glow.primary : null,
      ]}>
      <View style={styles.iconWrap}>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
          <Circle cx="10.5" cy="10.5" r="6" stroke={iconColor} strokeWidth={2} />
          <Line
            x1="15.2"
            y1="15.2"
            x2="19"
            y2="19"
            stroke={iconColor}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </Svg>
      </View>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.onSurfaceVariant}
        autoFocus={autoFocus}
        autoCorrect={false}
        returnKeyType="search"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          theme.typography.codeSm,
          { color: theme.colors.onSurface },
          styles.input,
        ]}
      />
      {hasText ? (
        <TouchableOpacity
          activeOpacity={0.6}
          onPress={handleClear}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.clearBtn}>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Path
              d="M6 6l12 12M18 6L6 18"
              stroke={theme.colors.onSurfaceVariant}
              strokeWidth={2.4}
              strokeLinecap="round"
            />
          </Svg>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    paddingLeft: 10,
  },
  input: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});
