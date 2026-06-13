import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchCurrentUser, type PlatformUser } from '../src/api/auth';

interface SessionState {
  hasHydrated: boolean;
  user: PlatformUser | null;
  operatorName: string;
  restoreUser: () => Promise<void>;
  setOperatorName: (operatorName: string) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    set => ({
      hasHydrated: false,
      user: null,
      operatorName: 'Aliang',
      restoreUser: async () => {
        const user = await fetchCurrentUser();
        set({
          user,
          operatorName: user.name || user.email,
        });
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
        operatorName: state.operatorName,
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

export const useConsoleProfileStore = useSessionStore;
