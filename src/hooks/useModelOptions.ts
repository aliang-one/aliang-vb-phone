import { useEffect, useMemo, useState } from 'react';
import { ApiResponseError } from '../api/client';
import {
  fetchModelOptions,
  type CatalogProvider,
  type ModelOptions,
  type ProviderCatalog,
} from '../api/modelConfig';
import { effortPresetsFor, type EffortProvider } from '../utils/modelIntensity';

/**
 * Fetches the server's model/effort catalog + user default ONCE and caches it
 * in module scope so every screen that needs provider-aware effort options (the
 * session ToolsMenu, SessionSettings, the create flow, and account model cards
 * share a single network round-trip. The catalog is the SOURCE OF
 * TRUTH for the effort taxonomy; the hardcoded `EFFORT_PRESETS` ladder is only a
 * fallback for the brief window before this resolves or when the fetch fails.
 *
 * Returns a stable result object; re-renders only fire on load/error transitions.
 */
interface CachedModelOptions {
  data: ModelOptions | null;
  loading: boolean;
  error: string | null;
}

let cached: CachedModelOptions = { data: null, loading: false, error: null };
let inflight: Promise<ModelOptions | null> | null = null;
// Bump to force a refetch across all subscribers (e.g. after the user edits
// their preset library / user defaults on the account screen).
let cacheEpoch = 0;

const fallbackModelOptions: ModelOptions = {
  provider_catalog: [
    { provider: 'codex', models: [], efforts: effortPresetsFor('codex') },
    { provider: 'claude_code', models: [], efforts: effortPresetsFor('claude_code') },
  ],
  presets: [],
  user_default: {
    provider: null,
    model: null,
    effort: null,
  },
  server_default: {
    provider: null,
    model: null,
    effort: null,
  },
};

async function loadModelOptions(): Promise<ModelOptions | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await fetchModelOptions();
      cached = { data, loading: false, error: null };
      cacheEpoch += 1;
      return data;
    } catch (err) {
      if (err instanceof ApiResponseError && err.status === 404) {
        cached = { data: fallbackModelOptions, loading: false, error: null };
        cacheEpoch += 1;
        return fallbackModelOptions;
      }
      cached = {
        data: cached.data,
        loading: false,
        error: err instanceof Error ? err.message : '加载模型目录失败',
      };
      cacheEpoch += 1;
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Force every `useModelOptions` subscriber to refetch on next render. */
export const refreshModelOptions = (): void => {
  cacheEpoch += 1;
};

export interface UseModelOptionsResult {
  data: ModelOptions | null;
  loading: boolean;
  error: string | null;
  /** The provider_catalog array (empty until loaded). */
  providerCatalog: ProviderCatalog[];
  /** User-level default provider/model/effort. */
  userDefault: NonNullable<ModelOptions['user_default']>;
  /** Backward-compatible alias for older device-default UI. */
  serverDefault: ModelOptions['server_default'];
  refresh: () => void;
}

/**
 * Resolve the selectable effort options for a provider from the live catalog,
 * falling back to the hardcoded ladder. Pure helper (no hook) so callers can use
 * it outside React too.
 */
export const catalogEffortOptions = (
  provider: EffortProvider | CatalogProvider | undefined,
  catalog: ReadonlyArray<ProviderCatalog> | undefined,
): Array<{ label: string; value: string }> => {
  const resolved = provider ?? 'codex';
  if (catalog && catalog.length) {
    const entry = catalog.find(item => item.provider === resolved);
    if (entry && entry.efforts && entry.efforts.length) {
      const efforts = [...entry.efforts];
      if (!efforts.some(option => option.value === '')) {
        efforts.unshift({ label: '默认', value: '' });
      }
      return efforts;
    }
  }
  return effortPresetsFor(resolved);
};

export const useModelOptions = (): UseModelOptionsResult => {
  const [localEpoch, setLocalEpoch] = useState(cacheEpoch);
  const [state, setState] = useState<CachedModelOptions>(cached);

  useEffect(() => {
    // If this subscriber mounted after the epoch advanced (cache already warm),
    // adopt the cached data immediately without refetching.
    if (cacheEpoch !== localEpoch) {
      setLocalEpoch(cacheEpoch);
      setState(cached);
    }
    if (!cached.data && !cached.loading && !inflight) {
      setState(prev => ({ ...prev, loading: true }));
      void loadModelOptions().then(data => {
        setState({ data, loading: false, error: cached.error });
      });
    }
  }, [localEpoch]);

  const refresh = () => {
    void loadModelOptions().then(data => {
      setState({ data, loading: false, error: cached.error });
    });
  };

  const providerCatalog = useMemo(
    () => state.data?.provider_catalog ?? [],
    [state.data],
  );
  const userDefault = useMemo(
    () =>
      state.data?.user_default ??
      state.data?.server_default ?? {
        provider: null,
        model: null,
        effort: null,
      },
    [state.data],
  );
  const serverDefault = userDefault;

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    providerCatalog,
    userDefault,
    serverDefault,
    refresh,
  };
};
