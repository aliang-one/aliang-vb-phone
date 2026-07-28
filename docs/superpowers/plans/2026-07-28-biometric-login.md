# Biometric One-Tap Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Silently save credentials after login; on the login screen, auto-prompt Face ID/fingerprint (or prefill on biometry-less devices) to log the user back in with one tap.

**Architecture:** New `react-native-keychain` (v10+, New-Arch-compatible) stores email+password in Android Keystore / iOS Keychain, biometric-gated when biometry is available. A new `credentialStore` service wraps the library. `useSettingsStore.login` saves on success; `LoginScreen` reads + auto-logs-in on focus; Settings gets a clear-credentials action. A non-sensitive AsyncStorage flag drives the "should I prompt?" decision without triggering a biometric prompt just to check existence.

**Tech Stack:** React Native 0.85.3 (New Arch, Hermes), TypeScript, zustand, jest + react-test-renderer, `react-native-keychain` v10+, AsyncStorage.

**Spec:** `docs/superpowers/specs/2026-07-28-biometric-login-design.md`

> **PREREQUISITE (hard ordering):** Task 1 (`npm install react-native-keychain`) MUST complete before any later task — Tasks 2+ `import` the library and jest can only resolve it once it is in `node_modules`. Do not skip Task 1.

**Commit-message convention:** Chinese (project rule). Do not push; the user rebuilds + verifies on-device before pushing.

---

## File Structure

- **Create** `src/services/credentialStore.ts` — sole `react-native-keychain` surface: `pickStorageMode` (pure), `saveCredentials`, `loadCredentials`, `clearCredentials`, `readCredentialFlag`, `writeCredentialFlag`, plus `CREDENTIAL_SERVICE` + `LoadResult` types.
- **Create** `__tests__/credentialStore.test.ts` — pure-function + keychain-mocked tests.
- **Create** `__tests__/loginScreenBiometric.test.tsx` — LoginScreen focus-flow tests.
- **Modify** `stores/useSettingsStore.ts` — save-on-login (`login`), add `clearSavedCredentials` action + interface.
- **Modify** `src/screens/auth/LoginScreen.tsx` — focus-based prompt/prefill/auto-submit + retry button + self-heal + loading hint.
- **Modify** `src/screens/settings/SettingsScreen.tsx` — "清除保存的登录信息" row.
- **Modify** `src/i18n/locales/auth/{en,zh}.json` — `biometricPromptTitle`, `biometricPromptCancel`, `biometricRetry`, `biometricLoading`, `plainModeSavedNotice`.
- **Modify** `src/i18n/locales/settings/{en,zh}.json` — `clearCredentialsLabel`, `clearCredentialsConfirm`.
- **Modify** `package.json` — add `react-native-keychain`.
- **Modify** `ios/AliangVibeCodingPhone/Info.plist` — `NSFaceIDUsageDescription`.
- **Modify** `android/app/src/main/AndroidManifest.xml` — `USE_BIOMETRIC` permission.

---

## Task 1: Add dependency + platform config + i18n keys

**Files:** `package.json`, `ios/AliangVibeCodingPhone/Info.plist`, `android/app/src/main/AndroidManifest.xml`, `src/i18n/locales/auth/{en,zh}.json`, `src/i18n/locales/settings/{en,zh}.json`

- [ ] **Step 1: Install the library + confirm v10**

```bash
npm install react-native-keychain
node -e "console.log(require('react-native-keychain/package.json').version)"
```
Expected: package added; printed version is `>=10.x` (v10 is a Codegen/TurboModule compatible with New Arch). If it resolves to v8/9, pin with `npm install react-native-keychain@^10`. The native autolinking itself happens at the next build.

- [ ] **Step 2: iOS — add Face ID usage description**

In `ios/AliangVibeCodingPhone/Info.plist`, inside `<dict>`, add:

```xml
<key>NSFaceIDUsageDescription</key>
<string>用于快速登录您的账户</string>
```

- [ ] **Step 3: Android — add biometric permission**

In `android/app/src/main/AndroidManifest.xml`, alongside the other `<uses-permission>` lines, add:

```xml
<uses-permission android:name="android.permission.USE_BIOMETRIC"/>
```

- [ ] **Step 4: Add i18n keys (auth namespace)**

`src/i18n/locales/auth/en.json`:
```json
"biometricPromptTitle": "Sign in to Aliang",
"biometricPromptCancel": "Cancel",
"biometricRetry": "Use Face ID / fingerprint to sign in",
"biometricLoading": "Checking saved login…",
"plainModeSavedNotice": "Biometrics not enabled on this device — saved login is stored without a biometric prompt."
```
`src/i18n/locales/auth/zh.json` (same keys, Chinese):
```json
"biometricPromptTitle": "登录 Aliang",
"biometricPromptCancel": "取消",
"biometricRetry": "使用 Face ID / 指纹登录",
"biometricLoading": "正在读取保存的登录信息…",
"plainModeSavedNotice": "此设备未启用生物识别，已保存的登录信息将以无门禁方式存储。"
```

- [ ] **Step 5: Add i18n keys (settings namespace)**

`src/i18n/locales/settings/en.json`:
```json
"clearCredentialsLabel": "Clear saved login",
"clearCredentialsConfirm": "Saved login cleared."
```
`src/i18n/locales/settings/zh.json`:
```json
"clearCredentialsLabel": "清除保存的登录信息",
"clearCredentialsConfirm": "已清除保存的登录信息。"
```

- [ ] **Step 6: Verify the app still typechecks + tests still pass**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc EXIT 0; jest: 821 pass / 3 pre-existing baseline fails (`DeviceDetailScreen`, `TerminalListScreen` — unchanged).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json ios/AliangVibeCodingPhone/Info.plist android/app/src/main/AndroidManifest.xml src/i18n/locales
git commit -m "feat(登录): 引入 react-native-keychain 与生识别登录 i18n/平台配置"
```

---

## Task 2: `pickStorageMode` pure function (TDD)

**Files:** Create `src/services/credentialStore.ts`, Create `__tests__/credentialStore.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/credentialStore.test.ts`:
```ts
jest.mock('react-native-keychain', () => ({}));
import AsyncStorage from '@react-native-async-storage/async-storage';
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
}));

import { pickStorageMode } from '../src/services/credentialStore';

describe('pickStorageMode', () => {
  test.each([['FaceID'], ['TouchID'], ['Fingerprint'], ['Face'], ['Iris']])(
    'any non-null biometry type (%s) → biometric',
    (type) => { expect(pickStorageMode(type)).toBe('biometric'); },
  );
  test('null → plain', () => { expect(pickStorageMode(null)).toBe('plain'); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/credentialStore.test.ts`
Expected: FAIL — module `../src/services/credentialStore` not found.

- [ ] **Step 3: Minimal implementation**

`src/services/credentialStore.ts`:
```ts
import * as Keychain from 'react-native-keychain';
import type { AuthenticationPrompt, SetOptions } from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CREDENTIAL_SERVICE = 'com.aliangvibecodingphone.session';
const FLAG_KEY = '@saved_credential_flag';

export type StorageMode = 'biometric' | 'plain';

/** Any non-null biometryType (BIOMETRY_TYPE enum string) → biometric; null → plain. */
export function pickStorageMode(biometryType: string | null): StorageMode {
  return biometryType ? 'biometric' : 'plain';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/credentialStore.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/credentialStore.ts __tests__/credentialStore.test.ts
git commit -m "feat(登录): pickStorageMode 纯函数 + 生识别存储模式判定"
```

---

## Task 3: `saveCredentials` (TDD)

**Files:** `src/services/credentialStore.ts`, `__tests__/credentialStore.test.ts`

- [ ] **Step 1: Replace the keychain mock + add failing tests**

At the top of `__tests__/credentialStore.test.ts`, replace the `jest.mock('react-native-keychain', ...)` block with a fuller mock (so later tasks can use it too):
```ts
const keychainMock = {
  getSupportedBiometryType: jest.fn(),
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
};
jest.mock('react-native-keychain', () => ({
  ...keychainMock,
  ACCESS_CONTROL: { BIOMETRY_CURRENT_SET: 'BIOMETRY_CURRENT_SET' },
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
  STORAGE_TYPES: { AES: 'AES' },
}));
```
Append:
```ts
import { saveCredentials, CREDENTIAL_SERVICE } from '../src/services/credentialStore';
import * as Keychain from 'react-native-keychain';

describe('saveCredentials', () => {
  beforeEach(() => jest.resetAllMocks());

  test('biometric mode sets accessControl + device-only accessible (NO v8 securityLevel)', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue('FaceID');
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
    const mode = await saveCredentials('a@b.c', 'pw');
    expect(mode).toBe('biometric');
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('a@b.c', 'pw', expect.objectContaining({
      service: CREDENTIAL_SERVICE,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }));
    // v10 has no securityLevel field — assert it is NOT passed.
    const opts = (Keychain.setGenericPassword as jest.Mock).mock.calls[0][2] as Record<string, unknown>;
    expect(opts.securityLevel).toBeUndefined();
  });

  test('plain mode (no biometry) omits accessControl', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue(null);
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
    const mode = await saveCredentials('a@b.c', 'pw');
    expect(mode).toBe('plain');
    expect((Keychain.setGenericPassword as jest.Mock).mock.calls[0][2].accessControl).toBeUndefined();
  });

  test('swallows save failure and returns null (never blocks login)', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue('FaceID');
    (Keychain.setGenericPassword as jest.Mock).mockRejectedValue(new Error('disk'));
    const mode = await saveCredentials('a@b.c', 'pw');
    expect(mode).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/credentialStore.test.ts`
Expected: FAIL — `saveCredentials` is not exported.

- [ ] **Step 3: Implement `saveCredentials`**

Append to `src/services/credentialStore.ts`:
```ts
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
      // v10: AES storage drives Android hardening; there is NO securityLevel field.
      opts.storage = Keychain.STORAGE_TYPES.AES;
    }
    await Keychain.setGenericPassword(email, password, opts);
    return mode;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/credentialStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/credentialStore.ts __tests__/credentialStore.test.ts
git commit -m "feat(登录): saveCredentials 按生识别探测结果存储凭据"
```

---

## Task 4: `loadCredentials` — 3-way `LoadResult` (TDD)

**Files:** `src/services/credentialStore.ts`, `__tests__/credentialStore.test.ts`

The return type discriminates **ok / cancelled / unavailable** so the LoginScreen can show a retry button only when retry makes sense.

- [ ] **Step 1: Add failing tests**

Append:
```ts
import { loadCredentials } from '../src/services/credentialStore';

describe('loadCredentials', () => {
  beforeEach(() => jest.resetAllMocks());

  test('resolves credentials → {status:"ok", email, password}', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
      service: CREDENTIAL_SERVICE, username: 'a@b.c', password: 'pw',
    });
    await expect(loadCredentials({ title: 't' })).resolves.toEqual({ status: 'ok', email: 'a@b.c', password: 'pw' });
    expect(Keychain.getGenericPassword).toHaveBeenCalledWith({
      service: CREDENTIAL_SERVICE, authenticationPrompt: { title: 't' },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/credentialStore.test.ts`
Expected: FAIL — `loadCredentials` not exported.

- [ ] **Step 3: Implement**

Append to `src/services/credentialStore.ts`:
```ts
export type LoadResult =
  | { status: 'ok'; email: string; password: string }
  | { status: 'cancelled' }   // getGenericPassword resolved false (cancel or missing)
  | { status: 'unavailable' }; // getGenericPassword rejected (BIOMETRIC_NOT_ENROLLED, PASSCODE_NOT_SET, …)

/**
 * Read saved credentials. `getGenericPassword` RESOLVES `false` on missing entry
 * OR user-cancel (indistinguishable), and REJECTS with error.code on OS refusal.
 * The 3-way result lets the UI retry only when retry can succeed.
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
  } catch {
    return { status: 'unavailable' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/credentialStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/credentialStore.ts __tests__/credentialStore.test.ts
git commit -m "feat(登录): loadCredentials 三态结果(ok/cancelled/unavailable)"
```

---

## Task 5: `clearCredentials` + flag read/write (TDD)

**Files:** `src/services/credentialStore.ts`, `__tests__/credentialStore.test.ts`

- [ ] **Step 1: Add failing tests (incl. JSON-parse-fallback)**

Append:
```ts
import { clearCredentials, readCredentialFlag, writeCredentialFlag } from '../src/services/credentialStore';

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
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@saved_credential_flag', JSON.stringify({ hasCreds: true, usesBiometry: true }));
  });

  test('clearCredentials calls resetGenericPassword with service', async () => {
    (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);
    await clearCredentials();
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: CREDENTIAL_SERVICE });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/credentialStore.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

Append to `src/services/credentialStore.ts`:
```ts
export interface CredentialFlag {
  hasCreds: boolean;
  usesBiometry: boolean;
}

const DEFAULT_FLAG: CredentialFlag = { hasCreds: false, usesBiometry: false };

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

export async function clearCredentials(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: CREDENTIAL_SERVICE });
  } catch {
    // best-effort
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/credentialStore.test.ts`
Expected: PASS (all credentialStore tests green).

- [ ] **Step 5: Commit**

```bash
git add src/services/credentialStore.ts __tests__/credentialStore.test.ts
git commit -m "feat(登录): credentialStore 增 clearCredentials + AsyncStorage 标志读写"
```

---

## Task 6: `useSettingsStore` — save-on-login + `clearSavedCredentials` (TDD)

**Files:** `stores/useSettingsStore.ts`, Create `__tests__/sessionStoreCredentials.test.ts`

- [ ] **Step 1: Write failing tests**

`__tests__/sessionStoreCredentials.test.ts`:
```ts
jest.mock('../src/api/auth', () => ({
  fetchCurrentUser: jest.fn(), refreshSessionTokens: jest.fn(),
  login: jest.fn(), logout: jest.fn(),
}));
jest.mock('../src/api/account', () => ({ fetchAccountPortalData: jest.fn() }));
jest.mock('../src/services/platformTransport', () => ({ platformTransport: { closeTerminalSession: jest.fn() } }));
jest.mock('../src/store/controlCenterStore', () => ({ useControlCenterStore: { getState: () => ({ terminalSessions: [] }) } }));

const credMock = {
  saveCredentials: jest.fn(), clearCredentials: jest.fn(),
  readCredentialFlag: jest.fn(), writeCredentialFlag: jest.fn(), loadCredentials: jest.fn(),
};
jest.mock('../src/services/credentialStore', () => ({
  ...credMock,
  pickStorageMode: (b: string | null) => (b ? 'biometric' : 'plain'),
}));

import { login as apiLogin } from '../src/api/auth';
import { useSessionStore } from '../stores/useSettingsStore';
import { saveCredentials, clearCredentials, writeCredentialFlag } from '../src/services/credentialStore';
import { __resetSessionAuthHubForTest, setSessionInvalidationHandler } from '../src/api/sessionAuth';

const flush = () => new Promise(r => setImmediate(r));
const goodSession = () => ({ user: { id: 'u', email: 'a@b.c', name: 'A', role: 'user' }, token: 't', refreshToken: 'r' });

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
    (clearCredentials as jest.Mock).mockImplementation(async () => { order.push('clear'); });
    (writeCredentialFlag as jest.Mock).mockImplementation(async () => { order.push('flag'); });
    await useSessionStore.getState().clearSavedCredentials();
    await flush();
    expect(order).toEqual(['clear', 'flag']);
    expect(writeCredentialFlag).toHaveBeenCalledWith({ hasCreds: false, usesBiometry: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/sessionStoreCredentials.test.ts`
Expected: FAIL — `clearSavedCredentials` not on store / save not wired.

- [ ] **Step 3: Wire into the store**

In `stores/useSettingsStore.ts`:
- Add import from `'../src/services/credentialStore'`: `saveCredentials, clearCredentials, writeCredentialFlag`.
- Add to `SessionState` interface: `clearSavedCredentials: () => Promise<void>;`
- In `login`, after the existing `set({...})` and the `refreshAccountData` try/catch, append:
  ```ts
  // Silently remember credentials for biometric one-tap login. Best-effort.
  try {
    const mode = await saveCredentials(email.trim(), password);
    await writeCredentialFlag({ hasCreds: !!mode, usesBiometry: mode === 'biometric' });
  } catch {
    // never block login
  }
  ```
- Add the action next to `logout`:
  ```ts
  clearSavedCredentials: async () => {
    await clearCredentials();
    await writeCredentialFlag({ hasCreds: false, usesBiometry: false });
  },
  ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/sessionStoreCredentials.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Run tsc + restoreUserRefresh (no regression)**

Run: `npx tsc --noEmit && npx jest __tests__/restoreUserRefresh.test.ts __tests__/sessionStoreCredentials.test.ts`
Expected: tsc 0; both suites pass.

- [ ] **Step 6: Commit**

```bash
git add stores/useSettingsStore.ts __tests__/sessionStoreCredentials.test.ts
git commit -m "feat(登录): 登录成功静默保存凭据 + clearSavedCredentials action"
```

---

## Task 7: `LoginScreen` biometric / prefill flow (TDD)

**Files:** `src/screens/auth/LoginScreen.tsx`, Create `__tests__/loginScreenBiometric.test.tsx`

> Mock notes: `useLocale` lives at `src/i18n/useLocale.tsx`; jest resolves it without extension (the project preset includes `tsx`). All post-mount async flushes MUST happen **inside `await act(async () => { await new Promise(r => setImmediate(r)); })`** so TestRenderer processes the resulting `setState` (retry button / loading hint).

- [ ] **Step 1: Write failing tests**

`__tests__/loginScreenBiometric.test.tsx`:
```tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useSessionStore } from '../stores/useSettingsStore';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => { cb(); return () => {}; },
  useRoute: () => ({ params: {} }),
}));
jest.mock('../src/components/layout/SafeAreaWrapper', () => ({
  SafeAreaWrapper: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../src/i18n/useLocale', () => ({ useLocale: () => ({ locale: 'zh', setLocale: jest.fn() }) }));

const credMock = { readCredentialFlag: jest.fn(), loadCredentials: jest.fn(), writeCredentialFlag: jest.fn() };
jest.mock('../src/services/credentialStore', () => credMock);

import { LoginScreen } from '../src/screens/auth/LoginScreen';
import { TextInput } from 'react-native';

const flush = () => act(async () => { await new Promise(r => setImmediate(r)); });

const mountScreen = () => {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ThemeContext.Provider value={{ theme: utilityMinimalist, mode: 'light', setMode: () => {}, isDark: false }}>
        <LoginScreen />
      </ThemeContext.Provider>,
    );
  });
  return r;
};

describe('LoginScreen biometric flow', () => {
  let realLogin: unknown;
  beforeEach(() => {
    jest.clearAllMocks();
    realLogin = useSessionStore.getState().login;
    useSessionStore.setState({ login: jest.fn().mockResolvedValue(undefined) });
  });
  afterEach(() => { useSessionStore.setState({ login: realLogin as never }); });

  it('auto-logs in when flag=biometric and loadCredentials resolves ok', async () => {
    credMock.readCredentialFlag.mockResolvedValue({ hasCreds: true, usesBiometry: true });
    credMock.loadCredentials.mockResolvedValue({ status: 'ok', email: 'a@b.c', password: 'pw' });
    await flush(); // (mount happens at import-time of the focus effect via the mock)
    await flush();
    expect(credMock.loadCredentials).toHaveBeenCalled();
    expect(useSessionStore.getState().login).toHaveBeenCalledWith('a@b.c', 'pw');
  });

  it('cancel → retry button shown + flag self-healed; login NOT called', async () => {
    let r = mountScreen();
    credMock.readCredentialFlag.mockResolvedValue({ hasCreds: true, usesBiometry: true });
    credMock.loadCredentials.mockResolvedValue({ status: 'cancelled' });
    r = mountScreen(); // re-trigger focus effect with the new mock returns
    await flush();
    expect(credMock.writeCredentialFlag).toHaveBeenCalledWith({ hasCreds: false, usesBiometry: false });
    expect(useSessionStore.getState().login).not.toHaveBeenCalled();
    expect(r.root.findAllByProps({ testID: 'biometric-retry' }).length).toBeGreaterThan(0);
  });

  it('unavailable (reject) → NO retry button, login NOT called', async () => {
    let r = mountScreen();
    credMock.readCredentialFlag.mockResolvedValue({ hasCreds: true, usesBiometry: true });
    credMock.loadCredentials.mockResolvedValue({ status: 'unavailable' });
    r = mountScreen();
    await flush();
    expect(useSessionStore.getState().login).not.toHaveBeenCalled();
    expect(r.root.findAllByProps({ testID: 'biometric-retry' }).length).toBe(0);
  });

  it('flag=plain → prefills, does NOT auto-submit', async () => {
    credMock.readCredentialFlag.mockResolvedValue({ hasCreds: true, usesBiometry: false });
    credMock.loadCredentials.mockResolvedValue({ status: 'ok', email: 'a@b.c', password: 'pw' });
    mountScreen();
    await flush();
    expect(useSessionStore.getState().login).not.toHaveBeenCalled();
  });

  it('no saved creds → no load, empty form', async () => {
    credMock.readCredentialFlag.mockResolvedValue({ hasCreds: false, usesBiometry: false });
    mountScreen();
    await flush();
    expect(credMock.loadCredentials).not.toHaveBeenCalled();
  });

  it('user typing aborts a pending auto-submit (cancelledRef)', async () => {
    credMock.readCredentialFlag.mockResolvedValue({ hasCreds: true, usesBiometry: true });
    // Delay the cred resolution so we can type before it resolves.
    let resolveCreds!: (v: unknown) => void;
    credMock.loadCredentials.mockReturnValue(new Promise(r => { resolveCreds = r; }));
    const r = mountScreen();
    // User types into the email field before the prompt resolves.
    act(() => { r.root.findAllByType(TextInput)[0].props.onChangeText('x'); });
    resolveCreds({ status: 'ok', email: 'a@b.c', password: 'pw' });
    await flush();
    expect(useSessionStore.getState().login).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/loginScreenBiometric.test.tsx`
Expected: FAIL — focus effect absent / retry button absent / login not auto-called.

- [ ] **Step 3: Implement the flow in `LoginScreen.tsx`**

Key changes:
- Imports: add `useFocusEffect` from `@react-navigation/native`; `useRef` from `react`; `readCredentialFlag, loadCredentials, writeCredentialFlag, type LoadResult` from `'../../services/credentialStore'`.
- New state: `const [bioRetry, setBioRetry] = useState(false);` `const [bioLoading, setBioLoading] = useState(false);` and `const cancelledRef = useRef(false);`.
- Extract `handleSubmitWith(emailArg: string, passwordArg: string)` (same body as `handleSubmit` but with explicit args).
- Wrap both `TextInput` `onChangeText` handlers so they ALSO set `cancelledRef.current = true` before calling `setEmail`/`setPassword` (user typing aborts a pending auto-submit).
- Focus effect (after the existing state):
  ```tsx
  useFocusEffect(
    React.useCallback(() => {
      let mounted = true;
      cancelledRef.current = false;
      (async () => {
        const flag = await readCredentialFlag();
        if (!mounted || !flag.hasCreds) return;
        setBioLoading(true);
        const result: LoadResult = await loadCredentials({
          title: t('biometricPromptTitle'),
          cancel: t('biometricPromptCancel'),
        });
        setBioLoading(false);
        if (!mounted || cancelledRef.current) return;
        if (result.status === 'ok') {
          setEmail(result.email);
          setPassword(result.password);
          if (flag.usesBiometry) await handleSubmitWith(result.email, result.password);
        } else {
          // cancelled OR unavailable → self-heal flag.
          await writeCredentialFlag({ hasCreds: false, usesBiometry: false });
          // retry button only when retry can succeed (cancel), not on unavailable.
          setBioRetry(result.status === 'cancelled' && flag.usesBiometry);
        }
      })();
      return () => { mounted = false; };
    }, []),
  );
  ```
- Loading hint (inside the `GlassPanel`, above the error slot): `{bioLoading ? <Text>{t('biometricLoading')}</Text> : null}`.
- Retry button (above or at top of `GlassPanel`), only when `bioRetry`:
  ```tsx
  {bioRetry ? (
    <GlowButton
      title={t('biometricRetry')}
      testID="biometric-retry"
      onPress={async () => {
        const result = await loadCredentials({ title: t('biometricPromptTitle'), cancel: t('biometricPromptCancel') });
        if (result.status !== 'ok') return;
        setEmail(result.email); setPassword(result.password);
        await handleSubmitWith(result.email, result.password);
      }}
    />
  ) : null}
  ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/loginScreenBiometric.test.tsx`
Expected: PASS (6).

- [ ] **Step 5: Run tsc + auth cluster**

Run: `npx tsc --noEmit && npx jest __tests__/loginScreenBiometric.test.tsx __tests__/restoreUserRefresh.test.ts __tests__/sessionStoreCredentials.test.ts`
Expected: tsc 0; all pass.

- [ ] **Step 6: Commit**

```bash
git add src/screens/auth/LoginScreen.tsx __tests__/loginScreenBiometric.test.tsx
git commit -m "feat(登录): 登录页 focus 自动生识别登录 / 预填 / 重试 + 自愈"
```

---

## Task 8: Settings "clear saved login" row

**Files:** `src/screens/settings/SettingsScreen.tsx`

> The project's toast is the zustand `useToastStore`; the action is `show(message, type?)`. There is NO `showToast` function. `SettingsScreen` already does `useTranslation('settings')`, so `t('clearCredentialsConfirm')` is sufficient (no `ns` arg).

- [ ] **Step 1: Wire the row**

In `src/screens/settings/SettingsScreen.tsx`:
- `import { useToastStore } from '../../store/toastStore';` (if not already).
- `const show = useToastStore(s => s.show);`
- `const clearSavedCredentials = useSessionStore(s => s.clearSavedCredentials);`
- In the account `GlassPanel`, add a row (follow the existing destructive-row pattern):
  ```tsx
  <TouchableOpacity
    testID="settings-clear-credentials"
    onPress={async () => {
      await clearSavedCredentials();
      show(t('clearCredentialsConfirm'));
    }}>
    <Text>{t('clearCredentialsLabel')}</Text>
  </TouchableOpacity>
  ```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add src/screens/settings/SettingsScreen.tsx
git commit -m "feat(设置): 清除保存的登录信息入口"
```

---

## Task 9: Plain-mode informed-consent toast (first plain save only)

**Files:** `stores/useSettingsStore.ts`

- [ ] **Step 1: Behavior**

On the FIRST successful plain-mode save (biometry unavailable), show `plainModeSavedNotice` once. Track via AsyncStorage `@plain_save_notice_shown`. Use `useToastStore.getState().show(...)` from within the store action (the store is a zustand module; `useToastStore.getState()` is callable outside React).

- [ ] **Step 2: Add a test**

Extend `__tests__/sessionStoreCredentials.test.ts`:
```ts
import { useToastStore } from '../src/store/toastStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('plain-mode informed-consent toast', () => {
  beforeEach(() => { jest.clearAllMocks(); __resetSessionAuthHubForTest(); setSessionInvalidationHandler(() => {}); });

  test('first plain save shows the notice once, with the i18n string', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (k: string) => (k === '@plain_save_notice_shown' ? null : null));
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (apiLogin as jest.Mock).mockImplementation(async () => goodSession());
    (saveCredentials as jest.Mock).mockResolvedValue('plain');
    const showSpy = jest.spyOn(useToastStore.getState(), 'show');
    await useSessionStore.getState().login('a@b.c', 'pw');
    await flush();
    expect(showSpy).toHaveBeenCalledTimes(1);
    // Lock the i18n string so Chinese users don't get an English placeholder.
    expect(showSpy).toHaveBeenCalledWith(expect.stringContaining('生物识别'));
    showSpy.mockRestore();
  });

  test('second plain save does NOT re-show', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (k: string) => (k === '@plain_save_notice_shown' ? '1' : null));
    (apiLogin as jest.Mock).mockImplementation(async () => goodSession());
    (saveCredentials as jest.Mock).mockResolvedValue('plain');
    const showSpy = jest.spyOn(useToastStore.getState(), 'show');
    await useSessionStore.getState().login('a@b.c', 'pw');
    await flush();
    expect(showSpy).not.toHaveBeenCalled();
    showSpy.mockRestore();
  });
});
```
Note: this test file already mocks AsyncStorage? It does NOT (Task 6's file mocks `../src/api/account` etc. but not AsyncStorage). Add `jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }))` at the top if not present.

- [ ] **Step 3: Implement minimally in the store**

The store is a non-React module, so use the exported i18next singleton directly (`src/i18n/index.ts` default-exports it). In `login`'s save block, after `writeCredentialFlag`, if `mode === 'plain'`:
```ts
import i18n from '../src/i18n'; // at top of useSettingsStore.ts (non-React i18n access)
// …inside login, after writeCredentialFlag:
try {
  const shown = await AsyncStorage.getItem('@plain_save_notice_shown');
  if (!shown) {
    useToastStore.getState().show(i18n.t('auth:plainModeSavedNotice'));
    await AsyncStorage.setItem('@plain_save_notice_shown', '1');
  }
} catch { /* best-effort */ }
```
(Confirm `src/i18n/index.ts` default-exports the i18next instance before importing; if it's a named export, adjust the import. The notice string itself comes from the `auth` namespace keys added in Task 1 — Chinese users see "此设备未启用生物识别，已保存的登录信息将以无门禁方式存储。".)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx jest __tests__/sessionStoreCredentials.test.ts`
Expected: tsc 0; all pass.

- [ ] **Step 5: Commit**

```bash
git add stores/useSettingsStore.ts __tests__/sessionStoreCredentials.test.ts
git commit -m "feat(登录): 无生识别设备首次裸存提示一次"
```

---

## Task 10: Native rebuild + on-device verification (manual, not unit-testable)

- [ ] **Step 1: Build (New Arch Codegen)**

```bash
cd ios && RCT_NEW_ARCH_ENABLED=1 bundle exec pod install && cd ..
# confirm ios/Podfile has :fabric_enabled => true / :new_arch_enabled => true (it does — this repo is New Arch ON)
npm run android   # or npm run android:release for a shippable build
```
(`react-native-keychain` v10 is a TurboModule; the `RCT_NEW_ARCH_ENABLED=1` pod install generates the Codegen spec. Without it you can get stale bridge headers.)

- [ ] **Step 2: Verify on device**

1. Fresh install → login with email+password → succeeds.
2. Logout → login screen appears → biometric prompt fires automatically → success → logged in.
3. Cancel the biometric prompt → "使用 Face ID / 指纹登录" retry button shown; manual entry still works.
4. Settings → "清除保存的登录信息" → back to login screen → no biometric prompt, empty form (flag cleared).
5. On a biometry-less device/emulator → after login, form is prefilled on next launch; first plain save shows the one-time notice toast.
6. Regression: the existing refresh-on-launch flow still works (no double-login).

- [ ] **Step 3: Commit any device-found fixes; do NOT push until the user verifies.**

---

## Out of scope / future

- Multi-account credential store.
- Settings toggle to disable biometric (current "clear" is the off-switch).
- Biometric re-prompt for in-app sensitive actions.
- Per-OEM biometric fixes (address if a specific device misbehaves post-ship).
