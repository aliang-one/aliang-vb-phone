import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { EffortProvider } from '../src/utils/modelIntensity';
import { nextRecentModels } from '../src/utils/modelHistory';

type ProviderModelHistory = Partial<Record<EffortProvider, string[]>>;

interface ModelHistoryState {
  historiesByUser: Record<string, ProviderModelHistory>;
  rememberRecentModel: (
    userId: string,
    provider: EffortProvider,
    model: string,
  ) => void;
}

export const useModelHistoryStore = create<ModelHistoryState>()(
  persist(
    set => ({
      historiesByUser: {},
      rememberRecentModel: (userId, provider, model) => {
        const normalizedUserId = userId.trim();
        const normalizedModel = model.trim();
        if (!normalizedUserId || !normalizedModel) return;

        set(state => {
          const userHistory = state.historiesByUser[normalizedUserId] ?? {};
          return {
            historiesByUser: {
              ...state.historiesByUser,
              [normalizedUserId]: {
                ...userHistory,
                [provider]: nextRecentModels(
                  userHistory[provider] ?? [],
                  normalizedModel,
                ),
              },
            },
          };
        });
      },
    }),
    {
      name: 'model-history-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: state => ({ historiesByUser: state.historiesByUser }),
    },
  ),
);
