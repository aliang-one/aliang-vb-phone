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
  probeBiometry: jest.fn().mockResolvedValue(false),
  pickStorageMode: (b: string | null) => (b ? 'biometric' : 'plain'),
}));

import { login as apiLogin } from '../src/api/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSessionStore } from '../stores/useSettingsStore';
import { Alert, type AlertButton } from 'react-native';
import {
  saveCredentials,
  probeBiometry,
  clearCredentials,
  readCredentialFlag,
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
    // Default: no prior saved account → login will save.
    (readCredentialFlag as jest.Mock).mockResolvedValue({
      hasCreds: false,
      usesBiometry: false,
      savedAccount: null,
    });
  });

  test('successful login saves credentials + flag (biometric)', async () => {
    (apiLogin as jest.Mock).mockImplementation(async () => goodSession());
    (saveCredentials as jest.Mock).mockResolvedValue('biometric');
    await useSessionStore.getState().login('a@b.c', 'pw');
    await flush();
    expect(saveCredentials).toHaveBeenCalledWith('a@b.c', 'pw');
    expect(writeCredentialFlag).toHaveBeenCalledWith({
      hasCreds: true,
      usesBiometry: true,
      savedAccount: 'a@b.c',
    });
  });

  test('save failure (null mode) → hasCreds:false, login still succeeds', async () => {
    (apiLogin as jest.Mock).mockImplementation(async () => goodSession());
    (saveCredentials as jest.Mock).mockResolvedValue(null);
    await useSessionStore.getState().login('a@b.c', 'pw');
    await flush();
    expect(writeCredentialFlag).toHaveBeenCalledWith({
      hasCreds: false,
      usesBiometry: false,
      savedAccount: null,
    });
  });

  test('SKIPS re-save (no biometric prompt) when this account is already stored', async () => {
    // The fix for "fingerprint asked after every password login": on Android,
    // setGenericPassword with accessControl prompts on WRITE, so we must not
    // re-save when the cred for this account already exists.
    (readCredentialFlag as jest.Mock).mockResolvedValue({
      hasCreds: true,
      usesBiometry: true,
      savedAccount: 'a@b.c',
    });
    (apiLogin as jest.Mock).mockImplementation(async () => goodSession());
    await useSessionStore.getState().login('a@b.c', 'pw');
    await flush();
    expect(saveCredentials).not.toHaveBeenCalled();
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
    expect(writeCredentialFlag).toHaveBeenCalledWith({
      hasCreds: false,
      usesBiometry: false,
      savedAccount: null,
    });
  });
});

describe('plain-mode informed-consent toast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetSessionAuthHubForTest();
    setSessionInvalidationHandler(() => {});
    (readCredentialFlag as jest.Mock).mockResolvedValue({
      hasCreds: false,
      usesBiometry: false,
      savedAccount: null,
    });
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

describe('biometric-enable confirmation on first save', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetSessionAuthHubForTest();
    setSessionInvalidationHandler(() => {});
    (readCredentialFlag as jest.Mock).mockResolvedValue({
      hasCreds: false,
      usesBiometry: false,
      savedAccount: null,
    });
    (apiLogin as jest.Mock).mockImplementation(async () => goodSession());
    // Default for this group: device advertises biometry → the confirm prompt
    // is the gate before any biometric-gated save.
    (probeBiometry as jest.Mock).mockResolvedValue(true);
  });

  test('user ACCEPTS → biometric save (no forcePlain), usesBiometry true', async () => {
    (saveCredentials as jest.Mock).mockResolvedValue('biometric');
    // Buttons are [Later(cancel), Enable]; pressing Enable = accept.
    jest.spyOn(Alert, 'alert').mockImplementation(
      (_title, _message, buttons?: AlertButton[]) => buttons?.[1]?.onPress?.(),
    );
    await useSessionStore.getState().login('a@b.c', 'pw');
    await flush();
    expect(Alert.alert).toHaveBeenCalled();
    expect(saveCredentials).toHaveBeenCalledWith('a@b.c', 'pw');
    expect(writeCredentialFlag).toHaveBeenCalledWith(
      expect.objectContaining({ hasCreds: true, usesBiometry: true, savedAccount: 'a@b.c' }),
    );
  });

  test('user DECLINES → plain save (forcePlain:true), usesBiometry false', async () => {
    (saveCredentials as jest.Mock).mockResolvedValue('plain');
    // Pressing Later (buttons[0]) = decline.
    jest.spyOn(Alert, 'alert').mockImplementation(
      (_title, _message, buttons?: AlertButton[]) => buttons?.[0]?.onPress?.(),
    );
    await useSessionStore.getState().login('a@b.c', 'pw');
    await flush();
    expect(saveCredentials).toHaveBeenCalledWith('a@b.c', 'pw', { forcePlain: true });
    expect(writeCredentialFlag).toHaveBeenCalledWith(
      expect.objectContaining({ hasCreds: true, usesBiometry: false, savedAccount: 'a@b.c' }),
    );
  });

  test('device WITHOUT biometry → no Alert, direct plain save', async () => {
    (probeBiometry as jest.Mock).mockResolvedValue(false);
    (saveCredentials as jest.Mock).mockResolvedValue('plain');
    const alertSpy = jest.spyOn(Alert, 'alert');
    await useSessionStore.getState().login('a@b.c', 'pw');
    await flush();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(saveCredentials).toHaveBeenCalledWith('a@b.c', 'pw');
  });
});
