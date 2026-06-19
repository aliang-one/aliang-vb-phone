// Shared model + reasoning-effort helpers.
//
// CONTRACT: reasoning `effort` is a SEPARATE field, NOT baked into the model
// name. The phone sends a clean model base (e.g. "glm-5.2") plus an `effort`
// string (e.g. "xhigh"); the server persists both and conveys `effort` in
// `ai.session.create`, where the gateway derives the codex reasoning level
// from it (see server src/types.ts AiSession.effort). The phone must NEVER
// splice an effort tier into the model string.
//
// `effort` is provider-specific (codex: minimal/low/medium/high/xhigh; claude:
// low/medium/high/max). Provider-aware presets live here as the single source
// of truth for the create flow, the inline ToolsMenu, and SessionSettings.
//
// The `Intensity` / `INTENSITY_*` / `parseModelIntensity` / `composeModel`
// helpers below are LEGACY: they model the OLD (buggy) "tier as model-name
// suffix" representation. They remain only to (a) parse pre-existing baked
// model strings so we can seed the new `effort` field on first edit, and
// (b) keep existing imports compiling. Do NOT use composeModel for new saves.

/** Provider discriminant for effort presets (mirrors AgentProvider). */
export type EffortProvider = 'codex' | 'claude_code';

// Provider-aware reasoning-effort presets. "默认" (value '') means no override
// — the CLI/gateway default reasoning level is used. Single source of truth;
// the create flow, ToolsMenu, and SessionSettings all render from this.
export const EFFORT_PRESETS: Record<
  EffortProvider,
  Array<{ label: string; value: string }>
> = {
  codex: [
    { label: '默认', value: '' },
    { label: 'minimal', value: 'minimal' },
    { label: 'low', value: 'low' },
    { label: 'medium', value: 'medium' },
    { label: 'high', value: 'high' },
    { label: 'xhigh', value: 'xhigh' },
  ],
  claude_code: [
    { label: '默认', value: '' },
    { label: 'low', value: 'low' },
    { label: 'medium', value: 'medium' },
    { label: 'high', value: 'high' },
    { label: 'max', value: 'max' },
  ],
};

export const effortPresetsFor = (provider: EffortProvider) =>
  EFFORT_PRESETS[provider] ?? EFFORT_PRESETS.codex;

/**
 * Map a server session's provider/tool strings to the effort-provider
 * discriminant. Returns undefined when neither field identifies a known
 * provider (caller should apply a default). Decoupled from the session shape
 * so this util has no store/api dependency.
 */
export function normalizeProvider(
  provider?: string,
  tool?: string,
): EffortProvider | undefined {
  const value = (provider ?? tool ?? '').trim().toLowerCase();
  if (value === 'codex') return 'codex';
  if (value === 'claude' || value === 'claudecode') return 'claude_code';
  return undefined;
}

// ---- LEGACY: tier-as-model-suffix representation (parsing only) -------------

// Legacy reasoning-effort tiers that used to be spliced onto the model name.
export const INTENSITY_TIERS = ['low', 'medium', 'high', 'xhigh'] as const;
export type Intensity = 'none' | (typeof INTENSITY_TIERS)[number];

/**
 * Convert a legacy `Intensity` tier into the effort string representation
 * ('none' → ''). Used when seeding the `effort` field from a pre-existing
 * baked model string (parseModelIntensity).
 */
export const intensityToEffort = (intensity: Intensity): string =>
  intensity === 'none' ? '' : intensity;

/**
 * @deprecated LEGACY — parsing only. Best-effort conversion of an effort
 * string back into a legacy Intensity tier. Values outside the legacy tiers
 * (e.g. claude 'max', codex 'minimal') map to 'none'.
 */
export const effortToIntensity = (effort: string | undefined): Intensity => {
  const value = (effort ?? '').trim();
  return (INTENSITY_TIERS as readonly string[]).includes(value)
    ? (value as Intensity)
    : 'none';
};

// Model name presets (concrete model ids). "默认" clears the field (revert to
// the agent CLI's own default). Free text in the input overrides the chips.
export const MODEL_PRESETS: Array<{ label: string; value: string }> = [
  { label: '默认', value: '' },
  { label: 'glm-5.2', value: 'glm-5.2' },
  { label: 'gpt-5.2', value: 'gpt-5.2' },
  { label: 'gpt-5.5', value: 'gpt-5.5' },
  { label: 'claude-sonnet-4-6', value: 'claude-sonnet-4-6' },
];

/** @deprecated LEGACY — fixed tier list; superseded by provider-aware EFFORT_PRESETS. */
export const INTENSITY_OPTIONS: Array<{ label: string; value: Intensity }> = [
  { label: '默认', value: 'none' },
  { label: 'LOW', value: 'low' },
  { label: 'MEDIUM', value: 'medium' },
  { label: 'HIGH', value: 'high' },
  { label: 'XHIGH', value: 'xhigh' },
];

// `VibeCodingRun.model` is a DISPLAY label: when no concrete model is set it
// falls back to one of these provider names (see aiSessionModelLabel in
// internals.ts). Treat those as "no explicit model".
export const PROVIDER_DEFAULT_LABELS = new Set(['Claude Code', 'GPT-5 Codex']);

/**
 * Split a (possibly legacy baked) model string into base name + intensity
 * tier, e.g. "glm-5.2-xhigh" -> { base: "glm-5.2", intensity: "xhigh" }.
 * Used to seed the new `effort` field from pre-existing baked model strings
 * on first edit. Parsing only — never re-compose for saves.
 */
export const parseModelIntensity = (
  model: string | undefined,
): { base: string; intensity: Intensity } => {
  const value = (model ?? '').trim();
  if (!value || PROVIDER_DEFAULT_LABELS.has(value)) {
    return { base: '', intensity: 'none' };
  }
  const last = value.split('-').pop() ?? '';
  if ((INTENSITY_TIERS as readonly string[]).includes(last)) {
    return { base: value.slice(0, -(last.length + 1)), intensity: last as Intensity };
  }
  return { base: value, intensity: 'none' };
};

/**
 * @deprecated LEGACY — DO NOT USE for new saves. Effort is a separate field
 * now (see file header). Kept only so legacy callers compile; new code must
 * send a clean model base + a separate `effort` string.
 */
export const composeModel = (base: string, intensity: Intensity) => {
  const trimmed = base.trim();
  if (!trimmed) return ''; // no model => use the agent's default
  return intensity === 'none' ? trimmed : `${trimmed}-${intensity}`;
};
