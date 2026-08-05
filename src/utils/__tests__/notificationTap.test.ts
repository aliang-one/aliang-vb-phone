import {
  resolveApprovalAction,
  resolveNotificationTapTarget,
} from '../notificationTap';

describe('resolveNotificationTapTarget', () => {
  it('opens an approval in its session', () => {
    expect(
      resolveNotificationTapTarget({
        type: 'approval',
        sessionId: 's1',
        approvalId: 'a1',
      }),
    ).toEqual({
      route: 'VibeCodingSession',
      params: { sessionId: 's1', approvalId: 'a1' },
    });
  });

  it('opens a terminal session update without unrelated approval data', () => {
    expect(
      resolveNotificationTapTarget({
        type: 'session_done',
        sessionId: 's1',
        approvalId: 'a1',
      }),
    ).toEqual({
      route: 'VibeCodingSession',
      params: { sessionId: 's1', approvalId: undefined },
    });
  });

  it('opens an offline device directly', () => {
    expect(
      resolveNotificationTapTarget({
        type: 'device_offline',
        deviceId: 'd1',
      }),
    ).toEqual({ route: 'DeviceDetail', params: { deviceId: 'd1' } });
  });

  it('opens the notification center for a burst summary', () => {
    expect(resolveNotificationTapTarget({ type: 'summary' })).toEqual({
      route: 'NotificationCenter',
      params: undefined,
    });
  });

  it('rejects malformed or missing target IDs', () => {
    expect(
      resolveNotificationTapTarget({ type: 'approval', approvalId: 'a1' }),
    ).toBeNull();
    expect(
      resolveNotificationTapTarget({ type: 'device_offline', deviceId: ' ' }),
    ).toBeNull();
    expect(resolveNotificationTapTarget(null)).toBeNull();
  });
});

describe('resolveApprovalAction', () => {
  it('maps an approve action press to an approved decision', () => {
    expect(
      resolveApprovalAction(
        { type: 'approval', sessionId: 's1', approvalId: 'a1' },
        'approve',
      ),
    ).toEqual({ kind: 'approve', approvalId: 'a1' });
  });

  it('maps a deny action press to a denied decision', () => {
    expect(
      resolveApprovalAction(
        { type: 'approval', sessionId: 's1', approvalId: 'a1' },
        'deny',
      ),
    ).toEqual({ kind: 'deny', approvalId: 'a1' });
  });

  it('ignores action presses on non-approval notifications', () => {
    expect(
      resolveApprovalAction(
        { type: 'session_done', sessionId: 's1' },
        'approve',
      ),
    ).toBeNull();
  });

  it('ignores presses with no approval id', () => {
    expect(
      resolveApprovalAction({ type: 'approval', sessionId: 's1' }, 'approve'),
    ).toBeNull();
  });

  it('ignores unknown action ids and missing input', () => {
    expect(
      resolveApprovalAction(
        { type: 'approval', sessionId: 's1', approvalId: 'a1' },
        'snooze',
      ),
    ).toBeNull();
    expect(
      resolveApprovalAction(
        { type: 'approval', sessionId: 's1', approvalId: 'a1' },
        undefined,
      ),
    ).toBeNull();
    expect(resolveApprovalAction(null, 'approve')).toBeNull();
  });
});
