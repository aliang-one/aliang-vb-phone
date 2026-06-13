import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchCurrentUser,
  loginWithPassword,
  normalizePlatformUser,
  type PlatformUser,
} from '../src/api/auth';
import { setApiAuthToken } from '../src/api/client';

interface SessionState {
  hasHydrated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  user: PlatformUser | null;
  operatorName: string;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  restoreUser: () => Promise<void>;
  logout: () => void;
  setOperatorName: (operatorName: string) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      accessToken: null,
      refreshToken: null,
      user: null,
      operatorName: 'Aliang',
      isAuthenticated: false,
      login: async (email, password) => {
        const normalizedEmail = email.trim().toLowerCase();
        const payload = await loginWithPassword({
          email: normalizedEmail,
          password,
        });
        const token = payload.access_token || payload.session_token || '';
        if (!token.trim()) {
          throw new Error('平台没有返回可用会话，请检查 server 的 AUTH_MODE/JWT_SECRET 配置。');
        }

        setApiAuthToken(token);
        let user = normalizePlatformUser(payload.user, normalizedEmail);
        try {
          user = await fetchCurrentUser();
        } catch {
          // The login response already carries enough user information.
        }

        set({
          accessToken: token,
          refreshToken: payload.refresh_token || token,
          user,
          operatorName: user.name || user.email,
          isAuthenticated: true,
        });
      },
      restoreUser: async () => {
        const token = get().accessToken;
        if (!token) return;
        setApiAuthToken(token);
        const user = await fetchCurrentUser();
        set({
          user,
          operatorName: user.name || user.email,
          isAuthenticated: true,
        });
      },
      logout: () => {
        setApiAuthToken(null);
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
        });
      },
      setOperatorName: operatorName =>
        set({ operatorName: operatorName.trim() || 'Aliang' }),
    }),
    {
      name: 'console-profile-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: persistedState => ({
        ...(persistedState as Partial<SessionState>),
        hasHydrated: false,
        isAuthenticated: Boolean((persistedState as Partial<SessionState>)?.accessToken),
      }),
      partialize: state => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        operatorName: state.operatorName,
      }),
      onRehydrateStorage: () => state => {
        const token = state?.accessToken;
        setApiAuthToken(token);
        useSessionStore.setState({
          hasHydrated: true,
          operatorName: state?.user?.name || state?.operatorName || 'Aliang',
          isAuthenticated: Boolean(token),
        });
      },
    },
  ),
);

export const useConsoleProfileStore = useSessionStore;
