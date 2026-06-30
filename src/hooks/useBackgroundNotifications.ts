import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useControlCenterStore } from '../store/controlCenterStore';
import { decideBackgroundNotifications } from '../utils/backgroundNotifications';
import { displayNotification, requestPermission } from '../services/localNotifications';

/**
 * 后台本地通知(仅 Android 有效;iOS / 未 rebuild 降级 no-op)。
 *
 * 切后台时快照「基线」(当时已存在的 approval.requested 事件 id + 当时 running 的会话 id);
 * 后台期间 store 每次变更 → 喂纯函数 decideBackgroundNotifications → 弹新通知。
 * 回前台清空基线与已通知集,为下一次后台准备。
 *
 * 判定逻辑(触发口径 / 去重 / 前台抑制)全在 utils/backgroundNotifications(已单测);
 * 本 hook 只做 AppState + store 订阅的接线。
 */
export function useBackgroundNotifications(): void {
  const isBackgroundRef = useRef<boolean>(false);
  const baselineEventIdsRef = useRef<Set<string>>(new Set());
  const runningAtBackgroundRef = useRef<Set<string>>(new Set());
  const alreadyNotifiedRef = useRef<Set<string>>(new Set());

  // store 变更 → 判定 → 弹通知(仅后台生效)。
  useEffect(() => {
    const check = () => {
      if (!isBackgroundRef.current) return;
      const state = useControlCenterStore.getState();
      const result = decideBackgroundNotifications({
        isBackground: true,
        events: state.events,
        runs: state.vibeRuns,
        approvals: state.approvals,
        baselineEventIds: baselineEventIdsRef.current,
        runningAtBackground: runningAtBackgroundRef.current,
        alreadyNotified: alreadyNotifiedRef.current,
      });
      alreadyNotifiedRef.current = result.notifiedKeys;
      for (const n of result.notifications) {
        void displayNotification({
          title: n.title,
          body: n.body,
          // data 值须为 string(notify-kit / Android Bundle 对齐)。
          data: {
            type: n.data.type,
            sessionId: n.data.sessionId ?? '',
            approvalId: n.data.approvalId ?? '',
          },
        });
      }
    };
    return useControlCenterStore.subscribe(check);
  }, []);

  // AppState 布防 / 撤防 + 首次权限申请。
  useEffect(() => {
    const snapshot = () => {
      const state = useControlCenterStore.getState();
      baselineEventIdsRef.current = new Set(
        state.events.filter(e => e.type === 'approval.requested').map(e => e.id),
      );
      runningAtBackgroundRef.current = new Set(
        state.vibeRuns.filter(r => r.status === 'running').map(r => r.id),
      );
      alreadyNotifiedRef.current = new Set();
    };
    const onChange = (next: AppStateStatus) => {
      const goingBackground = next !== 'active';
      if (goingBackground && !isBackgroundRef.current) {
        snapshot(); // 记基线
        isBackgroundRef.current = true;
      } else if (!goingBackground && isBackgroundRef.current) {
        isBackgroundRef.current = false;
        snapshot(); // 清空,为下次后台准备
      }
    };
    const subscription = AppState.addEventListener('change', onChange);
    // 冷启动可能直接落在后台态
    isBackgroundRef.current = AppState.currentState !== 'active';
    if (isBackgroundRef.current) snapshot();
    void requestPermission(); // Android 13+ POST_NOTIFICATIONS(ios/未rebuild → no-op)
    return () => subscription.remove();
  }, []);
}
