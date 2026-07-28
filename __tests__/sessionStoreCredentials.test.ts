jest.mock('../src/api/auth', () => ({
  fetchCurrentUser: jest.fn(),
  refreshSessionTokens: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
}));
jest.mock('../src/api/account', () => ({ fetchAccountPortalData: jest.fn() }));
jest.mock('../src/services/platformTransport', () => ({
  platformTransport: { closeTerminalSession: jest.fn() },
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
  pickStorageMode: (b: string | null) => (b ? 'biometric' : 'plain'),
}));

import { login as apiLogin } from '../src/api/auth';
import { useSessionStore } from '../stores/useSettingsStore';
import {
  saveCredentials,
  clearCredentials,
  writeCredentialFlag,
} from '../src/services/credentialStore';
import {
  __resetSessionAuthHubForTest,
  setSessionInvalidationHandler,
} from '../src/api/sessionAuth';

const flush = () => new Promise<void>(r => setImmediate(() => r()));
const goodSession = () => ({
  user: { id: 'u', email: 'a@b.c', name: 'A', role: 'user' },
  token: 't',
  refreshToken: 'r',
});

describe('useSessionStore credential save/clear', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetSessionAuthHubForTest();
    setSessionInvalidationHandler(() => {});
  });

  test('successful login saves credentials + flag (biometric)', async () => {
    (apiLogin as jest.Mock).mockImplementation(async () => goodSession());
    (saveCredentials as jest.Mock).mockResolvedValue('biometric');
    await useSessionStore.getState().login('a@b.c', 'pw');
    await flush();
    expect(saveCredentials).toHaveBeenCalledWith('a@b.c', 'pw');
    expect(writeCredentialFlag).toHaveBeenCalledWith({ hasCreds: true, usesBiometry: true });
  });

  test('save failure (null mode) → hasCreds:false, login still succeeds', async () => {
    (apiLogin as jest.Mock).mockImplementation(async () => goodSession());
    (saveCredentials as jest.Mock).mockResolvedValue(null);
    await useSessionStore.getState().login('a@b.c', 'pw');
    await flush();
    expect(writeCredentialFlag).toHaveBeenCalledWith({ hasCreds: false, usesBiometry: false });
  });

  test('logout does NOT clear credentials', async () => {
    await useSessionStore.getState().logout();
    await flush(); // logout has internal awaits; flush before asserting
    expect(clearCredentials).not.toHaveBeenCalled();
  });

  test('clearSavedCredentials: clearCredentials completes BEFORE writeCredentialFlag', async () => {
    const order: string[] = [];
    (clearCredentials as jest.Mock).mockImplementation(async () => {
      order.push('clear');
    });
    (writeCredentialFlag as jest.Mock).mockImplementation(async () => {
      order.push('flag');
    });
    await useSessionStore.getState().clearSavedCredentials();
    await flush();
    expect(order).toEqual(['clear', 'flag']);
    expect(writeCredentialFlag).toHaveBeenCalledWith({ hasCreds: false, usesBiometry: false });
  });
});
