import { normalizeProvider, type EffortProvider } from './modelIntensity';

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
  /** Me 偏好(provider 一致性门控后)是否适用。 */
  meApplies: boolean;
}

/**
 * 手机端镜像 server 的 resolveEffectiveModelConfig
 * (AliangPhoneServer server/src/modelConfig.ts)。核心规则逐字对齐——
 * 确认弹窗展示什么,server 实际就执行什么。规则:
 *   effective.model  = 手动 || (Me 适用 ? Me.model : 无) || CLI 默认
 *   Me 适用 = Me.provider 未设 或 归一化后与已选 provider 一致
 *
 * 与 server 的两处刻意偏差(勿"顺手补齐"):
 * 1. server 谓词多一个 `!providerValue` 放行项;手机创建页 provider 恒为
 *    显式实参,该项在本侧不可达。
 * 2. provider 别名复用手机端 normalizeProvider(超集,额外认 'claude-code'
 *    连字符形;server 不认)。server 存储从不出现该形,语义不受影响。
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
  const meProvider = normalizeProvider(meDefault?.provider ?? undefined);
  const meApplies = !meProvider || meProvider === provider;
  const meModel = meApplies ? clean(meDefault?.model) : undefined;
  const meEffort = meApplies ? clean(meDefault?.effort) : undefined;
  const model = clean(manualModel);
  const effort = clean(manualEffort);
  return {
    provider,
    model: model ?? meModel,
    effort: effort ?? meEffort,
    modelSource: model ? 'manual' : meModel ? 'me' : 'cli',
    effortSource: effort ? 'manual' : meEffort ? 'me' : 'cli',
    meApplies,
  };
};
