/**
 * 跨端会话统一的来源/终端前缀工具（P4）。
 *
 * 终端原生会话的 id 前缀约定（与服务端 agent 清单同源，见 agent 侧
 * inventoryNativeSessionID）：`claude_<nativeId>` / `codex_<nativeId>`。
 * 带前缀的条目是终端里 CLI 自己起的会话被扫盘带进清单的形态——本端没有
 * 可直连的会话记录，续聊必须走「新建托管会话 + source_session_id 回填」。
 */

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

