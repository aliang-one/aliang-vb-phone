jest.mock('react-native-keychain', () => ({}));
import AsyncStorage from '@react-native-async-storage/async-storage';
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import { pickStorageMode } from '../src/services/credentialStore';

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
