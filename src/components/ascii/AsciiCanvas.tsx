/**
 * ASCII 画布（Task 23；2026-10-23 两次真机修复）。
 *
 * 性能关键：整块网格渲染成**一个** `<Text>`。60×30 逐格一个节点是 1800 个
 * 视图，拖动时每帧重渲染会直接卡死；一个 Text 只是一次文本布局。
 *
 * ⚠️ 触摸层必须**显式定尺寸**，不能让文本内容撑开：空网格全是空格，iOS
 * 测量 Text 时会剥掉行尾空白，宽度塌缩为 0 → 触摸目标消失、网格线零宽
 * （真机实测：画布完全无响应）。现在由 fontSize 推导 cellWidth/cellHeight，
 * 触摸层、网格线、坐标映射三者共用同一坐标系：
 *   cellWidth = fontSize × 0.6（Menlo / Roboto Mono 的字符步进都是 0.6em，
 *   偏差 <0.2%，60 列累计不到 1pt）；cellHeight = fontSize × 1.35 行高。
 *
 * 手势用 RN 原生 PanResponder（2026-10-23 起）：RNGH `GestureDetector` 在
 * iOS 26 真机上回调不触发（本 App 两个 RNGH 画布全灭、PanResponder 正常）。
 * 子节点全部 `pointerEvents="none"`，move 坐标恒相对手势层，不会漂移。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import type { AsciiGrid, Cell } from './asciiGrid';
import { toText } from './asciiGrid';

/** Menlo / Droid Sans Mono / Roboto Mono 的字符步进都是 0.6em。 */
const CELL_WIDTH_RATIO = 0.6;
const LINE_HEIGHT_RATIO = 1.35;
const MIN_FONT_SIZE = 5;
const MAX_FONT_SIZE = 14;
/** 画布四周留一点余量，避免预估偏差把最后一列挤出屏幕。 */
const SIZE_SAFETY = 8;

export interface AsciiCanvasProps {
  grid: AsciiGrid;
  onStrokeStart: (cell: Cell) => void;
  onStrokeMove: (cell: Cell) => void;
  onStrokeEnd: (cell: Cell) => void;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const AsciiCanvas: React.FC<AsciiCanvasProps> = ({
  grid,
  onStrokeStart,
  onStrokeMove,
  onStrokeEnd,
}) => {
  const { isDark } = useTheme();
  const [available, setAvailable] = useState({ width: 0, height: 0 });

  const fontSize = useMemo(() => {
    const byWidth =
      available.width > 0
        ? (available.width - SIZE_SAFETY) / grid.cols / CELL_WIDTH_RATIO
        : MAX_FONT_SIZE;
    const byHeight =
      available.height > 0
        ? (available.height - SIZE_SAFETY) / grid.rows / LINE_HEIGHT_RATIO
        : MAX_FONT_SIZE;
    const fit = Math.min(byWidth, byHeight);
    return Math.round(clamp(fit, MIN_FONT_SIZE, MAX_FONT_SIZE) * 10) / 10;
  }, [available.height, available.width, grid.cols, grid.rows]);

  const lineHeight = Math.round(fontSize * LINE_HEIGHT_RATIO);
  const cellWidth = fontSize * CELL_WIDTH_RATIO;
  const canvasWidth = cellWidth * grid.cols;
  const canvasHeight = lineHeight * grid.rows;

  // 手势对象只创建一次（否则每次渲染都换手势，拖动会中断）；映射参数与
  // 回调都走 ref，保证读到的是最新值。
  const mappingRef = useRef({ cellWidth, cellHeight: lineHeight, cols: grid.cols, rows: grid.rows });
  mappingRef.current = {
    cellWidth,
    cellHeight: lineHeight,
    cols: grid.cols,
    rows: grid.rows,
  };

  const handlersRef = useRef({ onStrokeStart, onStrokeMove, onStrokeEnd });
  handlersRef.current = { onStrokeStart, onStrokeMove, onStrokeEnd };

  const activeRef = useRef(false);
  const lastCellRef = useRef<Cell | null>(null);

  const toCell = useCallback((x: number, y: number): Cell => {
    const mapping = mappingRef.current;
    return {
      x: clamp(Math.floor(x / mapping.cellWidth), 0, mapping.cols - 1),
      y: clamp(Math.floor(y / mapping.cellHeight), 0, mapping.rows - 1),
    };
  }, []);

  const cellOf = (event: GestureResponderEvent): Cell =>
    toCell(event.nativeEvent.locationX, event.nativeEvent.locationY);

  const gesture = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: event => {
          const cell = cellOf(event);
          activeRef.current = true;
          lastCellRef.current = cell;
          handlersRef.current.onStrokeStart(cell);
        },
        onPanResponderMove: event => {
          if (!activeRef.current) return;
          const cell = cellOf(event);
          lastCellRef.current = cell;
          handlersRef.current.onStrokeMove(cell);
        },
        onPanResponderRelease: event => {
          if (!activeRef.current) return;
          activeRef.current = false;
          handlersRef.current.onStrokeEnd(cellOf(event));
        },
        // 手势被系统取消时 release 不会触发；terminate 兜底提交，避免「画到
        // 一半来电」留下一个永远不结束的进行中笔迹。
        onPanResponderTerminate: () => {
          if (!activeRef.current) return;
          activeRef.current = false;
          const last = lastCellRef.current;
          if (last) handlersRef.current.onStrokeEnd(last);
        },
      }),
    [cellOf],
  );

  const handleAvailableLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setAvailable({ width, height });
  }, []);

  // 方格背景：列/行边界各一条淡线。让「我在往哪格落字」看得见——没有网格
  // 时画了字符也几乎察觉不到变化（字太小、又没有参照系）。
  const gridLines = useMemo(() => {
    // 容器还没布局时不画（fontSize 走默认档会闪一帧错误尺寸的网格）。
    if (available.width <= 0 || available.height <= 0) return null;
    if (canvasWidth <= 0 || canvasHeight <= 0) return null;
    const color = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.08)';
    const vertical = Array.from({ length: grid.cols + 1 }, (_, i) => (
      <Line
        key={`v${i}`}
        x1={i * cellWidth}
        y1={0}
        x2={i * cellWidth}
        y2={canvasHeight}
        stroke={color}
        strokeWidth={0.5}
      />
    ));
    const horizontal = Array.from({ length: grid.rows + 1 }, (_, i) => (
      <Line
        key={`h${i}`}
        x1={0}
        y1={i * lineHeight}
        x2={canvasWidth}
        y2={i * lineHeight}
        stroke={color}
        strokeWidth={0.5}
      />
    ));
    return (
      <Svg
        width={canvasWidth}
        height={canvasHeight}
        style={StyleSheet.absoluteFill}
        pointerEvents="none">
        {vertical}
        {horizontal}
      </Svg>
    );
  }, [available.height, available.width, cellWidth, canvasHeight, canvasWidth, grid.cols, grid.rows, isDark, lineHeight]);

  return (
    <View style={styles.container} onLayout={handleAvailableLayout} testID="ascii-canvas-frame">
      <View
        {...gesture.panHandlers}
        style={[styles.touchLayer, { width: canvasWidth, height: canvasHeight }]}
        testID="ascii-canvas">
        {gridLines}
        <Text
          testID="ascii-text"
          pointerEvents="none"
          style={{
            fontFamily: Platform.select({
              ios: 'Menlo',
              android: 'monospace',
              default: 'monospace',
            }),
            fontSize,
            lineHeight,
            color: isDark ? '#E5E7EB' : '#111827',
          }}>
          {toText(grid)}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  touchLayer: {
    // 尺寸由 style 内联给出（fontSize 推导），不依赖文本测量。
    overflow: 'hidden',
  },
});
