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
        if (!get().token) {
          throw new Error('登录后才能连接平台服务。');
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
      version: 3,
      migrate: persistedState => ({
        ...(persistedState as Partial<SessionState>),
        hasHydrated: false,
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

export const useConsoleProfileStore = useSessionStore;
