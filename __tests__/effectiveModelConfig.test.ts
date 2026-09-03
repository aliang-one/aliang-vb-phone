import { resolveEffectiveModelChoice } from '../src/utils/effectiveModelConfig';

describe('resolveEffectiveModelChoice', () => {
  it('跨 provider 的 Me 默认不渗入:落 CLI 默认,meApplies=false', () => {
    const r = resolveEffectiveModelChoice('codex', undefined, undefined, {
      provider: 'claude_code',
      model: 'glm-5.2',
      effort: 'high',
    });
    expect(r.model).toBeUndefined();
    expect(r.effort).toBeUndefined();
    expect(r.modelSource).toBe('cli');
    expect(r.effortSource).toBe('cli');
    expect(r.meApplies).toBe(false);
  });

  it('provider 与 Me 默认一致:继承 Me 的 model/effort,来源 me', () => {
    const r = resolveEffectiveModelChoice('claude_code', undefined, undefined, {
      provider: 'claude_code',
      model: 'glm-5.2',
      effort: 'high',
    });
    expect(r.model).toBe('glm-5.2');
    expect(r.effort).toBe('high');
    expect(r.modelSource).toBe('me');
    expect(r.effortSource).toBe('me');
    expect(r.meApplies).toBe(true);
  });

  it('Me 未设 provider:model/effort 视为全局偏好仍适用', () => {
    const r = resolveEffectiveModelChoice('codex', undefined, undefined, {
      model: 'gpt-5.4',
      effort: 'high',
    });
    expect(r.model).toBe('gpt-5.4');
    expect(r.modelSource).toBe('me');
    expect(r.meApplies).toBe(true);
  });

  it('手动指定优先于 Me 默认,逐字段独立标来源', () => {
    const r = resolveEffectiveModelChoice('codex', 'gpt-5.4', undefined, {
      provider: 'codex',
      model: 'gpt-5.5',
      effort: 'high',
    });
    expect(r.model).toBe('gpt-5.4');
    expect(r.modelSource).toBe('manual');
    expect(r.effort).toBe('high');
    expect(r.effortSource).toBe('me');
  });

  it('Me 全空:落 CLI 默认;undefined 的 meDefault 同样处理', () => {
    for (const me of [undefined, { provider: null, model: null, effort: null }]) {
      const r = resolveEffectiveModelChoice('codex', undefined, undefined, me);
      expect(r.model).toBeUndefined();
      expect(r.modelSource).toBe('cli');
      expect(r.meApplies).toBe(true);
    }
  });

  it('空串/空白等价于未指定(与 server cleaned 语义对齐)', () => {
    const r = resolveEffectiveModelChoice('codex', '  ', '', { model: 'gpt-5.4' });
    expect(r.model).toBe('gpt-5.4');
    expect(r.modelSource).toBe('me');
  });

  it('provider 别名归一化:claude/claudecode 视为 claude_code', () => {
    const r = resolveEffectiveModelChoice('claude_code', undefined, undefined, {
      provider: 'claudecode',
      model: 'glm-5.2',
    });
    expect(r.model).toBe('glm-5.2');
    expect(r.meApplies).toBe(true);
  });
});
