import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the user has enabled "Reduce Motion"
 * (iOS: 设置 → 辅助功能 → 动态效果 / Android: 开发者选项 → 绘图 → 动画缩放=关)。
 *
 * 应用内的呼吸/脉冲动画(如 VibeSessionCard 运行态左侧色条、StatusChip 运行态圆点)
 * 必须以此为闸:开启时退回静态表现。运行态仍由文案(进行中)+ 图标 + 色相传达,
 * 绝不只靠动效(「颜色/动效不能是唯一指示」——无障碍原则)。
 *
 * **模块级单例缓存**:本 hook 被共享组件(StatusChip)在多处使用,若每个实例各自
 * 调 AccessibilityInfo 会造成 N 次原生调用。故模块级只查一次 + 单订阅,所有 hook
 * 实例共享同一缓存值并注册到 listener set,值变化时一起更新。未取到值前默认 false。
 */
let cachedReduceMotion: boolean | null = null;
const listeners = new Set<(value: boolean) => void>();
let initialized = false;

function applyReduceMotion(value: boolean): void {
  if (cachedReduceMotion === value) return;
  cachedReduceMotion = value;
  listeners.forEach(listener => listener(value));
}

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  AccessibilityInfo.isReduceMotionEnabled().then(applyReduceMotion);
  AccessibilityInfo.addEventListener(
    'reduceMotionChanged',
    applyReduceMotion,
  );
}

export function useReduceMotion(): boolean {
  ensureInit();
  const [reduce, setReduce] = useState<boolean>(cachedReduceMotion ?? false);

  useEffect(() => {
    //挂载时同步一次当前缓存值(可能在组件 mount 前就已 resolve)
    setReduce(cachedReduceMotion ?? false);
    listeners.add(setReduce);
    return () => {
      listeners.delete(setReduce);
    };
  }, []);

  return reduce;
}
