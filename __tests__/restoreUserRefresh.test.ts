/**
 * Regression: login expired after ~24h (the access-JWT TTL).
 *
 * `restoreUser` runs on every app launch. It used to check the access JWT's
 * `exp` locally and, when expired, tear the session down IMMEDIATELY — without
 * ever trying the refresh_token. So a user who was idle for a day came back to
 * a forced re-login, even though a valid refresh_token could have rotated the
 * access token. The reactive 401→refresh path only helps while the app is
 * actively making requests; the launch pre-check short-circuited it.
 *
 * Fix: when the access JWT is locally expired AND a refresh_token is present,
 * attempt `refreshSession()` first. Only tear down if the refresh itself fails
 * or there is no refresh_token.
 */
import { useSessionStore } from '../stores/useSettingsStore';
import {
  setSessionInvalidationHandler,
  __resetSessionAuthHubForTest,
} from '../src/api/sessionAuth';

jest.mock('../src/api/auth', () => ({
  fetchCurrentUser: jest.fn(),
  refreshSessionTokens: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
}));
jest.mock('../src/api/account', () => ({
  fetchAccountPortalData: jest.fn(),
}));
jest.mock('../src/services/platformTransport', () => ({
  platformTransport: { closeTerminalSession: jest.fn() },
}));
jest.mock('../src/store/controlCenterStore', () => ({
  useControlCenterStore: { getState: () => ({ terminalSessions: [] }) },
}));

import { fetchCurrentUser, refreshSessionTokens } from '../src/api/auth';
import { fetchAccountPortalData } from '../src/api/account';

// Real (unsigned) JWTs carrying only an `exp` claim, so the production
// decodeJwtExp / isJwtExpired helpers exercise the same path. Payloads are the
// base64url of {"exp":<n>}, precomputed to avoid a Node `Buffer` dependency.
//   exp 1577836800 = 2020-01-01 (past) ; exp 9999999999 = year 2286 (future)
const EXPIRED_JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE1Nzc4MzY4MDB9.sig';
const FRESH_JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjk5OTk5OTk5OTl9.sig';

describe('restoreUser: refresh before teardown on expired access JWT', () => {
  beforeEach(() => {
    __resetSessionAuthHubForTest();
    setSessionInvalidationHandler(() => {});
    (refreshSessionTokens as jest.Mock).mockReset();
    (fetchCurrentUser as jest.Mock).mockReset();
    (fetchAccountPortalData as jest.Mock).mockReset();
    (fetchAccountPortalData as jest.Mock).mockResolvedValue(undefined);
  });

  it('rotates the access token via refresh_token instead of tearing down', async () => {
    (refreshSessionTokens as jest.Mock).mockResolvedValue({
      token: FRESH_JWT,
      refreshToken: 'rt-new',
    });
    (fetchCurrentUser as jest.Mock).mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'A',
    });

    useSessionStore.setState({
      token: EXPIRED_JWT,
      refreshToken: 'rt-old',
      user: null,
      accountData: null,
    });

    const invalidationSpy = jest.fn();
    setSessionInvalidationHandler(invalidationSpy);

    await expect(
      useSessionStore.getState().restoreUser(),
    ).resolves.toBeUndefined();

    expect(refreshSessionTokens).toHaveBeenCalledWith('rt-old');
    expect(invalidationSpy).not.toHaveBeenCalled();
    // Fresh access token persisted and user loaded with it.
    expect(useSessionStore.getState().token).toBe(FRESH_JWT);
    expect(useSessionStore.getState().refreshToken).toBe('rt-new');
    expect(useSessionStore.getState().user?.id).toBe('u1');
  });

  it('tears down when the refresh itself fails (refresh_token also stale)', async () => {
    (refreshSessionTokens as jest.Mock).mockRejectedValue(new Error('stale'));

    useSessionStore.setState({
      token: EXPIRED_JWT,
      refreshToken: 'rt-old',
      user: null,
      accountData: null,
    });
    const invalidationSpy = jest.fn();
    setSessionInvalidationHandler(invalidationSpy);

    await expect(
      useSessionStore.getState().restoreUser(),
    ).rejects.toThrow(/过期|expired/i);
    expect(invalidationSpy).toHaveBeenCalled();
  });

  it('tears down without calling refresh when there is no refresh_token (legacy)', async () => {
    useSessionStore.setState({
      token: EXPIRED_JWT,
      refreshToken: null,
      user: null,
      accountData: null,
    });
    const invalidationSpy = jest.fn();
    setSessionInvalidationHandler(invalidationSpy);

    await expect(
      useSessionStore.getState().restoreUser(),
    ).rejects.toThrow(/过期|expired/i);
    expect(invalidationSpy).toHaveBeenCalled();
    expect(refreshSessionTokens).not.toHaveBeenCalled();
  });

  it('does not refresh when the access JWT is still valid', async () => {
    (fetchCurrentUser as jest.Mock).mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'A',
    });
    useSessionStore.setState({
      token: FRESH_JWT,
      refreshToken: 'rt-old',
      user: null,
      accountData: null,
    });

    await useSessionStore.getState().restoreUser();

    expect(refreshSessionTokens).not.toHaveBeenCalled();
    expect(fetchCurrentUser).toHaveBeenCalled();
  });
});
