import type { AgentCommandInfo } from '../data/platformModels';
import type { EffortProvider } from './modelIntensity';
import i18n from '../i18n';

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
 * Descriptions are resolved lazily via i18n at call time (the BUILTIN_AGENT_COMMANDS
 * factory below is invoked on demand by builtinCommandsFor/mergeCommands), so a
 * locale change between reads is honored.
 *
 * Keep this in rough sync with the agent's own builtin baseline
 * (local-agent.ts `BUILTIN_COMMANDS`) — when the agent reports its builtins
 * they are deduped against this list, so the two never double-show.
 */
const buildBuiltinAgentCommands = (): Record<EffortProvider, AgentCommandInfo[]> => ({
  claude_code: [
    { name: 'clear', description: i18n.t('vibecoding:command.clear.description'), scope: 'builtin', remote: 'local' },
    { name: 'compact', description: i18n.t('vibecoding:command.compact.description'), scope: 'builtin', remote: 'local' },
    { name: 'model', description: i18n.t('vibecoding:command.model.description'), argHint: '<model>', scope: 'builtin', remote: 'local' },
    { name: 'review', description: i18n.t('vibecoding:command.review.description'), scope: 'builtin', remote: 'prompt' },
    { name: 'cost', description: i18n.t('vibecoding:command.cost.description'), scope: 'builtin', remote: 'local' },
    { name: 'memory', description: i18n.t('vibecoding:command.memory.description'), scope: 'builtin', remote: 'unsupported' },
    { name: 'init', description: i18n.t('vibecoding:command.init.description'), scope: 'builtin', remote: 'unsupported' },
    { name: 'help', description: i18n.t('vibecoding:command.help.description'), scope: 'builtin', remote: 'local' },
  ],
  codex: [
    { name: 'diff', description: i18n.t('vibecoding:command.diff.description'), scope: 'builtin', remote: 'local' },
    { name: 'clear', description: i18n.t('vibecoding:command.clear.description'), scope: 'builtin', remote: 'local' },
    { name: 'model', description: i18n.t('vibecoding:command.model.description'), argHint: '<model>', scope: 'builtin', remote: 'local' },
  ],
  opencode: [
    { name: 'init', description: i18n.t('vibecoding:command.initOpencode.description'), scope: 'builtin', remote: 'prompt' },
    { name: 'help', description: i18n.t('vibecoding:command.helpOpencode.description'), scope: 'builtin', remote: 'local' },
    { name: 'model', description: i18n.t('vibecoding:command.model.description'), argHint: '<provider/model>', scope: 'builtin', remote: 'local' },
    { name: 'undo', description: i18n.t('vibecoding:command.undo.description'), scope: 'builtin', remote: 'local' },
    { name: 'redo', description: i18n.t('vibecoding:command.redo.description'), scope: 'builtin', remote: 'local' },
  ],
});

export const BUILTIN_AGENT_COMMANDS: Record<EffortProvider, AgentCommandInfo[]> =
  buildBuiltinAgentCommands();

export const builtinCommandsFor = (
  provider: EffortProvider,
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
  provider: EffortProvider,
  agentCommands: AgentCommandInfo[] | undefined,
): AgentCommandInfo[] => {
  const agent = agentCommands ?? [];
  const seen = new Set(agent.map(c => c.name.toLowerCase()));
  const filled = builtinCommandsFor(provider).filter(
    b => !seen.has(b.name.toLowerCase()),
  );
  return [...agent, ...filled];
};
