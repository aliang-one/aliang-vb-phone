/**
 * Sole surface over `react-native-keychain`. Stores the user's email + password
 * in the OS secure store (Android Keystore / iOS Keychain) so the login screen
 * can offer biometric one-tap login.
 */

export const CREDENTIAL_SERVICE = 'com.aliangvibecodingphone.session';

export type StorageMode = 'biometric' | 'plain';

/**
 * Decide how to store credentials given the device's supported biometry type.
 * `biometryType` is one of the BIOMETRY_TYPE enum strings
 * (`'FaceID' | 'TouchID' | 'Fingerprint' | 'Face' | 'Iris'`) or `null`.
 * Any non-null value → biometric (biometric-gated retrieval); `null` → plain.
 * Never compare to a hard-coded key name — treat any non-null as biometric.
 */
export function pickStorageMode(biometryType: string | null): StorageMode {
  return biometryType ? 'biometric' : 'plain';
}
