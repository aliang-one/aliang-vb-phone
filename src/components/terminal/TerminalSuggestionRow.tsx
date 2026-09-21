// AI-suggested command chips for the terminal bottom bar (spec 2026-09-21).
// Replaces the old history/fallback suggestion row: chips come exclusively
// from the useAiCommandSuggestions hook (server commandGen output). A
// dangerous chip (server flag OR local isUnsafeSuggestion) uses a two-tap
// arm/confirm instead of a modal — same safety semantics as VoiceToBashModal's
// second confirm, zero extra surface.
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import type { AiSuggestionChip } from '../../utils/aiSuggestions';

const testIdSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const ARM_RESET_MS = 3000;

export interface TerminalSuggestionRowProps {
  chips: AiSuggestionChip[];
  disabled: boolean;
  onExecute: (command: string) => void;
}

// 危险 chip 的表面色随 isDark/theme 变化,故用工厂函数而非静态 StyleSheet 条目。
const chipSurface = (
  isDark: boolean,
  theme: ReturnType<typeof useTheme>['theme'],
): { backgroundColor: string; borderColor: string } => ({
  backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : theme.colors.surfaceContainerLow,
  borderColor: isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant,
});

export const TerminalSuggestionRow: React.FC<TerminalSuggestionRowProps> = ({
  chips,
  disabled,
  onExecute,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('terminal');
  const [armedCommand, setArmedCommand] = useState<string | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    },
    [],
  );

  const handlePress = (chip: AiSuggestionChip) => {
    if (disabled) return;
    if (chip.dangerous && armedCommand !== chip.command) {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
      setArmedCommand(chip.command);
      armTimerRef.current = setTimeout(() => setArmedCommand(null), ARM_RESET_MS);
      return;
    }
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    setArmedCommand(null);
    onExecute(chip.command);
  };

  if (chips.length === 0) {
    return (
      <View
        testID="terminal-suggestion-empty"
        style={[styles.chip, styles.emptyChip, chipSurface(isDark, theme)]}
      >
        <Text
          numberOfLines={1}
          style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
        >
          {t('aiSuggest.emptyHint')}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      testID="terminal-suggestion-row"
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {chips.map(chip => {
        const armed = armedCommand === chip.command;
        return (
          <TouchableOpacity
            key={chip.command}
            testID={`terminal-suggestion-${testIdSlug(chip.command)}`}
            activeOpacity={0.76}
            accessibilityRole="button"
            accessibilityLabel={
              armed
                ? t('aiSuggest.a11yArm', { command: chip.command })
                : t('aiSuggest.a11yRun', { command: chip.command })
            }
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => handlePress(chip)}
            style={[
              styles.chip,
              chipSurface(isDark, theme),
              chip.dangerous && {
                borderColor: theme.colors.error,
                ...(armed ? { backgroundColor: theme.colors.errorContainer } : {}),
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                theme.typography.codeSm,
                {
                  color: chip.dangerous ? theme.colors.error : theme.colors.onSurfaceVariant,
                },
              ]}
            >
              {armed ? t('aiSuggest.chipArm') : chip.command}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  row: { gap: 8, paddingRight: 12 },
  chip: {
    maxWidth: 200,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  emptyChip: { alignSelf: 'flex-start', maxWidth: 280 },
});
