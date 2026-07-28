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
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSessionStore } from '../stores/useSettingsStore';
import {
  saveCredentials,
  clearCredentials,
  writeCredentialFlag,
} from '../src/services/credentialStore';
import { useToastStore } from '../src/store/toastStore';
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

describe('plain-mode informed-consent toast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetSessionAuthHubForTest();
    setSessionInvalidationHandler(() => {});
  });

  test('first plain save shows the notice once, with the i18n string', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (apiLogin as jest.Mock).mockImplementation(async () => goodSession());
    (saveCredentials as jest.Mock).mockResolvedValue('plain');
    const showSpy = jest.spyOn(useToastStore.getState(), 'show');
    await useSessionStore.getState().login('a@b.c', 'pw');
    await flush();
    expect(showSpy).toHaveBeenCalledTimes(1);
    // Lock the i18n string so Chinese users don't get an English placeholder.
    // jest.setup.js pins i18n to 'zh', so the notice carries 生物识别.
    expect(showSpy).toHaveBeenCalledWith(expect.stringContaining('生物识别'));
    showSpy.mockRestore();
  });

  test('second plain save does NOT re-show', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (k: string) =>
      k === '@plain_save_notice_shown' ? '1' : null,
    );
    (apiLogin as jest.Mock).mockImplementation(async () => goodSession());
    (saveCredentials as jest.Mock).mockResolvedValue('plain');
    const showSpy = jest.spyOn(useToastStore.getState(), 'show');
    await useSessionStore.getState().login('a@b.c', 'pw');
    await flush();
    expect(showSpy).not.toHaveBeenCalled();
    showSpy.mockRestore();
  });
});
