/**
 * 检查更新的生命周期挂载(App 根,挂一次)。
 *
 * 时机:冷启延迟几秒(不与首屏渲染/snapshot 拉取抢资源)+ 前台恢复
 * (store 内 30 分钟节流)。桌面端 1h ticker 在 RN 后台不可用,移动端
 * 以「启动 + 回前台」为触发面。
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAppUpdateStore } from '../store/appUpdateStore';

const STARTUP_CHECK_DELAY_MS = 4000;

export function useAppUpdateLifecycle() {
  const checkNow = useAppUpdateStore(s => s.checkNow);
  const maybeCheckOnForeground = useAppUpdateStore(
    s => s.maybeCheckOnForeground,
  );
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const startupTimer = setTimeout(() => {
      void checkNow();
    }, STARTUP_CHECK_DELAY_MS);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        maybeCheckOnForeground();
      }
    });
    return () => {
      clearTimeout(startupTimer);
      subscription.remove();
      startedRef.current = false;
    };
  }, [checkNow, maybeCheckOnForeground]);
}
