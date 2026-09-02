jest.mock('../src/api/auth', () => ({
  fetchCurrentUser: jest.fn(),
  login: jest.fn(),
  logout: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/api/account', () => ({
  fetchAccountPortalData: jest.fn(),
}));

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    closeTerminalSession: jest.fn().mockResolvedValue({}),
    createAiSession: jest.fn(),
    disconnect: jest.fn(),
  },
}));

import { logout as apiLogout } from '../src/api/auth';
import { platformTransport } from '../src/services/platformTransport';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { useSessionStore } from '../stores/useSettingsStore';

const closeTerminalSessionMock =
  platformTransport.closeTerminalSession as jest.Mock;
const apiLogoutMock = apiLogout as jest.Mock;

describe('useSessionStore logout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    closeTerminalSessionMock.mockResolvedValue({});
    apiLogoutMock.mockResolvedValue(undefined);
    useSessionStore.setState({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        role: 'operator',
      },
      token: 'token-1',
      operatorName: 'User',
      accountData: null,
    });
    useControlCenterStore.setState({
      terminalSessions: [
        terminal('term-running', 'running'),
        terminal('term-idle', 'idle'),
        terminal('term-approval', 'waiting_approval'),
        terminal('term-completed', 'completed'),
        terminal('term-failed', 'failed'),
        terminal('term-stopped', 'stopped'),
      ],
    });
  });

  it('best-effort closes active terminals before clearing the local session', async () => {
    await useSessionStore.getState().logout();

    expect(closeTerminalSessionMock.mock.calls.map(([id]) => id)).toEqual([
      'term-running',
      'term-idle',
      'term-approval',
    ]);
    expect(apiLogoutMock).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState()).toMatchObject({
      user: null,
      token: null,
      operatorName: 'Aliang',
      accountData: null,
    });
  });

  it('still logs out when terminal close requests fail', async () => {
    closeTerminalSessionMock.mockRejectedValue(new Error('network down'));

    await useSessionStore.getState().logout();

    expect(apiLogoutMock).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState()).toMatchObject({
      user: null,
      token: null,
      operatorName: 'Aliang',
      accountData: null,
    });
  });
});

describe('startAgentSession expose_preview_port payload', () => {
  const createAiSessionMock = platformTransport.createAiSession as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    createAiSessionMock.mockResolvedValue({
      session_id: 'sess-1',
      device_id: 'device-1',
      project_path: '/repo',
      status: 'running',
    });
    useControlCenterStore.setState({
      serverMode: true,
      devices: [],
      projects: [],
      vibeRuns: [],
      events: [],
    });
  });

  const baseInput = {
    deviceId: 'device-1',
    projectId: 'proj-1',
    directory: '/repo',
    provider: 'codex' as const,
    objective: 'first message',
  };

  it('forwards expose_preview_port true when the input flag is set', async () => {
    const sessionId = await useControlCenterStore
      .getState()
      .startAgentSession({ ...baseInput, exposePreviewPort: true });

    expect(sessionId).toBe('sess-1');
    expect(createAiSessionMock).toHaveBeenCalledTimes(1);
    expect(createAiSessionMock.mock.calls[0][0].expose_preview_port).toBe(true);
  });

  it('sends expose_preview_port false by default (flag omitted)', async () => {
    await useControlCenterStore.getState().startAgentSession(baseInput);

    expect(createAiSessionMock).toHaveBeenCalledTimes(1);
    expect(createAiSessionMock.mock.calls[0][0].expose_preview_port).toBe(false);
  });
});

function terminal(
  id: string,
  status: ReturnType<typeof useControlCenterStore.getState>['terminalSessions'][number]['status'],
) {
  return {
    id,
    deviceId: 'device-1',
    directory: '~/project',
    shell: 'zsh',
    status,
    lines: [],
    createdAt: '2026-06-17T10:00:00.000Z',
    updatedAt: '2026-06-17T10:00:00.000Z',
  };
}
