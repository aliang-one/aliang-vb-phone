jest.mock('react-native-keychain', () => ({
  getSupportedBiometryType: jest.fn(),
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  ACCESS_CONTROL: { BIOMETRY_CURRENT_SET: 'BIOMETRY_CURRENT_SET' },
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
}));
import AsyncStorage from '@react-native-async-storage/async-storage';
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import * as Keychain from 'react-native-keychain';
import {
  pickStorageMode,
  saveCredentials,
  loadCredentials,
  clearCredentials,
  readCredentialFlag,
  writeCredentialFlag,
  CREDENTIAL_SERVICE,
} from '../src/services/credentialStore';

describe('pickStorageMode', () => {
  test.each([['FaceID'], ['TouchID'], ['Fingerprint'], ['Face'], ['Iris']])(
    'any non-null biometry type (%s) → biometric',
    (type) => {
      expect(pickStorageMode(type)).toBe('biometric');
    },
  );
  test('null → plain', () => {
    expect(pickStorageMode(null)).toBe('plain');
  });
});

describe('saveCredentials', () => {
  beforeEach(() => jest.resetAllMocks());

  test('biometric mode sets accessControl + device-only accessible (NO v8 securityLevel)', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue('FaceID');
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
    const mode = await saveCredentials('a@b.c', 'pw');
    expect(mode).toBe('biometric');
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'a@b.c',
      'pw',
      expect.objectContaining({
        service: CREDENTIAL_SERVICE,
        accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    );
    // v10 has no securityLevel field — assert it is NOT passed.
    const opts = (Keychain.setGenericPassword as jest.Mock).mock.calls[0][2] as Record<string, unknown>;
    expect(opts.securityLevel).toBeUndefined();
  });

  test('plain mode (no biometry) omits accessControl', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue(null);
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
    const mode = await saveCredentials('a@b.c', 'pw');
    expect(mode).toBe('plain');
    expect(
      (Keychain.setGenericPassword as jest.Mock).mock.calls[0][2].accessControl,
    ).toBeUndefined();
  });

  test('swallows save failure and returns null (never blocks login)', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue('FaceID');
    (Keychain.setGenericPassword as jest.Mock).mockRejectedValue(new Error('disk'));
    const mode = await saveCredentials('a@b.c', 'pw');
    expect(mode).toBeNull();
  });
});

describe('loadCredentials', () => {
  beforeEach(() => jest.resetAllMocks());

  test('resolves credentials → {status:"ok", email, password}', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
      service: CREDENTIAL_SERVICE,
      username: 'a@b.c',
      password: 'pw',
    });
    await expect(loadCredentials({ title: 't' })).resolves.toEqual({
      status: 'ok',
      email: 'a@b.c',
      password: 'pw',
    });
    expect(Keychain.getGenericPassword).toHaveBeenCalledWith({
      service: CREDENTIAL_SERVICE,
      authenticationPrompt: { title: 't' },
    });
  });

  test('getGenericPassword resolves false (cancel OR missing) → {status:"cancelled"}', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
    await expect(loadCredentials({ title: 't' })).resolves.toEqual({ status: 'cancelled' });
  });

  test('getGenericPassword rejects (BIOMETRIC_NOT_ENROLLED) → caught → {status:"unavailable"}', async () => {
    const err = Object.assign(new Error('not enrolled'), { code: 'BIOMETRIC_NOT_ENROLLED' });
    (Keychain.getGenericPassword as jest.Mock).mockRejectedValue(err);
    await expect(loadCredentials({ title: 't' })).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('flag + clear', () => {
  beforeEach(() => jest.resetAllMocks());

  test('readCredentialFlag defaults when absent', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await expect(readCredentialFlag()).resolves.toEqual({ hasCreds: false, usesBiometry: false });
  });

  test('readCredentialFlag returns default on garbage JSON (robustness)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('not-json{');
    await expect(readCredentialFlag()).resolves.toEqual({ hasCreds: false, usesBiometry: false });
  });

  test('writeCredentialFlag persists JSON', async () => {
    await writeCredentialFlag({ hasCreds: true, usesBiometry: true });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@saved_credential_flag',
      JSON.stringify({ hasCreds: true, usesBiometry: true }),
    );
  });

  test('clearCredentials calls resetGenericPassword with service', async () => {
    (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);
    await clearCredentials();
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: CREDENTIAL_SERVICE });
  });
});
