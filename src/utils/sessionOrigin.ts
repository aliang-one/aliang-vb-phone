/**
 * 跨端会话统一的来源/终端前缀工具（P4）。
 *
 * 终端原生会话的 id 前缀约定（与服务端 agent 清单同源，见 agent 侧
 * inventoryNativeSessionID）：`claude_<nativeId>` / `codex_<nativeId>`。
 * 带前缀的条目是终端里 CLI 自己起的会话被扫盘带进清单的形态——本端没有
 * 可直连的会话记录，续聊必须走「新建托管会话 + source_session_id 回填」。
 */

import {
  defaultModelFor,
  normalizeProvider,
  parseModelIntensity,
  PROVIDER_DEFAULT_LABELS,
  type EffortProvider,
} from './modelIntensity';

export interface TerminalResumeTarget {
  provider: 'claude_code' | 'codex' | 'agentcore';
  /**
   * 源会话的原生 id（createAiSession.source_session_id 用）。终端前缀壳 =
   * 剥掉设备壳前缀后的原生 CLI 会话 id；agentcore 壳 = PhoneServer 列表
   * 下发的 sourceSessionId（原生会话 id 不编码在壳 id 里）。
   */
  nativeSessionId: string;
}

/** 该 id 是否是终端前缀壳（claude_/codex_ 开头）。脏输入安全返回 false。 */
export function isTerminalPrefixedSessionId(id: string | undefined): boolean {
  return (
    typeof id === 'string' &&
    (id.startsWith('claude_') || id.startsWith('codex_'))
  );
}

/**
 * 终端前缀壳 → 另起续聊的 create 载荷要素。剥前缀取原生 id（服务端凭它做
 * resume 绑定）；前缀后为空（裸 "claude_"）视为无有效源会话，返回 null。
 */
export function terminalResumeTarget(
  sessionId: string | undefined,
): TerminalResumeTarget | null {
  if (typeof sessionId !== 'string') return null;
  const strip = (prefix: string): TerminalResumeTarget | null => {
    if (!sessionId.startsWith(prefix)) return null;
    const nativeSessionId = sessionId.slice(prefix.length).trim();
    return nativeSessionId
      ? {
          provider: prefix === 'claude_' ? 'claude_code' : 'codex',
          nativeSessionId,
        }
      : null;
  };
  return strip('claude_') ?? strip('codex_');
}

/**
 * agentcore 壳卡 → 另起续聊目标。PhoneServer 扫摄的 agentcore 会话铸成
 * `ai_import_<sha1(deviceId:原生id)[0:18]>` 壳（原生会话 id 不在壳 id 里），
 * 摄入后列表接口以 sourceSessionId 下发原生 id。判据与手机端/服务端的
 * 「导入诞生」谓词同源（id 前缀 ai_import_）：不能只看 sourceSessionId——
 * 手机自建会话绑定原生会话后也会被回填 sourceSessionId（服务端 imported.ts
 * 同款警告），只看它会让每条手机 agentcore 会话误亮续聊入口。
 * provider 非 agentcore / 非导入壳 / 缺 sourceSessionId → null（不亮入口）。
 */
export function agentcoreResumeTarget(
  provider: string | undefined,
  sessionId: string | undefined,
  sourceSessionId: string | undefined,
): TerminalResumeTarget | null {
  if (provider !== 'agentcore') return null;
  if (typeof sessionId !== 'string' || !sessionId.startsWith('ai_import_')) {
    return null;
  }
  const nativeSessionId =
    typeof sourceSessionId === 'string' ? sourceSessionId.trim() : '';
  return nativeSessionId ? { provider: 'agentcore', nativeSessionId } : null;
}

/** 另起续聊目标推导的输入形态（会话卡的三个相关字段）。 */
export interface SessionResumeSource {
  id: string;
  provider?: string;
  sourceSessionId?: string;
}

/**
 * 会话卡 → 另起续聊 create 载荷要素的统一入口。终端前缀壳（claude_/codex_）
 * 走前缀剥壳；agentcore 壳走 provider+列表 sourceSessionId；其余（手机自建、
 * 管理会话）返回 null 不亮入口。
 */
export function sessionResumeTarget(
  session: SessionResumeSource,
): TerminalResumeTarget | null {
  return (
    terminalResumeTarget(session.id) ??
    agentcoreResumeTarget(session.provider, session.id, session.sourceSessionId)
  );
}

/**
 * 「新建会话」（长按菜单 new 按钮）的配置沿用载荷：沿用源会话的
 * provider/model/effort/contextWindow/approval_mode，空起崭新对话（不回填
 * source_session_id、不带首条消息、能力位 can* 不带 → 走项目策略继承）。
 *
 * 各 agent 的沿用语义按其配置形态分别处理：
 *   - agentcore（内置内核，requiresExplicitModel=手机必须显式下发模型）：
 *     model 必须有值。源会话无显式模型（显示名 'AliangCode'/缺省）时回落
 *     defaultModelFor('agentcore')='glm-5.2'（与创建页同源）；legacy 烤档
 *     模型串（如 glm-5.2-xhigh）经 parseModelIntensity 拆回 base+effort。
 *   - codex/claude_code/opencode（外部 CLI，自有默认模型）：model 是 CLI
 *     的 --model 覆盖。源会话无显式模型（model 字段只是 'Claude Code'/
 *     'GPT-5 Codex' 等显示名）→ 不沿用（不发 model 键 = 用 CLI 默认），
 *     避免把显示名当真模型名发给网关（aiSessionSlice 的既有契约）。
 *   - provider 缺失（legacy 快照）：回落 codex——外部 CLI 语义（model 按显
 *     式模型处理，显示名剥掉），与创建页默认 provider 一致。终端前缀壳
 *     （claude_xxx/codex_xxx 且 provider 未回填）按前缀判 provider。
 * effort/contextWindow：按值沿用（'' 与 undefined 等价=不覆盖）。
 * approvalMode：内核挡位原样沿用；undefined（缺键/未知）= 不发键 = 新会话
 * 继承项目策略现状，与「默认推荐」语义一致。
 */
export interface SessionCloneConfig {
  provider: EffortProvider;
  model?: string;
  effort?: string;
  contextWindow?: number;
  approvalMode?: '' | 'ask_all' | 'bypass_all' | 'read_only';
}

export interface SessionCloneSource {
  id: string;
  provider?: string;
  model?: string;
  effort?: string;
  contextWindow?: number;
  approvalMode?: '' | 'ask_all' | 'bypass_all' | 'read_only';
}

const PROVIDER_BY_TERMINAL_PREFIX = (sessionId: string): EffortProvider =>
  sessionId.startsWith('claude_') ? 'claude_code' : 'codex';

export function sessionCloneConfig(
  session: SessionCloneSource,
): SessionCloneConfig {
  const id = typeof session.id === 'string' ? session.id : '';
  const provider =
    normalizeProvider(session.provider) ??
    (isTerminalPrefixedSessionId(id)
      ? PROVIDER_BY_TERMINAL_PREFIX(id)
      : 'codex');

  // 显示名不是模型：PROVIDER_DEFAULT_LABELS 命中（'Claude Code' 等）视为
  // 无显式模型，交给下方按 provider 的默认/省略规则。
  const rawModel = (session.model ?? '').trim();
  const isDisplayLabel = !rawModel || PROVIDER_DEFAULT_LABELS.has(rawModel);
  // Legacy 烤档模型串（glm-5.2-xhigh）拆回 base+effort；effort 未显式设置时
  // 才用拆出来的档位补位。
  const parsed = isDisplayLabel ? undefined : parseModelIntensity(rawModel);
  const legacyEffort =
    parsed && parsed.intensity !== 'none' ? parsed.intensity : '';
  const effort = (session.effort ?? '').trim() || legacyEffort;

  // agentcore 必须显式下发模型；无显式模型时回落 defaultModelFor（glm-5.2，
  // 与创建页同源）。外部 CLI：显示名/缺省 → 不沿用（CLI 默认）；显式模型 →
  // 拆干净烤档后沿用。
  const model =
    provider === 'agentcore'
      ? parsed?.base || defaultModelFor('agentcore')
      : parsed?.base;

  return {
    provider,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(typeof session.contextWindow === 'number' && session.contextWindow > 0
      ? { contextWindow: session.contextWindow }
      : {}),
    ...(session.approvalMode !== undefined
      ? { approvalMode: session.approvalMode }
      : {}),
  };
}

/**
 * 会话来源角标推导（跨端统一 P4-3）。与 dashboard 侧 chatSettings 的
 * sessionSourceBadge 同源：origin 列优先，其次终端 id 前缀约定。
 *   'phone'     → 手机发起
 *   'dashboard' → 本机（dashboard 网页发起）
 *   'tui'/'external' → 终端（扫盘导入的老编码；服务端新清单发 dashboard/
 *                       managed，存量为 tui，语义同终端入口）
 *   id 前缀 claude_/codex_ → 终端（设备壳）
 *   'managed'/空/未知 → null（不渲染角标）
 */
export type SessionOriginBadgeKind = 'phone' | 'dashboard' | 'terminal';

export function deriveSessionOriginBadge(
  origin: string | undefined,
  sessionId: string | undefined,
): SessionOriginBadgeKind | null {
  if (origin === 'phone') return 'phone';
  if (origin === 'dashboard') return 'dashboard';
  if (origin === 'tui' || origin === 'external') return 'terminal';
  if (isTerminalPrefixedSessionId(sessionId)) return 'terminal';
  return null;
}

