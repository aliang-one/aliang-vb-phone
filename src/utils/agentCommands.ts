import type { AgentCommandInfo } from '../data/platformModels';

/**
 * Universal `/`-command baseline per provider.
 *
 * These are the CLI's own well-known commands (the same on every machine) —
 * NOT fabricated "project commands". The phone ships them as a FALLBACK so the
 * Tools command palette is never empty before the desktop agent reports its
 * own (custom / project / user) commands. Project and user commands still come
 * solely from the agent via `AgentTool.commands`; this catalog only guarantees
 * the universal built-in surface is always visible.
 *
 * Keep this in rough sync with the agent's own builtin baseline
 * (local-agent.ts `BUILTIN_COMMANDS`) — when the agent reports its builtins
 * they are deduped against this list, so the two never double-show.
 */
export const BUILTIN_AGENT_COMMANDS: Record<'codex' | 'claude_code', AgentCommandInfo[]> = {
  claude_code: [
    { name: 'clear', description: '清空当前对话上下文', scope: 'builtin', remote: 'local' },
    { name: 'compact', description: '压缩对话历史以节省上下文', scope: 'builtin', remote: 'local' },
    { name: 'model', description: '切换模型', argHint: '<model>', scope: 'builtin', remote: 'local' },
    { name: 'review', description: '审查代码变更', scope: 'builtin', remote: 'prompt' },
    { name: 'cost', description: '查看本次会话的用量与花费', scope: 'builtin', remote: 'local' },
    { name: 'memory', description: '查看 / 编辑项目记忆 (CLAUDE.md)', scope: 'builtin', remote: 'unsupported' },
    { name: 'init', description: '初始化项目记忆与配置', scope: 'builtin', remote: 'unsupported' },
    { name: 'help', description: '查看可用命令', scope: 'builtin', remote: 'local' },
  ],
  codex: [
    { name: 'diff', description: '查看当前未提交的改动', scope: 'builtin', remote: 'local' },
    { name: 'clear', description: '清空当前对话上下文', scope: 'builtin', remote: 'local' },
    { name: 'model', description: '切换模型', argHint: '<model>', scope: 'builtin', remote: 'local' },
  ],
};

export const builtinCommandsFor = (
  provider: 'codex' | 'claude_code',
): AgentCommandInfo[] => BUILTIN_AGENT_COMMANDS[provider] ?? BUILTIN_AGENT_COMMANDS.claude_code;

/**
 * Merge agent-reported commands with the universal builtin fallback.
 *
 * Agent commands win on name clashes (they carry the machine's real, specific
 * data — e.g. a custom description or an updated builtin). Builtins only fill
 * the gaps, so the palette is never empty even when the agent reports nothing
 * (e.g. the production Go agent before it implements command discovery).
 */
export const mergeCommands = (
  provider: 'codex' | 'claude_code',
  agentCommands: AgentCommandInfo[] | undefined,
): AgentCommandInfo[] => {
  const agent = agentCommands ?? [];
  const seen = new Set(agent.map(c => c.name.toLowerCase()));
  const filled = builtinCommandsFor(provider).filter(
    b => !seen.has(b.name.toLowerCase()),
  );
  return [...agent, ...filled];
};
