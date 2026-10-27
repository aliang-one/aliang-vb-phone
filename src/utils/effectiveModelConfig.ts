import type { EffortProvider } from './modelIntensity';

/** 弹窗来源标注:本次手动选择 / Me 页默认 / CLI(或 provider)内置默认。 */
export type ModelChoiceSource = 'manual' | 'me' | 'cli';

/** Me 页个人默认(与 /api/me/model-options 的 user_default 同形,均可空)。 */
export interface MeModelDefault {
  provider?: string | null;
  model?: string | null;
  effort?: string | null;
}

export interface ResolvedModelChoice {
  provider: EffortProvider;
  /** undefined = 该字段落 provider 内置默认(CLI 默认)。 */
  model: string | undefined;
  effort: string | undefined;
  modelSource: ModelChoiceSource;
  effortSource: ModelChoiceSource;
}

/**
 * 手机端镜像 server 的 resolveEffectiveModelConfig
 * (AliangPhoneServer server/src/modelConfig.ts)。核心规则逐字对齐——
 * 确认弹窗展示什么,server 实际就执行什么。规则(2026-10-28 用户拍板:
 * 「每一项都单独作用于全局,用户不设置的时候就采用这些默认值」):
 *   effective.model  = 手动 || Me.model || CLI 默认
 *   effective.effort = 手动 || Me.effort || CLI 默认
 * Me 的 model/effort 是**逐字段的全局默认**,不再做 provider 一致性门控
 * (旧规则:provider 不一致整组不适用——那就是「一组配置」语义,已废)。
 * 每项未设置就落到该项自己的内置默认;下发的模型串由用户在弹窗里二次确认。
 *
 * 与 server 的一处刻意偏差(勿"顺手补齐"):
 * provider 别名复用手机端 normalizeProvider(超集,额外认 'claude-code'
 * 连字符形;server 不认)。server 存储从不出现该形,语义不受影响。
 */
export const resolveEffectiveModelChoice = (
  provider: EffortProvider,
  manualModel: string | undefined,
  manualEffort: string | undefined,
  meDefault: MeModelDefault | undefined,
): ResolvedModelChoice => {
  const clean = (v?: string | null): string | undefined => {
    const s = (v ?? '').trim();
    return s ? s : undefined;
  };
  const meModel = clean(meDefault?.model);
  const meEffort = clean(meDefault?.effort);
  const model = clean(manualModel);
  const effort = clean(manualEffort);
  return {
    provider,
    model: model ?? meModel,
    effort: effort ?? meEffort,
    modelSource: model ? 'manual' : meModel ? 'me' : 'cli',
    effortSource: effort ? 'manual' : meEffort ? 'me' : 'cli',
  };
};
