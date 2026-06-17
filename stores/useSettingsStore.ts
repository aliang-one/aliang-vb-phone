import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchCurrentUser,
  login as apiLogin,
  logout as apiLogout,
  type PlatformUser,
} from '../src/api/auth';
import {
  fetchAccountPortalData,
  type AccountPortalData,
} from '../src/api/account';
import { setApiAuthTokenProvider } from '../src/api/client';
import {
  SessionExpiredError,
  decodeJwtExp,
  isJwtExpired,
  notifySessionInvalidated,
  setSessionInvalidationHandler,
} from '../src/api/sessionAuth';
import { useControlCenterStore } from '../src/store/controlCenterStore';

interface SessionState {
  hasHydrated: boolean;
  user: PlatformUser | null;
  token: string | null;
  operatorName: string;
  accountData: AccountPortalData | null;
  restoreUser: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAccountData: () => Promise<void>;
  setOperatorName: (operatorName: string) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      user: null,
      token: null,
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
          // Locally-known expiry: tear the session down via the central hub
          // (clears token/user, resets the realtime pipeline) so the app
          // returns to Login without a wasted /api/auth/me round-trip.
          notifySessionInvalidated();
          throw new SessionExpiredError('登录已过期，请重新登录。');
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
          operatorName: session.user.name || session.user.email,
        });
        try {
          await get().refreshAccountData();
        } catch {
          // The app can still enter the workspace if account metrics are delayed.
        }
      },
      logout: async () => {
        try {
          await apiLogout();
        } catch {
          // Local sign-out should still complete when the server is unavailable.
        }
        set({
          user: null,
          token: null,
          operatorName: 'Aliang',
          accountData: null,
        });
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
      version: 4,
      migrate: persistedState => ({
        ...(persistedState as Partial<SessionState>),
        hasHydrated: false,
        // v4: accountData shape changed (typed plan/orders); drop stale cache so
        // the Me page re-fetches with the real Aliang SaaS endpoints.
        accountData: null,
      }),
      partialize: state => ({
        user: state.user,
        token: state.token,
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

// Register the single session-invalidation handler. The HTTP client and the
// WebSocket call notifySessionInvalidated() on a 401 / invalid-token / auth
// close; this clears the persisted session (so RootNavigator flips to Login
// and new requests stop attaching the dead token) and tears down the realtime
// pipeline.
setSessionInvalidationHandler(() => {
  useSessionStore.setState({
    user: null,
    token: null,
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
