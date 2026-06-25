// Mirrors sessionStore.test.ts: stub the auth/account/transport deps so
// importing useSettingsStore (which wires the sessionAuth hub at module load)
// has no network/transport side effects.
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

import { refreshSessionTokens } from '../src/api/auth';
import { useSessionStore } from '../stores/useSettingsStore';

const refreshSessionTokensMock = refreshSessionTokens as jest.MockedFunction<
  typeof refreshSessionTokens
>;

describe('useSessionStore.refreshSession', () => {
  beforeEach(() => {
    refreshSessionTokensMock.mockReset();
    useSessionStore.setState({
      hasHydrated: true,
      user: { id: 'u1', email: 'u@e.com', name: 'U', role: 'operator' },
      // A stale access token present BEFORE refresh. The whole point of refresh
      // is to replace it; if the store kept this value, every post-refresh
      // request would reuse the dead token and 401 forever.
      token: 'access-stale',
      refreshToken: 'rt-old',
      operatorName: 'U',
      accountData: null,
    });
  });

  it('persists BOTH the fresh access token and the rotated refresh_token', async () => {
    // /api/auth/refresh returns a new 24h access JWT plus a rotated refresh_token.
    // Both must be persisted: keeping the stale access token strands the app on
    // the main screen after the old JWT expires (refresh looks "successful" but
    // the retry reuses the dead token → 401 → silent swallow → stuck on MainTabs).
    refreshSessionTokensMock.mockResolvedValue({
      token: 'access-new',
      refreshToken: 'rt-new',
    });

    const ok = await useSessionStore.getState().refreshSession();

    expect(ok).toBe(true);
    expect(refreshSessionTokensMock).toHaveBeenCalledWith('rt-old');
    expect(useSessionStore.getState().token).toBe('access-new');
    expect(useSessionStore.getState().refreshToken).toBe('rt-new');
  });

  it('returns false and keeps the old tokens when refresh throws', async () => {
    refreshSessionTokensMock.mockRejectedValue(new Error('stale refresh_token'));

    const ok = await useSessionStore.getState().refreshSession();

    expect(ok).toBe(false);
    expect(useSessionStore.getState().token).toBe('access-stale');
    expect(useSessionStore.getState().refreshToken).toBe('rt-old');
  });

  it('returns false and does not call the refresh endpoint when there is no refresh_token', async () => {
    useSessionStore.setState({ refreshToken: null });

    const ok = await useSessionStore.getState().refreshSession();

    expect(ok).toBe(false);
    expect(refreshSessionTokensMock).not.toHaveBeenCalled();
  });
});
