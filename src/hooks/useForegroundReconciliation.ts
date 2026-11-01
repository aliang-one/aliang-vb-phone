import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * useForegroundReconciliation — 前台恢复对账触发器。
 *
 * 修的洞(2026-11-01 TUI resume 接管 RCA):会话屏的水位对账入口此前只挂
 * navigation focus(useFocusEffect)——锁屏解锁/从后台切回时人停在会话屏,
 * navigation state 不变、focus 不重触发,WS 离线期间错过的内容(回答/
 * 审批卡)没有任何一次元数据对账去补,页面静默停在旧状态(server 日志里
 * 该会话零请求,本地缓存渲染到天荒地老)。
 *
 * 本 hook 监听 AppState 的 background→active 边沿(沿触发:挂载时已处于
 * active 不算"恢复";inactive→active 算,分屏/来电横幅场景同样需要),
 * 把回调交给调用方——通常注入 useSessionCatchUp().refreshLatestCount:
 * 轻量元数据对账,自带水位不等 early-return 与 10s 失败冷却,重复触发
 * 零成本 no-op。
 */
export function useForegroundReconciliation(onForeground: () => void): void {
  const callbackRef = useRef(onForeground);
  callbackRef.current = onForeground;
  const previousStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      const previous = previousStateRef.current;
      previousStateRef.current = state;
      if (state === 'active' && previous !== 'active') {
        callbackRef.current();
      }
    });
    return () => subscription.remove();
  }, []);
}
