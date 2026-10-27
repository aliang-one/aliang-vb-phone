/**
 * 全屏看图：消息气泡里的图片点一下就进这里。
 *
 * 手势用 PanResponder 而不是 GestureDetector——仓库里 GestureDetector 在
 * iOS 26 真机上不触发（见 ContextWindowSlider 的头注释），PanResponder 走的是
 * 老的 responder 链，稳。双指缩放要自己算：从 `nativeEvent.touches` 取两指
 * 距离算比例，取两指中点算平移，全部靠增量，不做基线重设——捏合中抬起一根
 * 手指再落下不会跳。
 *
 * 契约：
 *   - 双指捏合：1x–4x，围绕视图中心缩放；
 *   - 放大后单指拖动看细节（平移会被夹在边界内，图不会拖出视野）；
 *   - 没放大时单指下滑超过阈值 → 关闭；
 *   - 轻点：没放大 → 关闭；放大中 → 回到 1x；
 *   - 右上角关闭按钮永远在。
 *
 * 值直接推到 Animated.Value（不经过 React 渲染），捏合时不会每帧重排整棵树。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { IconBadge } from '../visual/IconBadge';

const MAX_SCALE = 4;
/** 超过这个时长就算「按住」，不算轻点。 */
const TAP_MS = 260;
/** 未放大时下滑多少算关闭手势。 */
const DISMISS_DISTANCE = 90;
/** 位移超过这个像素就不再算轻点（避免手抖把「点开大图」变成「关闭」）。 */
const TAP_SLOP = 6;

export interface ImageViewerModalProps {
  visible: boolean;
  uri?: string;
  /** 无障碍标签用，一般是原文件名。 */
  name?: string;
  onClose: () => void;
}

export const ImageViewerModal: React.FC<ImageViewerModalProps> = ({
  visible,
  uri,
  name,
  onClose,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation('vibecoding');
  const insets = useSafeAreaInsets();

  const [box, setBox] = useState({ width: 0, height: 0 });

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // 手势中间态放在 ref 里：每帧 setState 会让整棵 Modal 重排，捏合必卡。
  const gesture = useRef({
    scale: 1,
    x: 0,
    y: 0,
    pinchStart: 0,
    pinchScale: 1,
    pinchX: 0,
    pinchY: 0,
    midX: 0,
    midY: 0,
    fingers: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    startedAt: 0,
    boxW: 0,
    boxH: 0,
  });

  // 回调进 ref，PanResponder 只创建一次（依赖数组空），不因 props 漂移重建。
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const clampTranslate = useCallback(() => {
    const g = gesture.current;
    const limitX = Math.max(0, (g.boxW * (g.scale - 1)) / 2);
    const limitY = Math.max(0, (g.boxH * (g.scale - 1)) / 2);
    g.x = Math.min(limitX, Math.max(-limitX, g.x));
    // 没放大时不许往上拖：下滑关闭的手势只能是「往下」。
    g.y = g.scale <= 1.01 ? Math.max(0, g.y) : Math.min(limitY, Math.max(-limitY, g.y));
  }, []);

  const push = useCallback(() => {
    const g = gesture.current;
    scale.setValue(g.scale);
    translateX.setValue(g.x);
    translateY.setValue(g.y);
  }, [scale, translateX, translateY]);

  const animateToRest = useCallback(() => {
    const g = gesture.current;
    g.scale = 1;
    g.x = 0;
    g.y = 0;
    g.pinchStart = 0;
    const spring = {
      toValue: 0,
      friction: 9,
      tension: 90,
      useNativeDriver: false as const,
    };
    Animated.parallel([
      Animated.spring(scale, { ...spring, toValue: 1 }),
      Animated.spring(translateX, spring),
      Animated.spring(translateY, spring),
    ]).start();
  }, [scale, translateX, translateY]);

  // 每次打开都从 1x / 居中开始，否则上一张图的缩放会漏到下一张。
  useEffect(() => {
    if (!visible) return;
    gesture.current = {
      ...gesture.current,
      scale: 1,
      x: 0,
      y: 0,
      pinchStart: 0,
      moved: false,
    };
    scale.setValue(1);
    translateX.setValue(0);
    translateY.setValue(0);
  }, [visible, scale, translateX, translateY]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: event => {
          const g = gesture.current;
          g.moved = false;
          g.startedAt = Date.now();
          g.pinchStart = 0;
          g.pinchScale = g.scale;
          const first = event.nativeEvent.touches[0];
          if (first) {
            g.lastX = first.pageX;
            g.lastY = first.pageY;
          }
          g.fingers = event.nativeEvent.touches.length;
        },
        onPanResponderMove: event => {
          const g = gesture.current;
          const touches = event.nativeEvent.touches;

          if (touches.length >= 2) {
            const [a, b] = touches;
            if (g.pinchStart === 0) {
              // 第一帧只有触点、没有参考距离：记基线，不缩放（否则会瞬间跳一下）。
              g.pinchStart = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
              g.pinchScale = g.scale;
              g.pinchX = g.x;
              g.pinchY = g.y;
              g.midX = (a.pageX + b.pageX) / 2;
              g.midY = (a.pageY + b.pageY) / 2;
              g.fingers = touches.length;
              return;
            }
            const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
            if (distance > 0 && g.pinchStart > 0) {
              const next = (g.pinchScale * distance) / g.pinchStart;
              g.scale = Math.min(MAX_SCALE, Math.max(1, next));
            }
            g.x = g.pinchX + ((a.pageX + b.pageX) / 2 - g.midX);
            g.y = g.pinchY + ((a.pageY + b.pageY) / 2 - g.midY);
            g.moved = true;
            g.fingers = touches.length;
            clampTranslate();
            push();
            return;
          }

          const touch = touches[0];
          if (!touch) return;

          if (g.pinchStart !== 0 || g.fingers > 1) {
            // 捏合过程中抬起一根手指：从当前位置重新起算单指拖动。
            g.pinchStart = 0;
            g.fingers = touches.length;
            g.lastX = touch.pageX;
            g.lastY = touch.pageY;
            return;
          }

          const dx = touch.pageX - g.lastX;
          const dy = touch.pageY - g.lastY;
          g.lastX = touch.pageX;
          g.lastY = touch.pageY;
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) {
              g.moved = true;
            }
          }
          g.x += dx;
          g.y += dy;
          clampTranslate();
          push();
        },
        onPanResponderRelease: () => {
          const g = gesture.current;
          const tapped = !g.moved && Date.now() - g.startedAt < TAP_MS;
          if (tapped) {
            if (g.scale > 1.01) {
              animateToRest();
            } else {
              closeRef.current();
            }
            return;
          }
          if (g.scale <= 1.01) {
            if (g.y > DISMISS_DISTANCE) {
              closeRef.current();
              return;
            }
            animateToRest();
            return;
          }
          clampTranslate();
          push();
        },
        onPanResponderTerminate: () => {
          animateToRest();
        },
      }),
    [animateToRest, clampTranslate, push],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    gesture.current.boxW = width;
    gesture.current.boxH = height;
    setBox({ width, height });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('imageViewer.close')}
          testID="image-viewer-backdrop"
        />
        <View
          style={styles.stage}
          onLayout={handleLayout}
          testID="image-viewer-stage"
          {...responder.panHandlers}>
          {!uri ? (
            <Text
              testID="image-viewer-failed"
              style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              {t('imageViewer.failed')}
            </Text>
          ) : box.width > 0 ? (
            <Animated.Image
              testID="image-viewer-image"
              source={{ uri }}
              resizeMode="contain"
              accessibilityLabel={name}
              accessibilityIgnoresInvertColors
              style={[
                {
                  width: box.width,
                  height: box.height,
                  transform: [{ translateX }, { translateY }, { scale }],
                },
              ]}
            />
          ) : null}
        </View>
        <View style={[styles.closeRow, { top: insets.top + 10 }]}>
          <Pressable
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t('imageViewer.close')}
            testID="image-viewer-close">
            <IconBadge name="close" tone="neutral" size={36} iconSize={18} />
          </Pressable>
        </View>
        <View
          pointerEvents="none"
          style={[styles.hintRow, { bottom: insets.bottom + 18 }]}>
          <Text style={[theme.typography.codeSm, styles.hintText]}>
            {t('imageViewer.hint')}
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
  },
  stage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeRow: {
    position: 'absolute',
    right: 14,
    flexDirection: 'row',
  },
  hintRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintText: {
    color: 'rgba(255,255,255,0.55)',
  },
});
