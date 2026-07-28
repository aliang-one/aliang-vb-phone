/**
 * Sole surface over `react-native-keychain`. Stores the user's email + password
 * in the OS secure store (Android Keystore / iOS Keychain) so the login screen
 * can offer biometric one-tap login.
 */
import * as Keychain from 'react-native-keychain';
import type { SetOptions } from 'react-native-keychain';

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

/**
 * Persist credentials after a successful login. Probes biometry support and
 * stores biometric-gated when available, plain (still Keystore/Keychain-
 * encrypted at rest) otherwise. Best-effort: any failure returns `null` so the
 * caller can record hasCreds:false without blocking the login.
 *
 * v10 note: there is NO `securityLevel` field (that was v8) and no `STORAGE_TYPES`
 * (it's `STORAGE_TYPE`, fiddly with accessControl) — biometric hardening comes
 * from `accessControl: BIOMETRY_CURRENT_SET` alone; we set `accessible` to keep
 * the secret device-local.
 */
export async function saveCredentials(
  email: string,
  password: string,
): Promise<StorageMode | null> {
  try {
    const biometry = await Keychain.getSupportedBiometryType();
    const mode = pickStorageMode(typeof biometry === 'string' ? biometry : null);
    const opts: SetOptions = { service: CREDENTIAL_SERVICE };
    if (mode === 'biometric') {
      opts.accessControl = Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET;
      opts.accessible = Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY;
    }
    await Keychain.setGenericPassword(email, password, opts);
    return mode;
  } catch {
    return null;
  }
}
