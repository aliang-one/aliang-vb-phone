/**
 * 字符画工具栏（Task 23）。
 *
 * 两行：工具 + 历史；字符调色板 + 自定义字符输入。字符集是制表符/箭头，
 * 自定义输入让用户能写字母数字标签（「文字」工具的落笔字符）。
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { ASCII_CHARSET, ASCII_TOOLS, type AsciiTool } from './asciiGrid';

export interface AsciiToolbarProps {
  tool: AsciiTool;
  char: string;
  canUndo: boolean;
  canRedo: boolean;
  onSelectTool: (tool: AsciiTool) => void;
  onChangeChar: (char: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

const TOOL_LABEL_KEYS: Record<AsciiTool, string> = {
  hline: 'ascii.toolHline',
  vline: 'ascii.toolVline',
  diag: 'ascii.toolDiag',
  rect: 'ascii.toolRect',
  arrow: 'ascii.toolArrow',
  text: 'ascii.toolText',
  eraser: 'ascii.toolEraser',
};

export const AsciiToolbar: React.FC<AsciiToolbarProps> = ({
  tool,
  char,
  canUndo,
  canRedo,
  onSelectTool,
  onChangeChar,
  onUndo,
  onRedo,
  onClear,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');

  const borderColor = isDark
    ? 'rgba(255,255,255,0.12)'
    : theme.colors.outlineVariant;
  const surface = isDark
    ? 'rgba(255,255,255,0.06)'
    : theme.colors.surfaceContainerLow;

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {ASCII_TOOLS.map(item => {
            const selected = tool === item;
            return (
              <Pressable
                key={item}
                testID={`ascii-tool-${item}`}
                accessibilityRole="button"
                accessibilityLabel={t(TOOL_LABEL_KEYS[item])}
                accessibilityState={{ selected }}
                onPress={() => onSelectTool(item)}
                style={[
                  styles.pill,
                  {
                    borderColor: selected ? theme.colors.primary : borderColor,
                    backgroundColor: selected
                      ? theme.colors.primary + '22'
                      : surface,
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.labelMd,
                    {
                      color: selected
                        ? theme.colors.primary
                        : theme.colors.onSurface,
                    },
                  ]}>
                  {t(TOOL_LABEL_KEYS[item])}
                </Text>
              </Pressable>
            );
          })}
          <View style={styles.divider} />
          <PillButton
            testID="ascii-undo"
            label={t('ascii.undo')}
            disabled={!canUndo}
            onPress={onUndo}
          />
          <PillButton
            testID="ascii-redo"
            label={t('ascii.redo')}
            disabled={!canRedo}
            onPress={onRedo}
          />
          <PillButton
            testID="ascii-clear"
            label={t('ascii.clear')}
            disabled={!canUndo && !canRedo}
            onPress={onClear}
            danger
          />
        </View>
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {ASCII_CHARSET.map(item => {
            const selected = char === item;
            return (
              <Pressable
                key={item}
                testID={`ascii-char-${item.charCodeAt(0)}`}
                accessibilityRole="button"
                accessibilityLabel={item}
                accessibilityState={{ selected }}
                onPress={() => onChangeChar(item)}
                style={[
                  styles.charButton,
                  {
                    borderColor: selected ? theme.colors.primary : borderColor,
                    backgroundColor: surface,
                  },
                ]}>
                <Text
                  style={{
                    fontFamily: 'Menlo',
                    fontSize: 16,
                    lineHeight: 20,
                    color: theme.colors.onSurface,
                  }}>
                  {item}
                </Text>
              </Pressable>
            );
          })}
          <TextInput
            testID="ascii-custom-char"
            value={char}
            onChangeText={value => {
              // 网格一格只放一个字符，输入多字符时取最后一个（输入法组合期
              // 会先给出整段拼音，取最后才是用户想要的落笔字符）。
              const next = value.slice(-1);
              if (next) onChangeChar(next);
            }}
            maxLength={2}
            placeholder={t('ascii.customChar')}
            placeholderTextColor={theme.colors.onSurfaceVariant}
            style={[
              styles.charInput,
              {
                borderColor,
                color: theme.colors.onSurface,
                backgroundColor: surface,
              },
            ]}
          />
        </View>
      </ScrollView>
    </View>
  );
};

const PillButton: React.FC<{
  testID: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onPress: () => void;
}> = ({ testID, label, disabled, danger, onPress }) => {
  const { theme, isDark } = useTheme();
  const tone = disabled
    ? theme.colors.onSurfaceVariant
    : danger
      ? theme.colors.error
      : theme.colors.onSurface;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.pill,
        {
          borderColor: isDark
            ? 'rgba(255,255,255,0.12)'
            : theme.colors.outlineVariant,
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.06)'
            : theme.colors.surfaceContainerLow,
          opacity: disabled ? 0.4 : 1,
        },
      ]}>
      <Text style={[theme.typography.labelMd, { color: tone }]}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  pill: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(128,128,128,0.25)',
  },
  charButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  charInput: {
    width: 64,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 0,
    fontSize: 14,
  },
});
