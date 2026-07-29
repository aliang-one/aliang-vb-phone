import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchCurrentUser,
  login as apiLogin,
  logout as apiLogout,
  refreshSessionTokens,
  type PlatformUser,
} from '../src/api/auth';
import {
  fetchAccountPortalData,
  type AccountPortalData,
} from '../src/api/account';
import { setApiAuthTokenProvider } from '../src/api/client';
import { platformTransport } from '../src/services/platformTransport';
import { isActiveTerminalSessionStatus } from '../src/utils/terminalInteraction';
import { Alert } from 'react-native';
import {
  saveCredentials,
  probeBiometry,
  clearCredentials,
  readCredentialFlag,
  writeCredentialFlag,
} from '../src/services/credentialStore';
import { useToastStore } from '../src/store/toastStore';
import i18n from '../src/i18n';
import {
  SessionExpiredError,
  decodeJwtExp,
  isJwtExpired,
  notifySessionInvalidated,
  setSessionInvalidationHandler,
  setSessionRefresher,
} from '../src/api/sessionAuth';
import { useControlCenterStore } from '../src/store/controlCenterStore';

// Informed-consent prompt before a biometric-gated credential save. Android's
// setGenericPassword(accessControl) prompts fingerprint on WRITE, so we ask
// FIRST: the user can decline (→ plain save, password still prefilled next time)
// or accept (→ biometric save, which then triggers the system fingerprint prompt).
// cancelable:false forces a choice so the Promise can't hang on an Android
// back-press / outside-tap dismiss.
function confirmBiometricEnable(): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(
      i18n.t('auth:biometricEnableTitle'),
      i18n.t('auth:biometricEnableMessage'),
      [
        { text: i18n.t('auth:biometricEnableLater'), style: 'cancel', onPress: () => resolve(false) },
        { text: i18n.t('auth:biometricEnableEnable'), onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

interface SessionState {
  hasHydrated: boolean;
  user: PlatformUser | null;
  token: string | null;
  /** sub2api refresh_token (rotated on each refresh); null = refresh unavailable. */
  refreshToken: string | null;
  operatorName: string;
  accountData: AccountPortalData | null;
  restoreUser: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Forget the saved login (Keychain entry + the non-sensitive flag). Wired to
   * the Settings "clear saved login" row; logout does NOT call this.
   */
  clearSavedCredentials: () => Promise<void>;
  /**
   * Rotate the refresh_token and extend the local session server-side. Returns
   * true on success (caller retries/reconnects), false when refresh is
   * impossible or failed (caller tears down). Registered with the sessionAuth
   * hub so the HTTP clients and WebSocket can trigger it transparently.
   */
  refreshSession: () => Promise<boolean>;
  refreshAccountData: () => Promise<void>;
  setOperatorName: (operatorName: string) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      user: null,
      token: null,
      refreshToken: null,
      operatorName: 'Aliang',
      accountData: null,
      restoreUser: async () => {
        const token = get().token;
        if (!token) {
          throw new Error('登录后才能连接平台服务。');
        }
        // Local JWT-expiry pre-check: if the access_token's `exp` is already in
        // the past, skip the wasted /api/auth/me round-trip and tear the session
        // down immediately. decodeJwtExp returns undefined for non-JWT tokens
        // (local ut_ tokens), which we leave to the server to validate.
        const exp = decodeJwtExp(token);
        if (exp && isJwtExpired(exp)) {
          // Access JWT expired (~24h TTL). The reactive 401→refresh path only
          // fires while the app is making requests; on a cold launch AFTER the
          // token lapsed it never runs, so a still-valid refresh_token was
          // wasted and the user was forced to re-login roughly every day.
          // Rotate the access token via the refresh_token first — only tear the
          // session down when there is no refresh_token or the refresh itself
          // fails (refresh_token also stale). refreshSession() persists the
          // fresh token, so fall through and load the user with it.
          const refreshed = await get().refreshSession();
          if (!refreshed) {
            notifySessionInvalidated();
            throw new SessionExpiredError('登录已过期，请重新登录。');
          }
        }
        const user = await fetchCurrentUser();
        set({
          user,
          operatorName: user.name || user.email,
        });
        try {
          await get().refreshAccountData();
        } catch {
          // Account usage should not block restoring the local workspace.
        }
      },
      login: async (email, password) => {
        const session = await apiLogin(email, password);
        set({
          user: session.user,
          token: session.token,
          refreshToken: session.refreshToken,
          operatorName: session.user.name || session.user.email,
        });
        try {
          await get().refreshAccountData();
        } catch {
          // The app can still enter the workspace if account metrics are delayed.
        }
        // Silently remember credentials for biometric one-tap login. Best-effort:
        // a save failure must NEVER block login. The returned mode drives the
        // non-sensitive flag so the login screen knows whether to show the entry.
        try {
          const emailTrim = email.trim();
          const existingFlag = await readCredentialFlag();
          // SKIP re-saving when the credential is already stored for THIS account.
          // On Android, setGenericPassword with biometric accessControl prompts
          // fingerprint on WRITE — re-saving every login would ask for fingerprint
          // right after every password login (the "I just typed my password, why
          // fingerprint?" bug). Only save (and prompt) the first time per account.
          if (existingFlag.savedAccount === emailTrim) {
            // Already saved. Still reconcile the flag in case it was hand-cleared
            // out from under us, but do NOT re-prompt.
          } else {
            // Gate the biometric-gated save behind explicit consent: on Android,
            // setGenericPassword(accessControl) prompts fingerprint on WRITE — so
            // we ask FIRST when the device advertises biometry. Decline → plain
            // save (password still prefilled next time, no prompt); accept →
            // biometric save (which triggers the system fingerprint prompt the
            // user just consented to).
            let forcePlain = false;
            if (await probeBiometry()) {
              forcePlain = !(await confirmBiometricEnable());
            }
            const mode = forcePlain
              ? await saveCredentials(emailTrim, password, { forcePlain: true })
              : await saveCredentials(emailTrim, password);
            await writeCredentialFlag({
              hasCreds: !!mode,
              usesBiometry: mode === 'biometric',
              savedAccount: mode ? emailTrim : null,
            });
            // Informed consent: on the FIRST plain-mode save (biometry unavailable),
            // tell the user once. Subsequent plain saves stay silent.
            if (mode === 'plain') {
              try {
                const shown = await AsyncStorage.getItem('@plain_save_notice_shown');
                if (!shown) {
                  useToastStore.getState().show(i18n.t('auth:plainModeSavedNotice'));
                  await AsyncStorage.setItem('@plain_save_notice_shown', '1');
                }
              } catch {
                /* best-effort */
              }
            }
          }
        } catch {
          // never block login
        }
      },
      logout: async () => {
        // Best-effort: close any active remote terminals before the token is
        // cleared, so shells don't linger on the device after sign-out. The
        // server idle-timeout reaper is the ultimate backstop; this just makes
        // manual sign-out prompt. Failures (e.g. already-expired token) are
        // swallowed — sign-out must still complete.
        try {
          const activeTerminals = useControlCenterStore
            .getState()
            .terminalSessions.filter(t =>
              isActiveTerminalSessionStatus(t.status),
            );
          await Promise.all(
            activeTerminals.map(t =>
              platformTransport.closeTerminalSession(t.id).catch(() => {}),
            ),
          );
        } catch {
          // Best-effort only.
        }
        try {
          await apiLogout();
        } catch {
          // Local sign-out should still complete when the server is unavailable.
        }
        set({
          user: null,
          token: null,
          refreshToken: null,
          operatorName: 'Aliang',
          accountData: null,
        });
      },
      clearSavedCredentials: async () => {
        // Ordered: clear the keychain first, then the flag. NON-atomic — a crash
        // between the two is covered by the LoginScreen self-heal.
        await clearCredentials();
        await writeCredentialFlag({ hasCreds: false, usesBiometry: false, savedAccount: null });
      },
      refreshSession: async () => {
        const current = get().refreshToken;
        if (!current) return false;
        try {
          const { token, refreshToken } = await refreshSessionTokens(current);
          // /api/auth/refresh returns a fresh access JWT AND a rotated
          // refresh_token. Persist both: the access token is NOT stable across
          // refresh, so keeping the stale one strands the app — the post-refresh
          // retry reuses the dead token and 401s again. Strict refresh_token
          // rotation → persist immediately so a concurrent refresh never reuses
          // the invalidated old one (which would nuke the whole token family
          // server-side).
          set({ token, refreshToken });
          return true;
        } catch {
          // A failed refresh (e.g. refresh_token stale after ≥2 missed
          // rotations) is unrecoverable — the caller (sessionAuth.refreshSession)
          // tears the session down. Do not mutate stored state here.
          return false;
        }
      },
      refreshAccountData: async () => {
        if (!get().token) {
          throw new Error('登录后才能获取套餐和用量数据。');
        }
        const accountData = await fetchAccountPortalData();
        set({ accountData });
      },
      setOperatorName: operatorName =>
        set({ operatorName: operatorName.trim() || 'Aliang' }),
    }),
    {
      name: 'console-profile-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 5,
      migrate: persistedState => ({
        ...(persistedState as Partial<SessionState>),
        hasHydrated: false,
        // v4: accountData shape changed (typed plan/orders); drop stale cache so
        // the Me page re-fetches with the real Aliang SaaS endpoints.
        accountData: null,
        // v5: refresh_token added; old persisted state has none → null disables
        // refresh (legacy re-login-on-expiry behavior) until the next login.
        refreshToken: null,
      }),
      partialize: state => ({
        user: state.user,
        token: state.token,
        refreshToken: state.refreshToken,
        operatorName: state.operatorName,
        accountData: state.accountData,
      }),
      onRehydrateStorage: () => state => {
        useSessionStore.setState({
          hasHydrated: true,
          operatorName: state?.user?.name || state?.operatorName || 'Aliang',
        });
      },
    },
  ),
);

setApiAuthTokenProvider(() => useSessionStore.getState().token);

// Register the session refresher: the HTTP clients and the WebSocket call
// refreshSession() on a 401 / auth rejection to rotate the refresh_token and
// extend the local session server-side, recovering a transiently-expired
// session (e.g. after the phone was offline) without forcing re-login.
setSessionRefresher(() => useSessionStore.getState().refreshSession());

// Register the single session-invalidation handler. The HTTP client and the
// WebSocket call notifySessionInvalidated() on a 401 / invalid-token / auth
// close; this clears the persisted session (so RootNavigator flips to Login
// and new requests stop attaching the dead token) and tears down the realtime
// pipeline.
setSessionInvalidationHandler(() => {
  useSessionStore.setState({
    user: null,
    token: null,
    refreshToken: null,
    operatorName: 'Aliang',
    accountData: null,
  });
  try {
    useControlCenterStore.getState().resetSessionData();
  } catch {
    // If the realtime store isn't ready, clearing the token is enough to
    // return the user to Login; the pipeline stays inert without a token.
  }
});

export const useConsoleProfileStore = useSessionStore;
