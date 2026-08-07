/**
 * Sole surface over `react-native-keychain`. Stores the user's email + password
 * in the OS secure store (Android Keystore / iOS Keychain) so the login screen
 * can offer biometric one-tap login.
 */
import * as Keychain from 'react-native-keychain';
import type { AuthenticationPrompt, SetOptions } from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CREDENTIAL_SERVICE = 'com.aliangvibecodingphone.session';
const FLAG_KEY = '@saved_credential_flag';

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
  options: { forcePlain?: boolean } = {},
): Promise<StorageMode | null> {
  try {
    const biometry = await Keychain.getSupportedBiometryType();
    const hasBiometry = typeof biometry === 'string' && !!biometry;
    // forcePlain skips the biometric accessControl so the WRITE does NOT trigger
    // a fingerprint prompt — used when the user declined the "enable fingerprint"
    // confirmation but still wants the password prefilled next time.
    const mode = !options.forcePlain && hasBiometry ? 'biometric' : 'plain';
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

/**
 * Whether this device advertises any biometry type
 * (`FaceID | TouchID | Fingerprint | Face | Iris`). Used to decide whether to
 * ASK the user about enabling fingerprint login BEFORE a biometric-gated save
 * (which would prompt on WRITE). null/undefined/exception → false.
 */
export async function probeBiometry(): Promise<boolean> {
  try {
    const biometry = await Keychain.getSupportedBiometryType();
    return typeof biometry === 'string' && !!biometry;
  } catch {
    return false;
  }
}

export type LoadResult =
  | { status: 'ok'; email: string; password: string }
  // iOS: `getGenericPassword` resolved `false` (cancel OR missing — indistinguishable).
  // Android: user dismissed the BiometricPrompt → reject "code: 5/10/13" (see below).
  | { status: 'cancelled' }
  // Genuine OS refusal; retrying won't help: BIOMETRIC_NOT_ENROLLED, PASSCODE_NOT_SET,
  // hw unavailable, lockout, …
  | { status: 'unavailable' };

/**
 * BiometricPrompt errorCodes that mean the *user* dismissed the prompt and can
 * simply retry — NOT a hardware/enrollment problem. react-native-keychain
 * embeds them in the reject message as `code: <N>` (see
 * `ResultHandlerInteractiveBiometric.onAuthenticationError`, which throws
 * `CryptoFailedException("code: $errorCode, msg: …")`). Values from
 * `androidx.biometric.BiometricPrompt`:
 *   5  ERROR_CANCELED        (home/back, or another dialog stole focus)
 *   10 ERROR_USER_CANCELED   (user tapped the cancel button)
 *   13 ERROR_NEGATIVE_BUTTON (user tapped the negative button, e.g. "Cancel")
 * Kept narrow on purpose — everything else (hw off, lockout, not enrolled) is a
 * genuine `unavailable`.
 */
const BIOMETRIC_USER_CANCEL_CODES = new Set([5, 10, 13]);

/**
 * On Android, canceling the BiometricPrompt makes `getGenericPassword` REJECT
 * with code `E_CRYPTO_FAILED` and a message of the form `code: <N>, msg: …`,
 * NOT resolve `false` like iOS. Detect that user-initiated cancel so the login
 * screen keeps the fingerprint entry (retryable) instead of treating it as a
 * broken-biometry `unavailable` (which would also wipe the saved-creds flag).
 */
function isBiometricUserCancel(error: unknown): boolean {
  const message = String(
    (error as { message?: unknown } | null | undefined)?.message ?? '',
  );
  const match = message.match(/code:\s*(\d+)/i);
  return match ? BIOMETRIC_USER_CANCEL_CODES.has(Number(match[1])) : false;
}

/**
 * Read saved credentials. `getGenericPassword` RESOLVES `false` on iOS for a
 * missing entry OR user-cancel (indistinguishable), and REJECTS on OS refusal —
 * but on Android it ALSO rejects for a user cancel (see `isBiometricUserCancel`).
 * The 3-way result lets the UI retry only when retry can actually succeed.
 */
export async function loadCredentials(
  authenticationPrompt: AuthenticationPrompt,
): Promise<LoadResult> {
  try {
    const result = await Keychain.getGenericPassword({
      service: CREDENTIAL_SERVICE,
      authenticationPrompt,
    });
    if (!result || typeof result === 'boolean') return { status: 'cancelled' };
    return { status: 'ok', email: result.username, password: result.password };
  } catch (error) {
    if (isBiometricUserCancel(error)) return { status: 'cancelled' };
    return { status: 'unavailable' };
  }
}

export interface CredentialFlag {
  hasCreds: boolean;
  usesBiometry: boolean;
  /**
   * Which account (email) the stored credential belongs to. Used to SKIP
   * re-saving on subsequent logins with the same account — on Android,
   * setGenericPassword with biometric accessControl prompts on WRITE, so
   * re-saving every login would prompt fingerprint after every password login.
   */
  savedAccount: string | null;
}

const DEFAULT_FLAG: CredentialFlag = {
  hasCreds: false,
  usesBiometry: false,
  savedAccount: null,
};

/**
 * Non-sensitive flag in AsyncStorage so the login screen can decide whether to
 * auto-prompt WITHOUT triggering a biometric prompt just to check existence.
 * Initial value when absent / unparseable: {hasCreds:false, usesBiometry:false}.
 */
export async function readCredentialFlag(): Promise<CredentialFlag> {
  try {
    const raw = await AsyncStorage.getItem(FLAG_KEY);
    if (!raw) return DEFAULT_FLAG;
    return { ...DEFAULT_FLAG, ...(JSON.parse(raw) as Partial<CredentialFlag>) };
  } catch {
    return DEFAULT_FLAG;
  }
}

export async function writeCredentialFlag(flag: CredentialFlag): Promise<void> {
  try {
    await AsyncStorage.setItem(FLAG_KEY, JSON.stringify(flag));
  } catch {
    // non-critical
  }
}

/**
 * Remove stored credentials. NON-atomic with writeCredentialFlag — if the app
 * crashes between this and the flag write, the LoginScreen self-heal covers it.
 */
export async function clearCredentials(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: CREDENTIAL_SERVICE });
  } catch {
    // best-effort
  }
}
