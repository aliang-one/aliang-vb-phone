import type { ApprovalRequest, UnifiedEvent } from '../store/types';
import type { VibeCodingRun } from '../data/platformModels';
import i18n from '../i18n';

/**
 * 后台本地通知的**纯判定逻辑**(无 React、无原生、无副作用)。
 *
 * 给定 store 快照 + 后台基线 + 已通知集,算出"该弹哪些通知"及更新后的去重集。
 * 抽成纯函数是为了沿用本仓纯逻辑测试范式(见 sessionPhase.test.ts);React hook
 * (`useBackgroundNotifications`)只做 AppState/订阅接线,把快照喂进来。
 *
 * 触发口径(与 spec 一致):
 *  - 新 `approval.requested` 事件(切后台后新到的、且本次后台窗口未通知过)。
 *  - 切后台那一刻处于 `running` 的会话,如今到达终态:
 *      `failed`        → 会话失败
 *      `idle`/`completed` → 会话已完成(球回用户 / 会话关闭)
 *    其它非 running 态(waiting_approval / testing / paused / preview_ready / waiting_user)
 *    是中途态,不通知(审批走 approval 路径单独通知)。
 *  - 仅当 `isBackground`(app 在后台)才弹;前台交给现有 in-app NotificationCenter。
 */

export type BackgroundNotificationType =
  | 'approval'
  | 'session_done'
  | 'session_failed';

export interface PendingLocalNotification {
  /** 去重键,形如 `approval:<id>` / `session:<id>:done` / `session:<id>:failed`。 */
  key: string;
  title: string;
  body: string;
  data: {
    type: BackgroundNotificationType;
    sessionId?: string;
    approvalId?: string;
  };
}

export interface BackgroundNotifyInput {
  /** 仅当 app 在后台才弹。 */
  isBackground: boolean;
  events: UnifiedEvent[];
  runs: VibeCodingRun[];
  approvals: ApprovalRequest[];
  /** 切后台那一刻已存在的 approval.requested 事件 id(不重复通知历史)。 */
  baselineEventIds: Set<string>;
  /** 切后台那一刻处于 running 的会话 id(只有这些结算才通知)。 */
  runningAtBackground: Set<string>;
  /** 本次后台窗口已通知的去重键。 */
  alreadyNotified: Set<string>;
}

export interface BackgroundNotifyResult {
  notifications: PendingLocalNotification[];
  /** 更新后的去重集(原集合 ∪ 本次发出的 key)。 */
  notifiedKeys: Set<string>;
}

/** 真正"回合结束"的终态:idle(球回用户)/ completed(关闭)。 */
const DONE_STATUSES: ReadonlySet<string> = new Set(['idle', 'completed']);

export function decideBackgroundNotifications(
  input: BackgroundNotifyInput,
): BackgroundNotifyResult {
  const notifications: PendingLocalNotification[] = [];
  const notified = new Set(input.alreadyNotified);

  if (!input.isBackground) {
    return { notifications, notifiedKeys: notified };
  }

  // 1) 新 approval.requested(非基线、未通知)。
  for (const event of input.events) {
    if (event.type !== 'approval.requested') continue;
    if (!event.approvalId) continue;
    if (input.baselineEventIds.has(event.id)) continue;
    const key = `approval:${event.approvalId}`;
    if (notified.has(key)) continue;
    const found = input.approvals.find(a => a.id === event.approvalId);
    const body =
      found?.title || found?.summary || event.title || event.detail || i18n.t('common:notification.approvalBodyFallback');
    notifications.push({
      key,
      title: i18n.t('common:notification.approvalTitle'),
      body,
      data: {
        type: 'approval',
        sessionId: event.sessionId,
        approvalId: event.approvalId,
      },
    });
    notified.add(key);
  }

  // 2) 切后台时正在跑的会话,如今结算 / 失败。
  for (const r of input.runs) {
    if (!input.runningAtBackground.has(r.id)) continue;
    if (r.status === 'failed') {
      const key = `session:${r.id}:failed`;
      if (!notified.has(key)) {
        notifications.push({
          key,
          title: i18n.t('common:notification.sessionFailedTitle'),
          body: r.title || i18n.t('common:notification.sessionFailedBodyFallback'),
          data: { type: 'session_failed', sessionId: r.id },
        });
        notified.add(key);
      }
    } else if (DONE_STATUSES.has(r.status)) {
      const key = `session:${r.id}:done`;
      if (!notified.has(key)) {
        notifications.push({
          key,
          title: i18n.t('common:notification.sessionDoneTitle'),
          body: r.title || i18n.t('common:notification.sessionDoneBodyFallback'),
          data: { type: 'session_done', sessionId: r.id },
        });
        notified.add(key);
      }
    }
    // waiting_approval / testing / paused / preview_ready / waiting_user / running
    // → 中途态或仍在跑,不通知。
  }

  return { notifications, notifiedKeys: notified };
}
