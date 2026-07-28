# Biometric one-tap login ("记住密码")

**Date:** 2026-07-28
**Status:** Approved design (post spec-review round 1 fixes), pending implementation plan
**Scope:** `AliangVibeCodingPhone` (phone app only; zero server change)

## Problem

The login screen (`src/screens/auth/LoginScreen.tsx`) today remembers nothing —
every time the user reaches it (manual logout, or session expiry beyond the
refresh_token's lifetime), they must retype email AND password. The recent
refresh-on-launch fix (`stores/useSettingsStore.ts` `restoreUser`) eliminated
the ~24h forced re-login, but a residual re-login surface remains for the
genuinely-expired case. The user wants **biometric one-tap login**: when they
land on the login screen, Face ID / fingerprint unlocks stored credentials and
logs them in automatically.

## Goals

1. After a successful login, silently save credentials (email + password) to
   the OS secure store (Android Keystore / iOS Keychain).
2. On the login screen, if saved credentials exist:
   - **Biometry available** → auto-prompt Face ID/fingerprint on screen focus;
     success → auto-submit → logged in.
   - **Biometry unavailable** (old device / not enrolled) → prefill email +
     password into the form; user taps Sign In.
3. Manual email/password entry is always available (switch account, fallback).
4. A Settings action to clear saved credentials (the "stop remembering" exit,
   and a debugging tool).

## Assumptions

- **Single-user personal device.** The phone is one user's own. The
  cross-account case (user B sits down at a device that previously stored user
  A's biometric-gated credentials) is **out of scope** for v1; mitigations
  would add friction that hurts the single-user majority. Documented as a
  non-goal. The biometric gate itself prevents user B from reading A's
  credentials without A's biometry.

## Non-goals (v1)

- Multi-account credential store (one credential set; re-login overwrites).
- A Settings toggle to enable/disable biometric login (default on; the Settings
  "clear" action is the off-switch).
- Biometric re-prompt for in-app sensitive actions (only login).
- Server-side revocation of stored credentials.
- Cross-account protection on shared devices (see Assumptions).

## Architecture

### New dependency

`react-native-keychain` v10+ — the standard bare-RN library; one dependency
covers both Android Keystore / iOS Keychain secure storage AND biometric access
control. v10+ is a TurboModule with a Codegen spec compatible with the New
Architecture (RN 0.85.3). Requires a **native rebuild**:
- iOS: `cd ios && RCT_NEW_ARCH_ENABLED=1 bundle exec pod install` (Codegen).
- Android: gradle picks it up on next build.
- This is NOT a JS-only change — a full rebuild is required.

### Platform configuration

- **iOS:** add `NSFaceIDUsageDescription` to `Info.plist` (required for Face ID;
  without it the prompt throws `BIOMETRIC_NOT_ENROLLED`/security exception).
- **Android:** add `<uses-permission android:name="android.permission.USE_BIOMETRIC"/>`
  to `AndroidManifest.xml`.

### Components

**`src/services/credentialStore.ts`** (new) — the only module that touches
`react-native-keychain`. Small surface, testable via a keychain mock.

- `pickStorageMode(biometryType: string | null): 'biometric' | 'plain'` — pure
  function. `biometryType` is one of the BIOMETRY_TYPE enum strings
  (`'FaceID' | 'TouchID' | 'Fingerprint' | 'Face' | 'Iris'`) or `null`. **Any
  non-null value → `'biometric'`; `null` → `'plain'`.** Never compare to a
  hard-coded key name. Extracted for unit testing with the real enum strings.
- `saveCredentials(email: string, password: string): Promise<'biometric' |
  'plain' | null>` — probes `Keychain.getSupportedBiometryType()` (which resolves
  `null` when the native module can't answer / no biometry). Stores via
  `setGenericPassword`:
  - biometric mode → `{ accessControl: ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
    accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    storage: Keychain.STORAGE_TYPES.AES (iOS) / securityLevel:
    SECURE_STORAGE.SECURE_HARDWARE (Android) }`;
  - plain mode → no `accessControl` (still Keystore/Keychain-encrypted at rest).
  Returns the mode used so the caller can write the flag. Best-effort: on ANY
  thrown error, returns `null` and the caller writes `hasCreds:false` — a save
  failure MUST NOT block login.
- `loadCredentials(authenticationPrompt): Promise<LoadResult>` where
  `LoadResult = { status: 'ok'; email; password } | { status: 'cancelled' } |
  { status: 'unavailable' }`. Calls `Keychain.getGenericPassword({ service,
  authenticationPrompt })`. `authenticationPrompt` is the nested
  `{ title, subtitle?, description?, cancel? }` (Android subtitle/description/
  cancel; iOS title only). Import the type as a named
  `import type { AuthenticationPrompt } from 'react-native-keychain'`.
  Return contract:
  - resolves credentials → `{ status: 'ok', email, password }`.
  - resolves `false` (missing entry OR user-cancel — indistinguishable) →
    `{ status: 'cancelled' }`.
  - rejects with `error.code` ∈ `{ BIOMETRIC_NOT_ENROLLED, PASSCODE_NOT_SET, … }`
    → catch → `{ status: 'unavailable' }` (retry would fail identically).
  LoginScreen maps: `ok` → auto-submit; `cancelled` → self-heal flag + retry
  button; `unavailable` → self-heal flag + empty form (**no** retry button).
- `clearCredentials(): Promise<void>` — `resetGenericPassword({ service })`.
  `writeCredentialFlag({hasCreds:false})` is called by the CALLER only after
  this resolves, to keep flag/keychain ordered. **This is NON-atomic** — if the
  app crashes between the reset and the flag write, `hasCreds` stays stale; the
  LoginScreen self-heal (see Edge cases) covers that window, so do NOT remove
  the self-heal write thinking the ordering alone guarantees consistency.
- `readCredentialFlag() / writeCredentialFlag(flag)` — non-sensitive flag in
  AsyncStorage: `{ hasCreds: boolean; usesBiometry: boolean }`. Initial value
  on first install / when absent: `{ hasCreds: false, usesBiometry: false }`.
  **Self-heal:** if `hasCreds` is true but `loadCredentials` resolves `null`
  (missing/cancel/error), the login screen writes
  `writeCredentialFlag({hasCreds:false,...})` so a stale flag (failed clear,
  Keychain wipe, OS biometry-removed) doesn't keep triggering a pointless prompt.

A single Keychain `service` constant (e.g. `'com.aliangvibecodingphone.session'`)
with `username` = email, `password` = password. One credential set; a new login
OVERWRITES (acceptable: single-user device — see Assumptions).

**`stores/useSettingsStore.ts`** — after a successful `login(...)`, call
`saveCredentials(email, password)` then `writeCredentialFlag` with the returned
mode (fire-and-forget `.catch(() => {})`). `logout()` does NOT clear credentials
(the whole point of "remember"). Add `clearSavedCredentials()` for Settings:
`await clearCredentials(); writeCredentialFlag({hasCreds:false, usesBiometry:false});`.

**`src/screens/auth/LoginScreen.tsx`** — on focus (`useFocusEffect`):
1. Read `readCredentialFlag()` (async; render an empty form meanwhile, with a
   small loading hint).
2. If `hasCreds && usesBiometry` → call `loadCredentials(authPrompt)` once per
   focus (a `promptedRef` guards against re-prompt on re-render).
   - resolves creds → `setEmail`/`setPassword` + `handleSubmit()` automatically.
   - resolves `null` (cancel/missing/error) → `writeCredentialFlag({hasCreds:false})`
     (self-heal) and render a "使用 Face ID 登录" retry button above the form.
3. If `hasCreds && !usesBiometry` → `loadCredentials` (no meaningful prompt) →
   prefill the form; leave focus on the submit button.
4. No creds → unchanged empty form.
A `cancelledRef` aborts the auto-submit if the user starts typing before the
prompt resolves.

**`src/screens/settings/SettingsScreen.tsx`** — new row "清除保存的登录信息"
→ `clearSavedCredentials()`. Wired into the existing account/settings
`GlassPanel` section (follow the pattern of existing destructive rows there).
Confirm with a toast via the existing toast store.

**i18n** — keys land in two namespaces:
- `src/i18n/locales/auth/{en,zh}.json`: `biometricPromptTitle`,
  `biometricPromptCancel` (Android cancel label), `biometricRetry` (retry button),
  `biometricLoading` (loading hint). iOS uses only `biometricPromptTitle`.
- `src/i18n/locales/settings/{en,zh}.json`: `clearCredentialsLabel`,
  `clearCredentialsConfirm` (toast).

## Data flow

```
login success ──> useSessionStore.login
                  ├─ (existing) set token/user/refreshToken
                  └─ const mode = await saveCredentials(email,password).catch(()=>null)
                     └─ if mode: writeCredentialFlag({hasCreds:true, usesBiometry: mode==='biometric'})

app launch / logout ──> LoginScreen focus
                        ├─ readCredentialFlag()
                        │   hasCreds && usesBiometry → loadCredentials(authPrompt) [once per focus]
                        │     resolves creds → prefill + handleSubmit → login()
                        │     resolves null   → writeCredentialFlag(hasCreds:false) + retry button
                        │   hasCreds && !usesBiometry → loadCredentials (no prompt) → prefill
                        │   else → empty form
                        └─ (user can always type manually; cancelledRef aborts auto-submit)

Settings "clear" ──> clearSavedCredentials() → clearCredentials() → writeCredentialFlag({hasCreds:false})
```

## Edge cases

- **Stored password no longer valid server-side** → auto-login `login()` throws
  → show error message (same path as today). User retypes; next successful
  login silently overwrites the stale stored credential.
- **Biometric cancel ×N** → never auto-re-prompt within the same focus; user
  uses the retry button or types manually. On next app focus, auto-prompt
  resumes (one prompt per focus).
- **`getGenericPassword` rejects (`BIOMETRIC_NOT_ENROLLED` / `PASSCODE_NOT_SET`)** —
  e.g. user stored creds then removed all fingerprints / disabled device
  passcode → `loadCredentials` catches → returns `{status:'unavailable'}` →
  self-heal clears the flag → login screen shows empty form (NO retry button,
  since retry would fail identically). User logs in manually; on success,
  `saveCredentials` re-probes and stores in plain mode (biometry now unavailable).
- **Cancel vs missing are indistinguishable** at the API level (both resolve
  `false`). Mitigation: the `hasCreds` flag is the source of truth for "an
  entry should exist"; a `false` read clears the flag and shows retry (harmless
  if the entry was actually missing — retry fails, user falls back to manual).
- **Keychain save fails** (rare; disk/keystore) → swallowed; `saveCredentials`
  returns `null`; flag stays `hasCreds:false`; login still succeeds.
- **App reinstall / uninstall** → OS clears Keychain entries; AsyncStorage flag
  also resets on fresh install. Re-login required. Acceptable.
- **Flag/keychain desync** (e.g. clearCredentials succeeded but app crashed
  before writeCredentialFlag) → next focus: `hasCreds:true` but loadCredentials
  → `null` → self-heal clears the flag. Bounded to one wasted prompt.
- **Cold-start ordering** → the flag read is the only thing on the critical
  path (AsyncStorage, fast). Keychain `loadCredentials` is async; show a tiny
  loading hint so the form doesn't flash empty→filled.
- **Concurrent auto-login + manual edit** → if the user starts typing before
  the biometric prompt resolves, `cancelledRef` aborts the auto-submit.

## Testing (TDD)

- `pickStorageMode` pure-function tests: assert against the **real enum
  strings** (`'FaceID'`, `'Fingerprint'`, `'TouchID'`, `'Face'`, `'Iris'`,
  `'Iris'`) → `'biometric'`; `null` → `'plain'`.
- `credentialStore` with `react-native-keychain` mocked:
  - `saveCredentials` biometric mode → `setGenericPassword` called with
    `accessControl: ACCESS_CONTROL.BIOMETRY_CURRENT_SET`; plain mode → no
    `accessControl`. Returns the mode.
  - `saveCredentials` when `getSupportedBiometryType` itself resolves `null`
    (no biometry / module issue) → stores plain, returns `'plain'`.
  - `saveCredentials` when `setGenericPassword` throws → returns `null`, error
    swallowed.
  - `loadCredentials`: `getGenericPassword` resolves `false` → returns `null`
    (covers BOTH cancel and missing — same code path).
  - `loadCredentials`: `getGenericPassword` resolves `{username, password}` →
    returns `{email, password}`.
  - `loadCredentials`: `getGenericPassword` rejects (`error.code` set) →
    catches, returns `null`.
  - `clearCredentials` → `resetGenericPassword({service})` called.
- `useSettingsStore.login` (mocked credentialStore): successful login calls
  `saveCredentials` + writes flag with the returned mode; `logout` does NOT
  clear; `clearSavedCredentials` clears both.
- `LoginScreen` (TestRenderer + mocked credentialStore + keychain + navigation):
  - mount with `hasCreds && usesBiometry` + loadCredentials resolves creds →
    `login()` invoked automatically.
  - mount with `hasCreds && usesBiometry` + loadCredentials resolves `null`
    (cancel) → retry button rendered, `login()` NOT called, flag self-healed.
  - mount with `hasCreds && !usesBiometry` → form prefilled.
  - mount with no creds → empty form, no loadCredentials call.
- Not unit-testable (real-device verification): the native biometric prompt,
  Keychain encryption-at-rest, OS permission flows, OEM biometric quirks.

## Risks

- **New native dependency** → small bundle/size increase; iOS `pod install`;
  requires a full rebuild (not a JS-only change). Mitigation: one
  well-maintained library (`react-native-keychain`, v10+ New-Arch-compatible).
- **OEM biometric quirks** → a few Android OEMs implement biometric oddly;
  `react-native-keychain` handles the majority. If a specific device misbehaves
  post-ship, address per-device then.
- **Security posture on biometry-less devices** → we store email + password
  retrievable without a biometric prompt (the user explicitly chose this
  fallback). Keystore/Keychain still encrypts at rest + sandboxes from other
  apps. To make the trade-off visible, show a one-time toast the first time
  creds are saved in plain mode: "此设备未启用生物识别,已保存的登录信息将以无门禁方式存储"
  (informed consent). This is the only UX addition over the silent-save model.
