/**
 * 手绘页（Task 20 + Task 21）。
 *
 * 进入方式：输入框「+」→ 手绘。画布占满剩余空间，底部是工具栏与两个出口：
 *   - 保存：PNG 入库（`kind:'drawing'`），返回会话页并自动勾选为待发送素材；
 *   - 保存并发送：入库后立刻交给会话页发送（服务端正文要求非空，草稿为空
 *     时用一句默认说明兜底，见会话页的 handoff 消费逻辑）。
 *
 * 导出用 `captureRef` 截白底画布 View。`collapsable={false}` 在 Fabric 上
 * 是硬要求：新架构会把「只有样式没有原生意义」的 View 折叠掉，折叠后 ref
 * 为 null，截图直接失败。
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { SafeAreaWrapper } from '../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../components/layout/TopAppBar';
import { DrawingCanvas } from '../components/drawing/DrawingCanvas';
import { DrawingToolbar } from '../components/drawing/DrawingToolbar';
import {
  CANVAS_BACKGROUND,
  DRAWING_COLORS,
  DRAWING_WIDTHS,
  useDrawingState,
} from '../components/drawing/drawingModel';
import { addAsset } from '../services/attachmentLibrary';
import { toLocalPath } from '../services/attachmentUpload';
import { setEditorHandoff } from '../services/editorHandoff';
import { useToastStore } from '../store/toastStore';
import { useTheme } from '../theme/useTheme';
import type { RootStackParamList } from '../app/navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Drawing'>;

export const DrawingScreen: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('vibecoding');
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const showToast = useToastStore(state => state.show);

  const drawing = useDrawingState();
  const [color, setColor] = useState(DRAWING_COLORS[0]);
  const [width, setWidth] = useState(DRAWING_WIDTHS[0]);
  const [eraser, setEraser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const shotRef = useRef<View>(null);

  const handleSelectColor = useCallback((next: string) => {
    setColor(next);
    setEraser(false);
  }, []);

  const handleToggleEraser = useCallback(() => {
    setEraser(current => !current);
  }, []);

  const handleCanvasLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    setCanvasSize({ width: w, height: h });
  }, []);

  const handleSave = useCallback(
    async (autoSend: boolean) => {
      if (saving) return;
      if (drawing.strokes.length === 0) {
        showToast(t('drawing.empty'), 'info');
        return;
      }
      setSaving(true);
      try {
        const uri = await captureRef(shotRef, {
          format: 'png',
          quality: 1,
          result: 'tmpfile',
        });
        const asset = await addAsset({
          kind: 'drawing',
          sourcePath: toLocalPath(uri),
          width: canvasSize.width > 0 ? Math.round(canvasSize.width) : undefined,
          height: canvasSize.height > 0 ? Math.round(canvasSize.height) : undefined,
        });
        setEditorHandoff({ asset, autoSend });
        navigation.goBack();
      } catch {
        showToast(t('attachments.error'), 'error');
      } finally {
        setSaving(false);
      }
    },
    [canvasSize.height, canvasSize.width, drawing.strokes.length, navigation, saving, showToast, t],
  );

  return (
    <SafeAreaWrapper>
      <TopAppBar title={t('drawing.title')} onBack={navigation.goBack} />
      <View style={styles.body}>
        <View
          ref={shotRef}
          collapsable={false}
          onLayout={handleCanvasLayout}
          style={styles.canvasFrame}>
          <DrawingCanvas
            strokes={drawing.strokes}
            color={eraser ? CANVAS_BACKGROUND : color}
            width={width}
            onStrokeBegin={drawing.begin}
            onStrokeExtend={drawing.extend}
          />
        </View>

        <DrawingToolbar
          color={color}
          width={width}
          eraser={eraser}
          canUndo={drawing.canUndo}
          canRedo={drawing.canRedo}
          onSelectColor={handleSelectColor}
          onSelectWidth={setWidth}
          onToggleEraser={handleToggleEraser}
          onUndo={drawing.undo}
          onRedo={drawing.redo}
          onClear={drawing.clearAll}
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
            testID="drawing-save"
            accessibilityRole="button"
            accessibilityLabel={t('drawing.save')}
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
            <Text style={[theme.typography.labelMd, { color: theme.colors.onSurface }]}>
              {t('drawing.save')}
            </Text>
          </Pressable>
          <Pressable
            testID="drawing-save-send"
            accessibilityRole="button"
            accessibilityLabel={t('drawing.saveAndSend')}
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
                {t('drawing.saveAndSend')}
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
    overflow: 'hidden',
    backgroundColor: CANVAS_BACKGROUND,
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
