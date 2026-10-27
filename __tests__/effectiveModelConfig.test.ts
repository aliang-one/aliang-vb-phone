import { resolveEffectiveModelChoice } from '../src/utils/effectiveModelConfig';

/**
 * 2026-10-28 用户拍板:Me 默认的四项(provider/model/effort/context)各自
 * 独立作为全局默认,不再有 provider 一致性门控;某项未设置就落该项的内置
 * 默认(CLI 默认模型/effort、200k 上下文)。
 */
describe('resolveEffectiveModelChoice(逐字段全局默认)', () => {
  it('Me 默认跨 provider 照样生效(不再整组门控)', () => {
    const r = resolveEffectiveModelChoice('codex', undefined, undefined, {
      provider: 'claude_code',
      model: 'glm-5.2',
      effort: 'high',
    });
    expect(r.model).toBe('glm-5.2');
    expect(r.effort).toBe('high');
    expect(r.modelSource).toBe('me');
    expect(r.effortSource).toBe('me');
  });

  it('provider 与 Me 一致:行为不变,继承 Me 的 model/effort', () => {
    const r = resolveEffectiveModelChoice('claude_code', undefined, undefined, {
      provider: 'claude_code',
      model: 'glm-5.2',
      effort: 'high',
    });
    expect(r.model).toBe('glm-5.2');
    expect(r.effort).toBe('high');
    expect(r.modelSource).toBe('me');
  });

  it('Me 未设 provider:model/effort 视为全局偏好', () => {
    const r = resolveEffectiveModelChoice('codex', undefined, undefined, {
      model: 'gpt-5.4',
      effort: 'high',
    });
    expect(r.model).toBe('gpt-5.4');
    expect(r.modelSource).toBe('me');
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
      expect(r.effortSource).toBe('cli');
    }
  });

  it('空串/空白等价于未指定(与 server cleaned 语义对齐)', () => {
    const r = resolveEffectiveModelChoice('codex', '  ', '', { model: 'gpt-5.4' });
    expect(r.model).toBe('gpt-5.4');
    expect(r.modelSource).toBe('me');
  });

  it('只设了 model 没设 effort:model 走 Me,effort 独立落 CLI 默认', () => {
    const r = resolveEffectiveModelChoice('codex', undefined, undefined, {
      provider: null,
      model: 'glm-5.2',
      effort: null,
    });
    expect(r.model).toBe('glm-5.2');
    expect(r.modelSource).toBe('me');
    expect(r.effort).toBeUndefined();
    expect(r.effortSource).toBe('cli');
  });
});
