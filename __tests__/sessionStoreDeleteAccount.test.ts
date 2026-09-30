// Unit tests for useSessionStore.deleteAccount (Apple 5.1.1(v)).
//
// Contract: the server call runs FIRST — a failure (wrong password / network)
// rethrows and leaves the local session untouched. On success the session is
// wiped exactly like logout, PLUS the saved keychain credentials (the account
// is gone — there is nothing left to log back into), and the token clear is
// what flips RootNavigator to Login.
jest.mock('../src/api/auth', () => ({
  fetchCurrentUser: jest.fn(),
  refreshSessionTokens: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  deleteAccount: jest.fn(),
}));
jest.mock('../src/api/account', () => ({ fetchAccountPortalData: jest.fn() }));
jest.mock('../src/services/platformTransport', () => ({
  platformTransport: { closeTerminalSession: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../src/store/controlCenterStore', () => ({
  useControlCenterStore: { getState: () => ({ terminalSessions: [] }) },
}));
jest.mock('../src/services/credentialStore', () => ({
  saveCredentials: jest.fn(),
  clearCredentials: jest.fn(),
  readCredentialFlag: jest.fn(),
  writeCredentialFlag: jest.fn(),
  loadCredentials: jest.fn(),
  probeBiometry: jest.fn().mockResolvedValue(false),
  pickStorageMode: (b: string | null) => (b ? 'biometric' : 'plain'),
}));

import { deleteAccount as apiDeleteAccount } from '../src/api/auth';
import { useSessionStore } from '../stores/useSettingsStore';
import {
  clearCredentials,
  writeCredentialFlag,
} from '../src/services/credentialStore';
import {
  __resetSessionAuthHubForTest,
  setSessionInvalidationHandler,
} from '../src/api/sessionAuth';

const apiDeleteAccountMock = apiDeleteAccount as jest.Mock;

const flush = () => new Promise<void>(r => setImmediate(() => r()));

const signedInState = () => ({
  user: {
    id: 'user-1',
    email: 'user@example.com',
    name: 'User',
    role: 'operator',
  },
  token: 'token-1',
  refreshToken: 'refresh-1',
  operatorName: 'User',
  accountData: {
    loadedAt: '2026-09-30T00:00:00.000Z',
    profile: undefined,
    subscriptions: [],
  },
});

describe('useSessionStore.deleteAccount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetSessionAuthHubForTest();
    setSessionInvalidationHandler(() => {});
    apiDeleteAccountMock.mockResolvedValue(undefined);
    useSessionStore.setState(signedInState());
  });

  test('success clears the session AND the saved keychain credentials', async () => {
    await useSessionStore.getState().deleteAccount('pw');
    await flush();

    expect(apiDeleteAccountMock).toHaveBeenCalledWith('pw');
    expect(useSessionStore.getState()).toMatchObject({
      user: null,
      token: null,
      refreshToken: null,
      operatorName: 'Aliang',
      accountData: null,
    });
    expect(clearCredentials).toHaveBeenCalledTimes(1);
    expect(writeCredentialFlag).toHaveBeenCalledWith({
      hasCreds: false,
      usesBiometry: false,
      savedAccount: null,
    });
  });

  test('failure (api throws) keeps the session and credentials intact', async () => {
    apiDeleteAccountMock.mockRejectedValue(
      new Error('DELETE /api/auth/account failed with HTTP 401'),
    );

    await expect(
      useSessionStore.getState().deleteAccount('wrong'),
    ).rejects.toThrow('HTTP 401');
    await flush();

    expect(clearCredentials).not.toHaveBeenCalled();
    expect(writeCredentialFlag).not.toHaveBeenCalled();
    expect(useSessionStore.getState()).toMatchObject({
      user: { id: 'user-1' },
      token: 'token-1',
      refreshToken: 'refresh-1',
      operatorName: 'User',
      accountData: signedInState().accountData,
    });
  });

  test('success still completes when the keychain wipe fails (best-effort)', async () => {
    (clearCredentials as jest.Mock).mockRejectedValue(
      new Error('keychain unavailable'),
    );

    await useSessionStore.getState().deleteAccount('pw');
    await flush();

    expect(useSessionStore.getState()).toMatchObject({
      user: null,
      token: null,
      refreshToken: null,
      accountData: null,
    });
  });
});
