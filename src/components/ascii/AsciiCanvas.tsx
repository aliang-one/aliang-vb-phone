/**
 * ASCII 画布（Task 23）。
 *
 * 性能关键：整块网格渲染成**一个** `<Text>`。60×30 逐格一个节点是 1800 个
 * 视图，拖动时每帧重渲染会直接卡死；一个 Text 只是一次文本布局。
 *
 * 触摸映射：透明手势层包住文本，事件坐标是相对该视图的。格宽/格高取
 * **实测文本尺寸 ÷ 列/行数**，而不是假设字体度量——iOS Menlo 与 Android
 * monospace 的字符步进略有差异，用实测值才不会越画越偏。
 *
 * 字号按可用宽高自动收缩，保证 60×30 与 120×60 都能整幅落在屏幕内。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '../../theme/useTheme';
import type { AsciiGrid, Cell } from './asciiGrid';
import { toText } from './asciiGrid';

/** Menlo / Droid Sans Mono 的字符步进都是 0.6em。只用于预估字号，映射用实测。 */
const CELL_WIDTH_RATIO = 0.6;
const LINE_HEIGHT_RATIO = 1.35;
const MIN_FONT_SIZE = 5;
const MAX_FONT_SIZE = 14;
/** 左右各留一点余量，避免预估偏差把最后一列挤出屏幕。 */
const WIDTH_SAFETY = 8;

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
  const [measured, setMeasured] = useState({ width: 0, height: 0 });

  const fontSize = useMemo(() => {
    const byWidth =
      available.width > 0
        ? (available.width - WIDTH_SAFETY) / grid.cols / CELL_WIDTH_RATIO
        : MAX_FONT_SIZE;
    const byHeight =
      available.height > 0
        ? available.height / grid.rows / LINE_HEIGHT_RATIO
        : MAX_FONT_SIZE;
    const fit = Math.min(byWidth, byHeight);
    return Math.round(clamp(fit, MIN_FONT_SIZE, MAX_FONT_SIZE) * 10) / 10;
  }, [available.height, available.width, grid.cols, grid.rows]);

  const lineHeight = Math.round(fontSize * LINE_HEIGHT_RATIO);

  const cellWidth =
    measured.width > 0 ? measured.width / grid.cols : fontSize * CELL_WIDTH_RATIO;
  const cellHeight = measured.height > 0 ? measured.height / grid.rows : lineHeight;

  // 手势对象只创建一次（否则每次渲染都换手势，拖动会中断）；映射参数与
  // 回调都走 ref，保证读到的是最新值。
  const mappingRef = useRef({ cellWidth, cellHeight, cols: grid.cols, rows: grid.rows });
  mappingRef.current = {
    cellWidth,
    cellHeight,
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

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .runOnJS(true)
        .onBegin(event => {
          const cell = toCell(event.x, event.y);
          activeRef.current = true;
          lastCellRef.current = cell;
          handlersRef.current.onStrokeStart(cell);
        })
        .onUpdate(event => {
          if (!activeRef.current) return;
          const cell = toCell(event.x, event.y);
          lastCellRef.current = cell;
          handlersRef.current.onStrokeMove(cell);
        })
        .onEnd(event => {
          if (!activeRef.current) return;
          activeRef.current = false;
          handlersRef.current.onStrokeEnd(toCell(event.x, event.y));
        })
        // 手势被系统取消时 onEnd 不会触发；finalize 兜底提交，避免「画到
        // 一半来电」留下一个永远不结束的进行中笔迹。
        .onFinalize(() => {
          if (!activeRef.current) return;
          activeRef.current = false;
          const last = lastCellRef.current;
          if (last) handlersRef.current.onStrokeEnd(last);
        }),
    [toCell],
  );

  const handleAvailableLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setAvailable({ width, height });
  }, []);

  const handleTextLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setMeasured({ width, height });
  }, []);

  return (
    <View style={styles.container} onLayout={handleAvailableLayout}>
      <GestureDetector gesture={gesture}>
        <View
          testID="ascii-canvas"
          onLayout={handleTextLayout}
          style={styles.touchLayer}>
          <Text
            testID="ascii-text"
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
      </GestureDetector>
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
    alignSelf: 'flex-start',
  },
});
