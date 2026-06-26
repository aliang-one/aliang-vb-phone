// Recovery for the "approval.requested one-shot push got dropped" gap.
//
// When the agent offers a plan, the server derives an approval, sets the
// session to `paused`, and publishes `ai.session.updated`(paused) +
// `approval.requested` + `notification.created`. The approval push is one-shot
// (no retry-until-ack); if the WS blips, it's gone. The existing self-heal
// (`ai.done` / `ai.sessions.updated` → debounced refresh) does NOT fire here,
// because a turn paused for approval never emits `ai.done`. So the user only
// sees the approval after a manual re-entry.
//
// Fix: treat the running→paused EDGE on `ai.session.updated` as the recovery
// signal — re-fetch the dashboard so pending_approvals repopulate. These tests
// pin both the pure edge predicate and the wired-in behaviour.

jest.mock('../src/api/auth', () => ({
  fetchCurrentUser: jest.fn(),
  login: jest.fn(),
  logout: jest.fn().mockResolvedValue(undefined),
  refreshSessionTokens: jest.fn(),
}));

jest.mock('../src/api/account', () => ({
  fetchAccountPortalData: jest.fn(),
}));

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    closeTerminalSession: jest.fn().mockResolvedValue({}),
    disconnect: jest.fn(),
  },
}));

import {
  isWaitingApprovalStatus,
  enteredWaitingApproval,
} from '../src/store/internals';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { cancelRefreshDebounce } from '../src/store/streaming';
import type { PlatformTransportEvent } from '../src/services/platformTransport';
import type { VibeCodingRun, VibeStatus } from '../src/data/platformModels';

describe('isWaitingApprovalStatus', () => {
  it('matches only the waiting-on-user statuses', () => {
    expect(isWaitingApprovalStatus('paused')).toBe(true);
    expect(isWaitingApprovalStatus('waiting_approval')).toBe(true);
    expect(isWaitingApprovalStatus('waiting_user')).toBe(false);
    expect(isWaitingApprovalStatus('running')).toBe(false);
    expect(isWaitingApprovalStatus('idle')).toBe(false);
    expect(isWaitingApprovalStatus(undefined)).toBe(false);
  });
});

describe('enteredWaitingApproval', () => {
  it('fires only on the non-waiting → waiting edge', () => {
    // entering waiting
    expect(enteredWaitingApproval('running', 'paused')).toBe(true);
    expect(enteredWaitingApproval('idle', 'waiting_approval')).toBe(true);
    expect(enteredWaitingApproval(undefined, 'paused')).toBe(true);

    // already waiting (level, not edge) → must NOT re-fire
    expect(enteredWaitingApproval('paused', 'paused')).toBe(false);
    expect(enteredWaitingApproval('waiting_approval', 'paused')).toBe(false);

    // leaving waiting → not a recovery signal
    expect(enteredWaitingApproval('paused', 'running')).toBe(false);

    // normal activity (thinking / tool use) → must stay silent
    expect(enteredWaitingApproval('running', 'running')).toBe(false);
    expect(enteredWaitingApproval('idle', 'running')).toBe(false);
  });
});

describe('ai.session.updated approval recovery', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    cancelRefreshDebounce();
    useControlCenterStore.setState({
      serverMode: true,
      vibeRuns: [run('s1', 'running')],
      devices: [],
      projects: [],
      approvals: [],
      notifications: [],
      events: [],
    });
  });

  afterEach(() => {
    cancelRefreshDebounce();
    jest.useRealTimers();
  });

  it('recovers a missed approval by refreshing when a session enters paused', () => {
    const refreshSpy = jest
      .spyOn(useControlCenterStore.getState(), 'refreshFromServer')
      .mockResolvedValue();

    useControlCenterStore.getState().handleTransportEvent(
      sessionUpdated('s1', 'paused'),
    );

    // Debounced: not yet fired inside the window.
    expect(refreshSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(250);
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    refreshSpy.mockRestore();
  });

  it('does NOT refresh when the session was already waiting (no edge)', () => {
    useControlCenterStore.setState({ vibeRuns: [run('s1', 'paused')] });
    const refreshSpy = jest
      .spyOn(useControlCenterStore.getState(), 'refreshFromServer')
      .mockResolvedValue();

    useControlCenterStore.getState().handleTransportEvent(
      sessionUpdated('s1', 'paused'),
    );
    jest.advanceTimersByTime(250);

    expect(refreshSpy).not.toHaveBeenCalled();
    refreshSpy.mockRestore();
  });

  it('does NOT refresh on running → running (thinking / tool use gap)', () => {
    const refreshSpy = jest
      .spyOn(useControlCenterStore.getState(), 'refreshFromServer')
      .mockResolvedValue();

    useControlCenterStore.getState().handleTransportEvent(
      sessionUpdated('s1', 'running'),
    );
    jest.advanceTimersByTime(250);

    expect(refreshSpy).not.toHaveBeenCalled();
    refreshSpy.mockRestore();
  });

  it('does NOT refresh when not in server mode (draft / offline)', () => {
    useControlCenterStore.setState({ serverMode: false });
    const refreshSpy = jest
      .spyOn(useControlCenterStore.getState(), 'refreshFromServer')
      .mockResolvedValue();

    useControlCenterStore.getState().handleTransportEvent(
      sessionUpdated('s1', 'paused'),
    );
    jest.advanceTimersByTime(250);

    expect(refreshSpy).not.toHaveBeenCalled();
    refreshSpy.mockRestore();
  });
});

function run(id: string, status: VibeStatus): VibeCodingRun {
  return {
    id,
    title: 'Session',
    deviceId: 'd1',
    projectId: '',
    directory: '/p',
    status,
    objective: '',
    model: '',
    provider: 'claude_code',
    risk: 'medium',
    currentStep: '',
    branch: '',
    updatedAt: '',
    lastActivityMs: 0,
    suggestions: [],
    transcript: [],
    events: [],
    structuredEvents: [],
  } as VibeCodingRun;
}

function sessionUpdated(id: string, status: string): PlatformTransportEvent {
  return {
    type: 'ai.session.updated',
    session: {
      session_id: id,
      status,
      device_id: 'd1',
      user_id: 'u1',
      project_path: '/p',
      title: 'Session',
      objective: '',
      mode: 'vibe',
      tool: 'claude',
      provider: 'claude_code',
      model: '',
      effort: '',
      risk: 'medium',
      current_step: '',
      branch: '',
      last_active_at: '2026-06-26T10:00:00.000Z',
      created_at: '2026-06-26T10:00:00.000Z',
      transcript: [],
      events: [],
    },
    raw: {},
  } as unknown as PlatformTransportEvent;
}
