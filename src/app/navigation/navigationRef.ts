import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/**
 * 全局 navigation ref。供通知点击(在 React Navigation 上下文之外触发)跳转用:
 * notify-kit 的 tap 回调 / 冷启动 initial notification → navigationRef.navigate(...)。
 * 挂在 App.tsx 的 NavigationContainer 上。
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
