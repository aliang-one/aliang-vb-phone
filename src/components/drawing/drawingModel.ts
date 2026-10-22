/**
 * 手绘笔迹模型（Task 20）。
 *
 * 纯函数 + 一个薄 hook：所有状态迁移都能在测试里直接断言，画布组件只负责
 * 把手指坐标喂进来。三条不变量：
 *   - **一次手势 = 一条 Stroke**，渲染成一条 `<Path>`（不是每个点一条线）；
 *   - **抽稀**：与上一点距离 < 2px 的点直接丢弃——手指静止时 Pan 仍会持续
 *     派发 update，不抽稀的话一笔能攒出上千个点，Path 字符串越来越长、
 *     每帧重渲染越来越慢；
 *   - **新笔迹清空重做栈**：撤销之后又画了新东西，旧的「重做」分支就作废了，
 *     这是所有绘图工具的共同语义。
 *
 * 橡皮就是白色画笔：画布背景强制 `#FFFFFF`，白色笔迹盖上去视觉上就是擦除。
 * 比真正的「擦除路径求差」简单一个数量级，导出结果也一致。
 */
import { useCallback, useState } from 'react';

export interface DrawingPoint {
  x: number;
  y: number;
}

export interface DrawingStroke {
  id: string;
  color: string;
  width: number;
  points: DrawingPoint[];
}

export interface DrawingState {
  strokes: DrawingStroke[];
  /** 已撤销、可重做的笔迹（栈顶是最后撤销的那条）。 */
  redoStack: DrawingStroke[];
}

/** 抽稀阈值（逻辑像素）。低于它的位移视为手指抖动。 */
export const MIN_POINT_DISTANCE = 2;

/** 画布背景必须是白色：深色底导出会显著降低模型的识别率。 */
export const CANVAS_BACKGROUND = '#FFFFFF';

/** 常用笔色。第一个是默认色，导出到白底上对比度最高。 */
export const DRAWING_COLORS = ['#111827', '#EF4444', '#2563EB', '#16A34A', '#F59E0B'];

/** 细 / 中 / 粗。 */
export const DRAWING_WIDTHS = [2, 4, 8];

export const initialDrawingState: DrawingState = { strokes: [], redoStack: [] };

let strokeSeq = 0;

/** 笔迹 id 只在本机画布内唯一即可，不进任何持久化结构。 */
export function newStrokeId(): string {
  strokeSeq += 1;
  return `stroke-${Date.now().toString(36)}-${strokeSeq}`;
}

/**
 * 追加一个点；与上一点太近则原样返回同一个数组（引用不变）。
 * 引用不变让 `extendStroke` 能识别「这一下没变化」，跳过整棵树的更新。
 */
export function pushPoint(
  points: DrawingPoint[],
  point: DrawingPoint,
): DrawingPoint[] {
  const last = points[points.length - 1];
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < MIN_POINT_DISTANCE) {
    return points;
  }
  return [...points, point];
}

const formatCoord = (value: number) => Math.round(value * 100) / 100;

/**
 * 点列 → SVG path。单点也输出成零长度线段（`M x y L x y`）：配合
 * `strokeLinecap="round"` 会画出一个圆点，点一下画布能留下痕迹。
 */
export function toPathD(points: DrawingPoint[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  const head = `M ${formatCoord(first.x)} ${formatCoord(first.y)}`;
  if (rest.length === 0) {
    return `${head} L ${formatCoord(first.x)} ${formatCoord(first.y)}`;
  }
  return rest.reduce(
    (path, point) => `${path} L ${formatCoord(point.x)} ${formatCoord(point.y)}`,
    head,
  );
}

export function beginStroke(state: DrawingState, stroke: DrawingStroke): DrawingState {
  return { strokes: [...state.strokes, stroke], redoStack: [] };
}

export function extendStroke(
  state: DrawingState,
  strokeId: string,
  point: DrawingPoint,
): DrawingState {
  const index = state.strokes.findIndex(stroke => stroke.id === strokeId);
  if (index === -1) return state;
  const stroke = state.strokes[index];
  const points = pushPoint(stroke.points, point);
  if (points === stroke.points) return state;
  const strokes = state.strokes.slice();
  strokes[index] = { ...stroke, points };
  return { ...state, strokes };
}

export function undoStroke(state: DrawingState): DrawingState {
  if (state.strokes.length === 0) return state;
  const last = state.strokes[state.strokes.length - 1];
  return {
    strokes: state.strokes.slice(0, -1),
    redoStack: [...state.redoStack, last],
  };
}

export function redoStroke(state: DrawingState): DrawingState {
  if (state.redoStack.length === 0) return state;
  const last = state.redoStack[state.redoStack.length - 1];
  return {
    strokes: [...state.strokes, last],
    redoStack: state.redoStack.slice(0, -1),
  };
}

export function clearStrokes(state: DrawingState): DrawingState {
  if (state.strokes.length === 0 && state.redoStack.length === 0) return state;
  return initialDrawingState;
}

/**
 * 画布状态容器。DrawingScreen 持有它，画布与工具栏各拿一半：
 * 画布 `begin/extend`，工具栏 `undo/redo/clearAll`，导出时读 `strokes`。
 */
export function useDrawingState() {
  const [state, setState] = useState<DrawingState>(initialDrawingState);

  const begin = useCallback((stroke: DrawingStroke) => {
    setState(current => beginStroke(current, stroke));
  }, []);
  const extend = useCallback((strokeId: string, point: DrawingPoint) => {
    setState(current => extendStroke(current, strokeId, point));
  }, []);
  const undo = useCallback(() => setState(undoStroke), []);
  const redo = useCallback(() => setState(redoStroke), []);
  const clearAll = useCallback(() => setState(clearStrokes), []);

  return {
    strokes: state.strokes,
    canUndo: state.strokes.length > 0,
    canRedo: state.redoStack.length > 0,
    begin,
    extend,
    undo,
    redo,
    clearAll,
  };
}
