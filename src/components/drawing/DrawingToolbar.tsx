/**
 * 手绘工具栏（Task 20）。
 *
 * 三组控件：颜色 / 粗细 / 历史。橡皮是「白色画笔」的开关——打开时笔色被
 * 强制成白色，再点一次回到之前选的颜色（由屏幕层记着）。
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { DRAWING_COLORS, DRAWING_WIDTHS } from './drawingModel';

export interface DrawingToolbarProps {
  color: string;
  width: number;
  eraser: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSelectColor: (color: string) => void;
  onSelectWidth: (width: number) => void;
  onToggleEraser: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

/** 粗细的视觉映射：按钮里画一个同色圆点，直径 = 笔宽 + 内边距。 */
const widthDotSize = (width: number) => width + 8;

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  color,
  width,
  eraser,
  canUndo,
  canRedo,
  onSelectColor,
  onSelectWidth,
  onToggleEraser,
  onUndo,
  onRedo,
  onClear,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');

  const borderColor = isDark
    ? 'rgba(255,255,255,0.12)'
    : theme.colors.outlineVariant;
  const activeBorder = theme.colors.primary;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {DRAWING_COLORS.map(item => {
          const selected = !eraser && color === item;
          return (
            <Pressable
              key={item}
              testID={`drawing-color-${item.replace('#', '')}`}
              accessibilityRole="button"
              accessibilityLabel={t('drawing.colorLabel', { color: item })}
              accessibilityState={{ selected }}
              onPress={() => onSelectColor(item)}
              style={[
                styles.colorSwatch,
                {
                  backgroundColor: item,
                  borderColor: selected ? activeBorder : borderColor,
                  borderWidth: selected ? 3 : 1,
                },
              ]}
            />
          );
        })}
        <Pressable
          testID="drawing-eraser"
          accessibilityRole="button"
          accessibilityLabel={t('drawing.eraser')}
          accessibilityState={{ selected: eraser }}
          onPress={onToggleEraser}
          style={[
            styles.eraser,
            {
              borderColor: eraser ? activeBorder : borderColor,
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.06)'
                : theme.colors.surfaceContainerLow,
            },
          ]}>
          <Text
            style={[
              theme.typography.labelMd,
              { color: eraser ? theme.colors.primary : theme.colors.onSurfaceVariant },
            ]}>
            {t('drawing.eraserShort')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        {DRAWING_WIDTHS.map(item => {
          const selected = width === item;
          return (
            <Pressable
              key={item}
              testID={`drawing-width-${item}`}
              accessibilityRole="button"
              accessibilityLabel={t('drawing.widthLabel', { width: item })}
              accessibilityState={{ selected }}
              onPress={() => onSelectWidth(item)}
              style={[
                styles.widthButton,
                {
                  borderColor: selected ? activeBorder : borderColor,
                  backgroundColor: isDark
                    ? 'rgba(255,255,255,0.06)'
                    : theme.colors.surfaceContainerLow,
                },
              ]}>
              <View
                style={{
                  width: widthDotSize(item),
                  height: widthDotSize(item),
                  borderRadius: widthDotSize(item) / 2,
                  backgroundColor: eraser ? theme.colors.onSurfaceVariant : color,
                }}
              />
            </Pressable>
          );
        })}
        <View style={styles.spacer} />
        <ToolButton
          testID="drawing-undo"
          label={t('drawing.undo')}
          disabled={!canUndo}
          onPress={onUndo}
        />
        <ToolButton
          testID="drawing-redo"
          label={t('drawing.redo')}
          disabled={!canRedo}
          onPress={onRedo}
        />
        <ToolButton
          testID="drawing-clear"
          label={t('drawing.clear')}
          disabled={!canUndo && !canRedo}
          onPress={onClear}
          danger
        />
      </View>
    </View>
  );
};

const ToolButton: React.FC<{
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
        styles.toolButton,
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colorSwatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  eraser: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  widthButton: {
    width: 40,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: {
    flex: 1,
  },
  toolButton: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
