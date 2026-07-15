export const MAX_RECENT_MODELS_PER_PROVIDER = 2;

export interface ModelOption {
  label: string;
  value: string;
}

const modelKey = (value: string): string => value.trim().toLowerCase();

/** Move a confirmed model to the front of a provider's bounded MRU list. */
export const nextRecentModels = (
  current: ReadonlyArray<string>,
  rawModel: string,
  limit = MAX_RECENT_MODELS_PER_PROVIDER,
): string[] => {
  const model = rawModel.trim();
  if (!model || limit <= 0) return [...current].slice(0, Math.max(0, limit));

  const key = modelKey(model);
  return [
    model,
    ...current.filter(item => modelKey(item) !== key),
  ].slice(0, limit);
};

/**
 * Put provider-scoped local history before the server catalog, deduplicating by
 * model id. When a historical id is still in the catalog, retain its server
 * label while moving it to the historical position.
 */
export const mergeRecentModelOptions = (
  recentModels: ReadonlyArray<string>,
  serverOptions: ReadonlyArray<ModelOption>,
): ModelOption[] => {
  const catalogByValue = new Map(
    serverOptions.map(option => [modelKey(option.value), option]),
  );
  const seen = new Set<string>();
  const merged: ModelOption[] = [];

  const append = (option: ModelOption) => {
    const value = option.value.trim();
    const key = modelKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push({ ...option, value });
  };

  for (const recent of recentModels) {
    const value = recent.trim();
    if (!value) continue;
    append(catalogByValue.get(modelKey(value)) ?? { label: value, value });
  }
  serverOptions.forEach(append);

  return merged;
};
