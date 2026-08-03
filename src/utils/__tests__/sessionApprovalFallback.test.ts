import { fallbackApprovalStatus } from '../sessionApprovalFallback';

describe('fallbackApprovalStatus', () => {
  it('does not resurrect a waiting approval after the authoritative run completed', () => {
    expect(
      fallbackApprovalStatus('waiting', {
        status: 'completed',
        phase: 'completed',
        runState: 'completed',
        runStateVersion: 12,
      }),
    ).toBeUndefined();
  });

  it('keeps a waiting fallback while the authoritative run is awaiting approval', () => {
    expect(
      fallbackApprovalStatus('waiting', {
        status: 'completed',
        phase: 'waiting_approval',
        runState: 'waiting_approval',
        runStateVersion: 11,
      }),
    ).toBe('pending');
  });

  it.each(['cancelled', 'failed', 'timed_out'] as const)(
    'drops unresolved fallback events for terminal run_state=%s',
    runState => {
      expect(
        fallbackApprovalStatus('running', {
          status: runState === 'failed' ? 'failed' : 'completed',
          phase: runState === 'failed' || runState === 'timed_out'
            ? 'failed'
            : 'completed',
          runState,
          runStateVersion: 13,
        }),
      ).toBeUndefined();
    },
  );

  it('retains historical resolved approval events on terminal sessions', () => {
    const terminal = {
      status: 'completed' as const,
      phase: 'completed' as const,
      runState: 'completed' as const,
      runStateVersion: 14,
    };
    expect(fallbackApprovalStatus('done', terminal)).toBe('approved');
    expect(fallbackApprovalStatus('failed', terminal)).toBe('denied');
  });

  it('supports old server snapshots without run_state', () => {
    expect(
      fallbackApprovalStatus('waiting', {
        status: 'completed',
      }),
    ).toBeUndefined();
    expect(
      fallbackApprovalStatus('waiting', {
        status: 'idle',
        phase: 'waiting_approval',
      }),
    ).toBe('pending');
  });
});
