import { apiGet, apiPut } from './client';
import type { EffortProvider } from '../utils/modelIntensity';

/**
 * Model + effort catalog + preset library served by the platform service.
 *
 * The server (`GET /api/me/model-options`) is the SOURCE OF TRUTH for the
 * model/effort taxonomy and the user's personal preset library. The phone's
 * hardcoded `EFFORT_PRESETS` / `MODEL_PRESETS_BY_PROVIDER` (see
 * `modelIntensity.ts`) are a FALLBACK only — used before the catalog loads or
 * when the fetch fails.
 */

/** Provider discriminant as carried by the catalog (mirrors EffortProvider). */
export type CatalogProvider = EffortProvider;

/** A selectable model id within a provider's catalog. */
export interface CatalogModelOption {
  value: string;
  label: string;
  /** Deprecated models the operator is sunsetting; rendered but flagged. */
  deprecated?: boolean;
}

/** A selectable reasoning-effort level within a provider's catalog. */
export interface CatalogEffortOption {
  value: string;
  label: string;
}

/** Per-provider catalog: its model ladder + effort ladder. */
export interface ProviderCatalog {
  provider: CatalogProvider;
  models: CatalogModelOption[];
  efforts: CatalogEffortOption[];
}

/** The user's saved personal preset (label + provider/model/effort, any nullable). */
export interface ModelPreset {
  id: string;
  label: string;
  provider: CatalogProvider;
  /** Concrete model id; null/undefined = inherit server default. */
  model?: string | null;
  /** Reasoning effort; null/undefined = inherit server default. */
  effort?: string | null;
}

/** Effective model config (server's resolved view: value + where it came from). */
export interface EffectiveModelConfig {
  provider?: CatalogProvider | null;
  model?: string | null;
  effort?: string | null;
  /**
   * Provenance of each resolved field (e.g. 'session' | 'project' | 'device' |
   * 'server'). The phone only displays it as a hint, so keep it loose.
   */
  source?: {
    provider?: string;
    model?: string;
    effort?: string;
  };
}

export interface ProviderModelSelection {
  model?: string | null;
  effort?: string | null;
}

export type ProjectProviderModelConfig = Partial<
  Record<CatalogProvider, ProviderModelSelection>
>;

/** Response shape for `GET /api/me/model-options`. */
export interface ModelOptions {
  provider_catalog: ProviderCatalog[];
  presets: ModelPreset[];
  user_default?: {
    provider?: CatalogProvider | null;
    model?: string | null;
    effort?: string | null;
  };
  /** Backward-compatible alias; currently mirrors user_default from the server. */
  server_default: {
    provider?: CatalogProvider | null;
    model?: string | null;
    effort?: string | null;
  };
}

/** Response shape for `GET /api/me/model-presets`. */
export interface ModelPresetsResponse {
  presets: ModelPreset[];
}

export interface UserModelDefault {
  provider?: CatalogProvider | null;
  model?: string | null;
  effort?: string | null;
}

/** Body for legacy device/project model-config endpoints. */
export interface ModelConfigPatch {
  provider?: string | null;
  model?: string | null;
  effort?: string | null;
  model_config?: ProjectProviderModelConfig | null;
}

/** Fetch the full model/effort catalog + the user's presets + server default. */
export const fetchModelOptions = (): Promise<ModelOptions> =>
  apiGet<ModelOptions>('/api/me/model-options');

/** Fetch just the user's personal preset library. */
export const getUserPresets = (): Promise<ModelPresetsResponse> =>
  apiGet<ModelPresetsResponse>('/api/me/model-presets');

/** Whole-replace the user's personal preset library (≤50 entries). */
export const putUserPresets = (
  presets: ModelPreset[],
): Promise<ModelPresetsResponse> =>
  apiPut<ModelPresetsResponse>('/api/me/model-presets', { presets });

export const getUserModelDefault = (): Promise<UserModelDefault> =>
  apiGet<UserModelDefault>('/api/me/model-default');

export const putUserModelDefault = (
  patch: UserModelDefault,
): Promise<UserModelDefault> =>
  apiPut<UserModelDefault>('/api/me/model-default', patch);

/**
 * Override a device's model config. Each field is `string | null`: null clears
 * the override (→ inherits the server default). Returns the updated device.
 */
export const putDeviceModelConfig = (
  deviceId: string,
  patch: ModelConfigPatch,
): Promise<unknown> =>
  apiPut<unknown>(`/api/devices/${encodeURIComponent(deviceId)}/model-config`, patch);

/**
 * Override a project's model config. Each field is `string | null`: null clears
 * the override (→ inherits the device default). Returns the updated project.
 */
export const putProjectModelConfig = (
  projectId: string,
  patch: ModelConfigPatch,
): Promise<unknown> =>
  apiPut<unknown>(
    `/api/projects/${encodeURIComponent(projectId)}/model-config`,
    patch,
  );
