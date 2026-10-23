/**
 * 字符画页（Task 23）。
 *
 * 进入方式：输入框「+」→ ASCII 图。画布占满剩余空间，底部是工具栏与两个
 * 出口，与手绘页保持同一套语义：
 *   - 保存：文本入库（`kind:'ascii'`），返回会话页并自动勾选为待发送素材；
 *   - 保存并发送：入库后立刻交给会话页发送（正文为空时用一句默认说明兜底）。
 *
 * 与手绘的差别：字符画不走图片通道，而是把 `toText()` 的纯文本作为附件
 * 正文发出去，由 agent 端拼成代码块——LLM 读字符画比读一张图更准，也省了
 * 一次上传与一次视觉模型调用。
 *
 * 保存前先 `crop()`：60×30 的网格四周通常有大片空白，整块发过去既浪费
 * token 又会让代码块出现大片空白行。
 */
import React, { useCallback, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeAreaWrapper } from '../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../components/layout/TopAppBar';
import { AsciiCanvas } from '../components/ascii/AsciiCanvas';
import { AsciiToolbar } from '../components/ascii/AsciiToolbar';
import {
  crop,
  isBlank,
  toText,
  useAsciiEditing,
  type AsciiTool,
  type Cell,
} from '../components/ascii/asciiGrid';
import { addAsset } from '../services/attachmentLibrary';
import { setEditorHandoff } from '../services/editorHandoff';
import { useToastStore } from '../store/toastStore';
import { useTheme } from '../theme/useTheme';
import type { RootStackParamList } from '../app/navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Ascii'>;

/** 两档画布尺寸：手机上 120×60 已经小到 5pt 字号，再大就看不清了。 */
const SMALL_SIZE = { cols: 60, rows: 30 };
const LARGE_SIZE = { cols: 120, rows: 60 };

export const AsciiScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const navigation = useNavigation<Navigation>();

  // 与手绘页同理：字符画也是全屏书写面，左缘笔画会误触侧滑返回。
  useLayoutEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
  }, [navigation]);
  const insets = useSafeAreaInsets();
  const showToast = useToastStore(state => state.show);

  const {
    grid,
    canUndo,
    canRedo,
    beginStroke,
    moveStroke,
    endStroke,
    undo,
    redo,
    clearAll,
    resize,
  } = useAsciiEditing(SMALL_SIZE.cols, SMALL_SIZE.rows);

  const [tool, setTool] = useState<AsciiTool>('auto');
  const [char, setChar] = useState('─');
  const [saving, setSaving] = useState(false);

  const isLarge = grid.cols > SMALL_SIZE.cols || grid.rows > SMALL_SIZE.rows;
  const targetSize = isLarge ? SMALL_SIZE : LARGE_SIZE;

  const handleStrokeStart = useCallback(
    (cell: Cell) => beginStroke(cell, tool, char),
    [beginStroke, char, tool],
  );
  const handleStrokeMove = useCallback(
    (cell: Cell) => moveStroke(cell, tool, char),
    [char, moveStroke, tool],
  );
  const handleStrokeEnd = useCallback(
    (cell: Cell) => endStroke(cell, tool, char),
    [char, endStroke, tool],
  );

  const handleToggleSize = useCallback(() => {
    resize(targetSize.cols, targetSize.rows);
  }, [resize, targetSize.cols, targetSize.rows]);

  const handleSave = useCallback(
    async (autoSend: boolean) => {
      if (saving) return;
      if (isBlank(grid)) {
        showToast(t('ascii.empty'), 'info');
        return;
      }
      setSaving(true);
      try {
        // 先裁掉四周空白再导出：既省 token，也避免代码块开头一大片空行。
        const cropped = crop(grid);
        const asset = await addAsset({
          kind: 'ascii',
          text: toText(cropped),
          cols: cropped.cols,
          rows: cropped.rows,
        });
        setEditorHandoff({ asset, autoSend });
        navigation.goBack();
      } catch {
        showToast(t('attachments.error'), 'error');
      } finally {
        setSaving(false);
      }
    },
    [grid, navigation, saving, showToast, t],
  );

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={t('ascii.title')}
        onBack={navigation.goBack}
        rightAction={
          <Pressable
            testID="ascii-size-toggle"
            accessibilityRole="button"
            accessibilityLabel={
              isLarge ? t('ascii.sizeSmall') : t('ascii.sizeLarge')
            }
            onPress={handleToggleSize}
            style={[
              styles.sizeButton,
              {
                borderColor: isDark
                  ? 'rgba(255,255,255,0.12)'
                  : theme.colors.outlineVariant,
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.06)'
                  : theme.colors.surfaceContainerLow,
              },
            ]}>
            <Text
              style={[
                theme.typography.labelMd,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {targetSize.cols}×{targetSize.rows}
            </Text>
          </Pressable>
        }
      />
      <View style={styles.body}>
        <View
          style={[
            styles.canvasFrame,
            {
              backgroundColor: isDark ? '#0B0E11' : '#FFFFFF',
              borderColor: theme.colors.outlineVariant,
            },
          ]}>
          <AsciiCanvas
            grid={grid}
            onStrokeStart={handleStrokeStart}
            onStrokeMove={handleStrokeMove}
            onStrokeEnd={handleStrokeEnd}
          />
        </View>

        <AsciiToolbar
          tool={tool}
          char={char}
          canUndo={canUndo}
          canRedo={canRedo}
          onSelectTool={setTool}
          onChangeChar={setChar}
          onUndo={undo}
          onRedo={redo}
          onClear={clearAll}
        />

        <View
          style={[
            styles.actions,
            {
              paddingBottom: insets.bottom + 12,
              borderTopColor: theme.colors.outlineVariant,
            },
          ]}>
          <Pressable
            testID="ascii-save"
            accessibilityRole="button"
            accessibilityLabel={t('ascii.save')}
            disabled={saving}
            onPress={() => void handleSave(false)}
            style={[
              styles.actionButton,
              {
                borderColor: theme.colors.outlineVariant,
                backgroundColor: theme.colors.surfaceContainerLow,
                opacity: saving ? 0.5 : 1,
              },
            ]}>
            <Text
              style={[theme.typography.labelMd, { color: theme.colors.onSurface }]}>
              {t('ascii.save')}
            </Text>
          </Pressable>
          <Pressable
            testID="ascii-save-send"
            accessibilityRole="button"
            accessibilityLabel={t('ascii.saveAndSend')}
            disabled={saving}
            onPress={() => void handleSave(true)}
            style={[
              styles.actionButton,
              styles.primaryAction,
              {
                backgroundColor: theme.colors.primary,
                borderColor: theme.colors.primary,
                opacity: saving ? 0.5 : 1,
              },
            ]}>
            {saving ? (
              <ActivityIndicator color={theme.colors.onPrimary} />
            ) : (
              <Text
                style={[theme.typography.labelMd, { color: theme.colors.onPrimary }]}>
                {t('ascii.saveAndSend')}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  canvasFrame: {
    flex: 1,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sizeButton: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionButton: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryAction: {
    flex: 1.4,
  },
});
