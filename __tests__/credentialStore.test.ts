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
  probeBiometry,
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

  test('forcePlain=true overrides biometry → plain (no accessControl, no prompt)', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue('FaceID');
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
    const mode = await saveCredentials('a@b.c', 'pw', { forcePlain: true });
    expect(mode).toBe('plain');
    expect(
      (Keychain.setGenericPassword as jest.Mock).mock.calls[0][2].accessControl,
    ).toBeUndefined();
  });
});

describe('probeBiometry', () => {
  beforeEach(() => jest.resetAllMocks());

  test('non-null biometry type → true', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue('Fingerprint');
    await expect(probeBiometry()).resolves.toBe(true);
  });

  test('null → false', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue(null);
    await expect(probeBiometry()).resolves.toBe(false);
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

  // Android reality: react-native-keychain REJECTS when the user cancels the
  // BiometricPrompt (iOS resolves `false`). The reject carries code
  // `E_CRYPTO_FAILED` with the BiometricPrompt errorCode embedded in the
  // message as "code: N". User-initiated dismiss codes must map to
  // 'cancelled' so the login screen keeps the fingerprint entry and the user
  // can tap it again — NOT to 'unavailable', which would wipe the saved-creds
  // flag and strand the user on the password view.
  //   5  = ERROR_CANCELED        (home/back, or another dialog stole focus)
  //   10 = ERROR_USER_CANCELED   (user tapped cancel)
  //   13 = ERROR_NEGATIVE_BUTTON (user tapped the negative button, e.g. "Cancel")
  test.each([
    ['5 (ERROR_CANCELED)', 5],
    ['10 (ERROR_USER_CANCELED)', 10],
    ['13 (ERROR_NEGATIVE_BUTTON)', 13],
  ])(
    'Android reject E_CRYPTO_FAILED "code: %s" → {status:"cancelled"} (user can retry)',
    async (_label, errorCode) => {
      const err = Object.assign(
        new Error(`code: ${errorCode}, msg: canceled by user`),
        { code: 'E_CRYPTO_FAILED' },
      );
      (Keychain.getGenericPassword as jest.Mock).mockRejectedValue(err);
      await expect(loadCredentials({ title: 't' })).resolves.toEqual({ status: 'cancelled' });
    },
  );

  // Genuine OS/hardware refusals stay 'unavailable' — retrying won't help and
  // the login screen should fall back to password (and clear the stale flag).
  //   2  = ERROR_HW_UNAVAILABLE
  //   7  = ERROR_LOCKOUT (too many failed attempts — temporary, but not a retry-this-instant)
  //   11 = ERROR_NO_BIOMETRICS (none enrolled)
  test.each([
    ['2 (ERROR_HW_UNAVAILABLE)', 2],
    ['7 (ERROR_LOCKOUT)', 7],
    ['11 (ERROR_NO_BIOMETRICS)', 11],
  ])(
    'Android reject E_CRYPTO_FAILED "code: %s" → {status:"unavailable"} (genuine)',
    async (_label, errorCode) => {
      const err = Object.assign(
        new Error(`code: ${errorCode}, msg: biometry unavailable`),
        { code: 'E_CRYPTO_FAILED' },
      );
      (Keychain.getGenericPassword as jest.Mock).mockRejectedValue(err);
      await expect(loadCredentials({ title: 't' })).resolves.toEqual({ status: 'unavailable' });
    },
  );
});

describe('flag + clear', () => {
  beforeEach(() => jest.resetAllMocks());

  test('readCredentialFlag defaults when absent', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await expect(readCredentialFlag()).resolves.toEqual({ hasCreds: false, usesBiometry: false, savedAccount: null });
  });

  test('readCredentialFlag returns default on garbage JSON (robustness)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('not-json{');
    await expect(readCredentialFlag()).resolves.toEqual({ hasCreds: false, usesBiometry: false, savedAccount: null });
  });

  test('writeCredentialFlag persists JSON', async () => {
    await writeCredentialFlag({ hasCreds: true, usesBiometry: true, savedAccount: "a@b.c" });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@saved_credential_flag',
      JSON.stringify({ hasCreds: true, usesBiometry: true, savedAccount: "a@b.c" }),
    );
  });

  test('clearCredentials calls resetGenericPassword with service', async () => {
    (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);
    await clearCredentials();
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: CREDENTIAL_SERVICE });
  });
});
