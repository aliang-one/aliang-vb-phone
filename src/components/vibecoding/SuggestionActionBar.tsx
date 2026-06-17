import React from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface SuggestionActionBarProps {
  suggestions: string[];
  onSelect?: (suggestion: string) => void;
}

export const SuggestionActionBar: React.FC<SuggestionActionBarProps> = ({
  suggestions,
  onSelect,
}) => {
  const { theme, isDark } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}>
      {suggestions.map(suggestion => (
        <TouchableOpacity
          key={suggestion}
          activeOpacity={0.75}
          onPress={() => onSelect?.(suggestion)}
          style={[
            styles.chip,
            {
              borderColor: isDark
                ? 'rgba(86, 156, 214, 0.25)'
                : theme.colors.outlineVariant,
              backgroundColor: isDark
                ? 'rgba(86, 156, 214, 0.08)'
                : theme.colors.surfaceContainer,
              borderRadius: theme.borderRadius.full,
            },
          ]}>
          <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
            {suggestion}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: {
    gap: 8,
    paddingRight: 16,
  },
  chip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
});
