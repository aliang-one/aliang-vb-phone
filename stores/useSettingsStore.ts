import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  isAuthenticated: boolean;
  agentId: string;
  accessToken: string;
  login: (agentId: string, accessToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    set => ({
      isAuthenticated: false,
      agentId: '',
      accessToken: '',
      login: (agentId: string, accessToken: string) =>
        set({ isAuthenticated: true, agentId, accessToken }),
      logout: () =>
        set({ isAuthenticated: false, agentId: '', accessToken: '' }),
    }),
    {
      name: 'auth-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: () => ({
        isAuthenticated: false,
        agentId: '',
        accessToken: '',
      }),
      partialize: state => ({
        isAuthenticated: state.isAuthenticated,
        agentId: state.agentId,
        accessToken: state.accessToken,
      }),
    },
  ),
);
