// Mirrors sessionStore.test.ts: stub the auth/account/transport deps so
// importing useSettingsStore (which wires the sessionAuth hub at module load)
// has no network/transport side effects.
jest.mock('../src/api/auth', () => ({
  fetchCurrentUser: jest.fn(),
  login: jest.fn(),
  logout: jest.fn().mockResolvedValue(undefined),
  refreshAuthToken: jest.fn(),
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

import { refreshAuthToken } from '../src/api/auth';
import { useSessionStore } from '../stores/useSettingsStore';

const refreshAuthTokenMock = refreshAuthToken as jest.MockedFunction<
  typeof refreshAuthToken
>;

describe('useSessionStore.refreshSession', () => {
  beforeEach(() => {
    refreshAuthTokenMock.mockReset();
    useSessionStore.setState({
      hasHydrated: true,
      user: { id: 'u1', email: 'u@e.com', name: 'U', role: 'operator' },
      token: 'session-token', // local session token — stable across refresh
      refreshToken: 'rt-old',
      operatorName: 'U',
      accountData: null,
    });
  });

  it('rotates the refresh_token and leaves the access/session token unchanged', async () => {
    refreshAuthTokenMock.mockResolvedValue('rt-new');

    const ok = await useSessionStore.getState().refreshSession();

    expect(ok).toBe(true);
    expect(refreshAuthTokenMock).toHaveBeenCalledWith('rt-old');
    expect(useSessionStore.getState().refreshToken).toBe('rt-new');
    expect(useSessionStore.getState().token).toBe('session-token');
  });

  it('returns false and keeps the old refresh_token when refresh throws', async () => {
    refreshAuthTokenMock.mockRejectedValue(new Error('stale refresh_token'));

    const ok = await useSessionStore.getState().refreshSession();

    expect(ok).toBe(false);
    expect(useSessionStore.getState().refreshToken).toBe('rt-old');
  });

  it('returns false and does not call the refresh endpoint when there is no refresh_token', async () => {
    useSessionStore.setState({ refreshToken: null });

    const ok = await useSessionStore.getState().refreshSession();

    expect(ok).toBe(false);
    expect(refreshAuthTokenMock).not.toHaveBeenCalled();
  });
});
