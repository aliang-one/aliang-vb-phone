import { useCallback, useMemo } from 'react';
import { useSessionStore } from '../../stores/useSettingsStore';
import { useModelHistoryStore } from '../../stores/useModelHistoryStore';
import type { EffortProvider } from '../utils/modelIntensity';
import {
  mergeRecentModelOptions,
  type ModelOption,
} from '../utils/modelHistory';

const EMPTY_RECENT_MODELS: string[] = [];

interface RecentModelOptionsResult {
  modelOptions: ModelOption[];
  rememberModel: (model: string) => void;
}

/** Merge this account's provider-specific local history ahead of server options. */
export const useRecentModelOptions = (
  provider: EffortProvider,
  serverOptions: ReadonlyArray<ModelOption>,
): RecentModelOptionsResult => {
  const userId = useSessionStore(state => state.user?.id);
  const recentModels = useModelHistoryStore(state =>
    userId
      ? state.historiesByUser[userId]?.[provider] ?? EMPTY_RECENT_MODELS
      : EMPTY_RECENT_MODELS,
  );
  const rememberRecentModel = useModelHistoryStore(
    state => state.rememberRecentModel,
  );

  const modelOptions = useMemo(
    () => mergeRecentModelOptions(recentModels, serverOptions),
    [recentModels, serverOptions],
  );
  const rememberModel = useCallback(
    (model: string) => {
      if (userId) rememberRecentModel(userId, provider, model);
    },
    [provider, rememberRecentModel, userId],
  );

  return { modelOptions, rememberModel };
};
