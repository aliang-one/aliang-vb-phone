import { resolveNotificationTapTarget } from '../notificationTap';

describe('resolveNotificationTapTarget', () => {
  it('approval → VibeCodingSession 带 sessionId + approvalId', () => {
    const t = resolveNotificationTapTarget({
      type: 'approval',
      sessionId: 's1',
      approvalId: 'a1',
    });
    expect(t).toEqual({
      route: 'VibeCodingSession',
      params: { sessionId: 's1', approvalId: 'a1' },
    });
  });

  it('session_done → 只带 sessionId(approvalId 不带)', () => {
    const t = resolveNotificationTapTarget({ type: 'session_done', sessionId: 's1' });
    expect(t?.route).toBe('VibeCodingSession');
    expect(t?.params.sessionId).toBe('s1');
    expect(t?.params.approvalId).toBeUndefined();
  });

  it('缺 sessionId → null(无处可跳)', () => {
    expect(
      resolveNotificationTapTarget({ type: 'approval', approvalId: 'a1' }),
    ).toBeNull();
  });

  it('null/undefined → null', () => {
    expect(resolveNotificationTapTarget(null)).toBeNull();
    expect(resolveNotificationTapTarget(undefined)).toBeNull();
  });

  it('非 approval 类型即使带 approvalId 也不带', () => {
    const t = resolveNotificationTapTarget({
      type: 'session_failed',
      sessionId: 's1',
      approvalId: 'a1',
    });
    expect(t?.params.approvalId).toBeUndefined();
  });
});
