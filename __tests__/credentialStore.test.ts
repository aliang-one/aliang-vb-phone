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
