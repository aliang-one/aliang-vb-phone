import {
  EFFORT_PRESETS,
  MODEL_PRESETS_BY_PROVIDER,
  availableProviders,
  catalogModelOptions,
  composeModel,
  effortOptionsFor,
  effortPresetsFor,
  effortToIntensity,
  intensityToEffort,
  modelPresetsFor,
  normalizeProvider,
  parseModelIntensity,
} from '../modelIntensity';

describe('modelIntensity · effort taxonomy', () => {
  it('codex has exactly low/medium/high/xhigh (+ inherit)', () => {
    const values = EFFORT_PRESETS.codex.map(o => o.value);
    // First entry is always the inherit option ('默认').
    expect(values[0]).toBe('');
    expect(values.slice(1)).toEqual(['low', 'medium', 'high', 'xhigh']);
    // minimal was dropped from the taxonomy.
    expect(values).not.toContain('minimal');
  });

  it('claude_code has exactly low/medium/high/xhigh/max/ultracode (+ inherit)', () => {
    const values = EFFORT_PRESETS.claude_code.map(o => o.value);
    expect(values[0]).toBe('');
    expect(values.slice(1)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultracode',
    ]);
  });

  it('each option carries a non-empty label', () => {
    for (const provider of ['codex', 'claude_code'] as const) {
      for (const option of EFFORT_PRESETS[provider]) {
        expect(option.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('effortPresetsFor returns the matching ladder and falls back to codex', () => {
    expect(effortPresetsFor('codex')).toBe(EFFORT_PRESETS.codex);
    expect(effortPresetsFor('claude_code')).toBe(EFFORT_PRESETS.claude_code);
  });
});

describe('modelIntensity · effortOptionsFor (catalog-aware)', () => {
  it('falls back to the hardcoded ladder when no catalog is supplied', () => {
    expect(effortOptionsFor('codex')).toEqual(EFFORT_PRESETS.codex);
    expect(effortOptionsFor('claude_code')).toEqual(
      EFFORT_PRESETS.claude_code,
    );
  });

  it('falls back when the catalog lacks the provider', () => {
    const catalog = [
      {
        provider: 'codex' as const,
        efforts: [{ label: 'LOW', value: 'low' }],
      },
    ];
    expect(effortOptionsFor('claude_code', catalog)).toEqual(
      EFFORT_PRESETS.claude_code,
    );
  });

  it('returns the catalog efforts for the provider, prepending an inherit option when missing', () => {
    const catalog = [
      {
        provider: 'codex' as const,
        efforts: [
          { label: 'LOW', value: 'low' },
          { label: 'XHIGH', value: 'xhigh' },
        ],
      },
    ];
    const options = effortOptionsFor('codex', catalog);
    expect(options[0]).toEqual({ label: '默认', value: '' });
    expect(options.slice(1)).toEqual([
      { label: 'LOW', value: 'low' },
      { label: 'XHIGH', value: 'xhigh' },
    ]);
  });

  it('passes the catalog through untouched when it already has an inherit entry', () => {
    const catalog = [
      {
        provider: 'claude_code' as const,
        efforts: [
          { label: 'inherit', value: '' },
          { label: 'MAX', value: 'max' },
        ],
      },
    ];
    expect(effortOptionsFor('claude_code', catalog)).toEqual([
      { label: 'inherit', value: '' },
      { label: 'MAX', value: 'max' },
    ]);
  });
});

describe('modelIntensity · provider normalization', () => {
  it('maps server provider/tool strings to the effort-provider discriminant', () => {
    expect(normalizeProvider('codex')).toBe('codex');
    expect(normalizeProvider('CODEX')).toBe('codex');
    expect(normalizeProvider(undefined, 'codex')).toBe('codex');
    expect(normalizeProvider('claude')).toBe('claude_code');
    expect(normalizeProvider('claudecode')).toBe('claude_code');
    expect(normalizeProvider('claude_code')).toBe('claude_code');
    expect(normalizeProvider('claude-code')).toBe('claude_code');
    expect(normalizeProvider('auto', 'codex')).toBe('codex');
    expect(normalizeProvider('auto', 'claudecode')).toBe('claude_code');
    expect(normalizeProvider('unknown')).toBeUndefined();
    expect(normalizeProvider(undefined, undefined)).toBeUndefined();
  });
});

describe('modelIntensity · legacy intensity mapping', () => {
  it('intensityToEffort converts tiers and clears "none"', () => {
    expect(intensityToEffort('none')).toBe('');
    expect(intensityToEffort('high')).toBe('high');
    expect(intensityToEffort('xhigh')).toBe('xhigh');
  });

  it('effortToIntensity maps legacy tiers and collapses others to none', () => {
    expect(effortToIntensity('high')).toBe('high');
    expect(effortToIntensity('xhigh')).toBe('xhigh');
    // non-legacy values collapse to 'none' (parsing-only helper).
    expect(effortToIntensity('max')).toBe('none');
    expect(effortToIntensity('ultracode')).toBe('none');
    expect(effortToIntensity(undefined)).toBe('none');
  });

  it('parseModelIntensity splits a baked model string into base + tier', () => {
    expect(parseModelIntensity('glm-5.2-xhigh')).toEqual({
      base: 'glm-5.2',
      intensity: 'xhigh',
    });
    expect(parseModelIntensity('glm-5.2')).toEqual({
      base: 'glm-5.2',
      intensity: 'none',
    });
    expect(parseModelIntensity(undefined)).toEqual({
      base: '',
      intensity: 'none',
    });
  });

  it('composeModel rebuilds the legacy baked string (legacy only)', () => {
    expect(composeModel('glm-5.2', 'xhigh')).toBe('glm-5.2-xhigh');
    expect(composeModel('glm-5.2', 'none')).toBe('glm-5.2');
    expect(composeModel('', 'high')).toBe('');
  });
});

describe('modelIntensity · per-provider model presets', () => {
  it('codex presets are gpt-5.4 / gpt-5.5', () => {
    expect(MODEL_PRESETS_BY_PROVIDER.codex.map(m => m.value)).toEqual([
      'gpt-5.4',
      'gpt-5.5',
    ]);
  });

  it('claude_code presets are glm-5.1 / glm-5.2', () => {
    expect(MODEL_PRESETS_BY_PROVIDER.claude_code.map(m => m.value)).toEqual([
      'glm-5.1',
      'glm-5.2',
    ]);
  });

  it('modelPresetsFor falls back to codex for unknown provider', () => {
    expect(modelPresetsFor('codex' as never).map(m => m.value)).toEqual([
      'gpt-5.4',
      'gpt-5.5',
    ]);
  });

  it('catalogModelOptions prefers the catalog, falls back to presets', () => {
    const catalog = [
      {
        provider: 'codex' as const,
        models: [{ label: 'gpt-9', value: 'gpt-9' }],
      },
    ];
    expect(catalogModelOptions('codex', catalog).map(m => m.value)).toEqual([
      'gpt-9',
    ]);
    // No codex entry in catalog → fall back to hardcoded presets.
    expect(catalogModelOptions('codex', []).map(m => m.value)).toEqual([
      'gpt-5.4',
      'gpt-5.5',
    ]);
    expect(catalogModelOptions('claude_code', undefined).map(m => m.value)).toEqual([
      'glm-5.1',
      'glm-5.2',
    ]);
  });
});

describe('modelIntensity · availableProviders', () => {
  it('both available when tools empty (agent not yet reported)', () => {
    expect(availableProviders([])).toEqual({ codex: true, claude_code: true });
    expect(availableProviders(undefined)).toEqual({
      codex: true,
      claude_code: true,
    });
  });

  it('maps codex/claude tool availability', () => {
    expect(
      availableProviders([{ id: 'codex', available: true }]),
    ).toEqual({ codex: true, claude_code: false });
    expect(
      availableProviders([{ id: 'claude', available: true }]),
    ).toEqual({ codex: false, claude_code: true });
    expect(
      availableProviders([{ id: 'claudecode', available: true }]),
    ).toEqual({ codex: false, claude_code: true });
  });

  it('respects available===false', () => {
    expect(
      availableProviders([
        { id: 'codex', available: false },
        { id: 'claude', available: true },
      ]),
    ).toEqual({ codex: false, claude_code: true });
  });

  it('both true when both CLIs present', () => {
    expect(
      availableProviders([
        { id: 'codex', available: true },
        { id: 'claude', available: true },
      ]),
    ).toEqual({ codex: true, claude_code: true });
  });
});
