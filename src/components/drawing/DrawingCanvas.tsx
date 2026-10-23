/**
 * 手绘画布（Task 20；2026-10-23 真机修复）。
 *
 * 组件是受控的：笔迹状态在 DrawingScreen（见 `useDrawingState`），这里只做
 * 三件事——白底、把 `<Path>` 画出来、把手指轨迹翻译成回调。
 *
 * 实现约束：
 * - 手势用 RN 原生 PanResponder（2026-10-23 起）：RNGH `GestureDetector` 在
 *   iOS 26 真机上回调不触发（两个 RNGH 画布全灭、PanResponder 的快滑条正常）；
 * - 手势对象只创建一次，回调经 ref 读最新 props——每次渲染重建 responder
 *   会让正在进行的笔画中途换手指时断线；
 * - SVG 覆盖层 `pointerEvents="none"`，否则它会抢走触摸、坐标漂移；
 * - 背景色写死在容器上（`CANVAS_BACKGROUND`），导出时就是这块 View 被截图。
 */
import React, { useMemo, useRef } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import {
  CANVAS_BACKGROUND,
  newStrokeId,
  toPathD,
  type DrawingPoint,
  type DrawingStroke,
} from './drawingModel';

export interface DrawingCanvasProps {
  strokes: DrawingStroke[];
  /** 当前笔色；橡皮时由屏幕传白色。 */
  color: string;
  width: number;
  onStrokeBegin: (stroke: DrawingStroke) => void;
  onStrokeExtend: (strokeId: string, point: DrawingPoint) => void;
  onStrokeEnd?: () => void;
}

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  strokes,
  color,
  width,
  onStrokeBegin,
  onStrokeExtend,
  onStrokeEnd,
}) => {
  // 手势只创建一次，回调必须能读到最新 props，所以走 ref。
  const handlers = useRef({ color, width, onStrokeBegin, onStrokeExtend, onStrokeEnd });
  handlers.current = { color, width, onStrokeBegin, onStrokeExtend, onStrokeEnd };
  // 正在进行的手势（手指按下到抬起）。抬手时清空，避免迟到的 update 续上旧笔。
  const activeStrokeId = useRef<string | null>(null);

  const pointOf = (event: GestureResponderEvent): DrawingPoint => ({
    x: event.nativeEvent.locationX,
    y: event.nativeEvent.locationY,
  });

  const gesture = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: event => {
          const id = newStrokeId();
          activeStrokeId.current = id;
          handlers.current.onStrokeBegin({
            id,
            color: handlers.current.color,
            width: handlers.current.width,
            points: [pointOf(event)],
          });
        },
        onPanResponderMove: event => {
          const id = activeStrokeId.current;
          if (!id) return;
          handlers.current.onStrokeExtend(id, pointOf(event));
        },
        onPanResponderRelease: () => {
          activeStrokeId.current = null;
          handlers.current.onStrokeEnd?.();
        },
        onPanResponderTerminate: () => {
          // 被系统打断（来电、切后台）时 release 不一定来，这里兜底。
          activeStrokeId.current = null;
        },
      }),
    [],
  );

  return (
    <View {...gesture.panHandlers} style={styles.container} testID="drawing-canvas">
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Rect x="0" y="0" width="100%" height="100%" fill={CANVAS_BACKGROUND} />
        {strokes.map(stroke => (
          <Path
            key={stroke.id}
            d={toPathD(stroke.points)}
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CANVAS_BACKGROUND,
    overflow: 'hidden',
  },
});
