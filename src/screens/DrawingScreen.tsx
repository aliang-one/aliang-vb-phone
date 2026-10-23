/**
 * 手绘页（Task 20 + Task 21）。
 *
 * 进入方式：输入框「+」→ 手绘。画布占满剩余空间，底部是工具栏与一个出口：
 *   - 完成：PNG 入库（`kind:'drawing'`），返回会话页并作为待发送素材挂在
 *     输入框上方。发送永远是用户在输入框里显式点的——这里绝不能自动发：
 *     手绘往往只是消息的一部分，用户回到输入框后还要继续打字。
 *
 * 导出用 `captureRef` 截白底画布 View。`collapsable={false}` 在 Fabric 上
 * 是硬要求：新架构会把「只有样式没有原生意义」的 View 折叠掉，折叠后 ref
 * 为 null，截图直接失败。
 */
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
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

  // 画布是全屏书写面：从左缘起笔向右画会误触 iOS 侧滑返回，把画到一半的
  // 内容直接退掉。关闭系统滑动返回，退出只走左上角返回键。
  useLayoutEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
  }, [navigation]);
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
    async () => {
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
        // autoSend 恒为 false：素材只挂到输入框，等用户补完文字后自己点发送。
        setEditorHandoff({ asset, autoSend: false });
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
          <Text
            style={[
              theme.typography.bodySm,
              styles.attachHint,
              { color: theme.colors.onSurfaceVariant },
            ]}>
            {t('drawing.attachHint')}
          </Text>
          <Pressable
            testID="drawing-save"
            accessibilityRole="button"
            accessibilityLabel={t('drawing.done')}
            disabled={saving}
            onPress={() => void handleSave()}
            style={[
              styles.actionButton,
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
                {t('drawing.done')}
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
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attachHint: {
    textAlign: 'center',
  },
  actionButton: {
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
