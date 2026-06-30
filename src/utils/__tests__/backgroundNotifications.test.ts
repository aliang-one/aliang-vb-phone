import { decideBackgroundNotifications } from '../backgroundNotifications';
import type { UnifiedEvent, ApprovalRequest } from '../../store/types';
import type { VibeCodingRun } from '../../data/platformModels';

const ev = (over: Partial<UnifiedEvent> & { id: string }): UnifiedEvent => ({
  type: 'approval.requested',
  title: 't',
  detail: 'd',
  status: 'info',
  timestamp: '2026-06-30T00:00:00Z',
  ...over,
});
// VibeCodingRun has many required fields the pure fn never reads; cast a partial.
const run = (over: Partial<VibeCodingRun> & { id: string }): VibeCodingRun =>
  ({
    title: 'S',
    deviceId: 'd',
    projectId: 'p',
    directory: '/',
    status: 'running',
    objective: '',
    model: '',
    ...over,
  }) as VibeCodingRun;
const approval = (over: Partial<ApprovalRequest> & { id: string }): ApprovalRequest => ({
  kind: 'file_write',
  title: '审批标题',
  summary: '摘要',
  deviceId: 'd',
  risk: 'medium',
  status: 'pending',
  createdAt: '',
  ...over,
});
const baseInput = {
  isBackground: true,
  events: [] as UnifiedEvent[],
  runs: [] as VibeCodingRun[],
  approvals: [] as ApprovalRequest[],
  baselineEventIds: new Set<string>(),
  runningAtBackground: new Set<string>(),
  alreadyNotified: new Set<string>(),
};

describe('decideBackgroundNotifications', () => {
  it('前台一律不弹', () => {
    const r = decideBackgroundNotifications({
      ...baseInput,
      isBackground: false,
      events: [ev({ id: 'e1', approvalId: 'a1' })],
    });
    expect(r.notifications).toHaveLength(0);
  });

  it('后台新增 approval(非基线)→ 弹一次,正文取 approvals 查得的 title', () => {
    const r = decideBackgroundNotifications({
      ...baseInput,
      events: [ev({ id: 'e1', approvalId: 'a1', sessionId: 's1' })],
      approvals: [approval({ id: 'a1', title: 'T', summary: 'Sum' })],
    });
    expect(r.notifications).toHaveLength(1);
    expect(r.notifications[0].title).toBe('需要审批');
    expect(r.notifications[0].body).toBe('T');
    expect(r.notifications[0].data).toEqual({
      type: 'approval',
      sessionId: 's1',
      approvalId: 'a1',
    });
    expect(r.notifiedKeys.has('approval:a1')).toBe(true);
  });

  it('基线里已有的 approval(切后台前就在)→ 不弹', () => {
    const r = decideBackgroundNotifications({
      ...baseInput,
      events: [ev({ id: 'e1', approvalId: 'a1' })],
      baselineEventIds: new Set(['e1']),
    });
    expect(r.notifications).toHaveLength(0);
  });

  it('同一 approval 第二次计算 → 去重,不重复弹', () => {
    const first = decideBackgroundNotifications({
      ...baseInput,
      events: [ev({ id: 'e1', approvalId: 'a1' })],
    });
    const second = decideBackgroundNotifications({
      ...baseInput,
      events: [ev({ id: 'e1', approvalId: 'a1' })],
      alreadyNotified: first.notifiedKeys,
    });
    expect(second.notifications).toHaveLength(0);
  });

  it('切后台时正在 running 的会话 → completed → 弹「会话已完成」', () => {
    const r = decideBackgroundNotifications({
      ...baseInput,
      runs: [run({ id: 's1', status: 'completed', title: 'MySession' })],
      runningAtBackground: new Set(['s1']),
    });
    expect(r.notifications).toHaveLength(1);
    expect(r.notifications[0].title).toBe('会话已完成');
    expect(r.notifications[0].data).toEqual({ type: 'session_done', sessionId: 's1' });
  });

  it('切后台时正在 running 的会话 → idle → 弹完成(idle 视为结算)', () => {
    const r = decideBackgroundNotifications({
      ...baseInput,
      runs: [run({ id: 's1', status: 'idle' })],
      runningAtBackground: new Set(['s1']),
    });
    expect(r.notifications[0].title).toBe('会话已完成');
  });

  it('切后台时正在 running 的会话 → failed → 弹「会话失败」', () => {
    const r = decideBackgroundNotifications({
      ...baseInput,
      runs: [run({ id: 's1', status: 'failed' })],
      runningAtBackground: new Set(['s1']),
    });
    expect(r.notifications[0].title).toBe('会话失败');
    expect(r.notifications[0].data.type).toBe('session_failed');
  });

  it('切后台时不在 running 的会话结算 → 不弹(避免噪音)', () => {
    const r = decideBackgroundNotifications({
      ...baseInput,
      runs: [run({ id: 's1', status: 'completed' })],
      runningAtBackground: new Set(), // s1 不在基线
    });
    expect(r.notifications).toHaveLength(0);
  });

  it('中途态(waiting_approval/testing/paused 等)→ 不弹完成', () => {
    const statuses = [
      'waiting_approval',
      'testing',
      'paused',
      'preview_ready',
      'waiting_user',
    ] as const;
    for (const status of statuses) {
      const r = decideBackgroundNotifications({
        ...baseInput,
        runs: [run({ id: 's1', status })],
        runningAtBackground: new Set(['s1']),
      });
      expect(r.notifications).toHaveLength(0);
    }
  });

  it('会话先 failed 再 completed → failed 与 done 各至多一次(去重)', () => {
    const r1 = decideBackgroundNotifications({
      ...baseInput,
      runs: [run({ id: 's1', status: 'failed' })],
      runningAtBackground: new Set(['s1']),
    });
    const r2 = decideBackgroundNotifications({
      ...baseInput,
      runs: [run({ id: 's1', status: 'completed' })],
      runningAtBackground: new Set(['s1']),
      alreadyNotified: r1.notifiedKeys,
    });
    expect(r1.notifications.map(n => n.title)).toEqual(['会话失败']);
    expect(r2.notifications.map(n => n.title)).toEqual(['会话已完成']);
  });
});
