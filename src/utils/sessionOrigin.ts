/**
 * 跨端会话统一的来源/终端前缀工具（P4）。
 *
 * 终端原生会话的 id 前缀约定（与服务端 agent 清单同源，见 agent 侧
 * inventoryNativeSessionID）：`claude_<nativeId>` / `codex_<nativeId>`。
 * 带前缀的条目是终端里 CLI 自己起的会话被扫盘带进清单的形态——本端没有
 * 可直连的会话记录，续聊必须走「新建托管会话 + source_session_id 回填」。
 */

export interface TerminalResumeTarget {
  provider: 'claude_code' | 'codex';
  /** 剥掉设备壳前缀后的原生 CLI 会话 id（createAiSession.source_session_id 用）。 */
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
