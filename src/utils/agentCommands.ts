import type { AgentCommandInfo } from '../data/platformModels';
import type { EffortProvider } from './modelIntensity';
import i18n from '../i18n';
import { GOAL_UI_ENABLED } from '../config/featureFlags';

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
    { name: 'model', description: i18n.t('vibecoding:command.model.description'), scope: 'builtin', remote: 'local' },
    { name: 'review', description: i18n.t('vibecoding:command.review.description'), scope: 'builtin', remote: 'prompt' },
    { name: 'cost', description: i18n.t('vibecoding:command.cost.description'), scope: 'builtin', remote: 'local' },
    { name: 'memory', description: i18n.t('vibecoding:command.memory.description'), scope: 'builtin', remote: 'unsupported' },
    { name: 'init', description: i18n.t('vibecoding:command.init.description'), scope: 'builtin', remote: 'unsupported' },
    { name: 'help', description: i18n.t('vibecoding:command.help.description'), scope: 'builtin', remote: 'local' },
  ],
  codex: [
    { name: 'diff', description: i18n.t('vibecoding:command.diff.description'), scope: 'builtin', remote: 'local' },
    { name: 'clear', description: i18n.t('vibecoding:command.clear.description'), scope: 'builtin', remote: 'local' },
    { name: 'model', description: i18n.t('vibecoding:command.model.description'), scope: 'builtin', remote: 'local' },
  ],
  opencode: [
    { name: 'init', description: i18n.t('vibecoding:command.initOpencode.description'), scope: 'builtin', remote: 'prompt' },
    { name: 'help', description: i18n.t('vibecoding:command.helpOpencode.description'), scope: 'builtin', remote: 'local' },
    { name: 'model', description: i18n.t('vibecoding:command.model.description'), scope: 'builtin', remote: 'local' },
    { name: 'undo', description: i18n.t('vibecoding:command.undo.description'), scope: 'builtin', remote: 'local' },
    { name: 'redo', description: i18n.t('vibecoding:command.redo.description'), scope: 'builtin', remote: 'local' },
  ],
  // 内置内核刻意留空：上面这些是各 CLI 的 REPL 内建命令，由 CLI 自己解释。
  // 内核没有 REPL、也没有 /clear 或 /model 的处理器，列出来只会让用户点完
  // 发现这条「命令」被当成普通文本发给了模型。空列表让面板只剩产品级命令
  // （/goal）和 agent 真实上报的项目/用户命令——少即是准。
  agentcore: [],
});

/**
 * 产品级命令(手机侧派发,不由 provider 执行)。
 * GOAL_UI_ENABLED 关闭时 /goal 不再出现在命令面板里——面板条目本身就是
 * 「新建 goal」的入口,留着它用户点了也只会变成普通文本发出去。
 */
const buildProductCommands = (): AgentCommandInfo[] =>
  GOAL_UI_ENABLED
    ? [
        {
          name: 'goal',
          description: i18n.t('vibecoding:command.goal.description'),
          argHint: i18n.t('vibecoding:command.goal.argHint'),
          scope: 'builtin',
          remote: 'prompt',
        },
      ]
    : [];

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
  const product = buildProductCommands();
  const productNames = new Set(product.map(command => command.name.toLowerCase()));
  // Product commands are dispatched by the phone/server and must not be
  // shadowed by a provider-native command with the same spelling.
  const agent = (agentCommands ?? []).filter(
    command => !productNames.has(command.name.toLowerCase()),
  );
  const seen = new Set([
    ...productNames,
    ...agent.map(command => command.name.toLowerCase()),
  ]);
  const filled = builtinCommandsFor(provider).filter(
    b => !seen.has(b.name.toLowerCase()),
  );
  const merged = [...product, ...agent, ...filled];
  // GOAL_UI_ENABLED 关闭:连 agent 自己上报的 goal 命令也一并滤掉,
  // 面板里不该出现任何能点进 goal 的条目。
  return GOAL_UI_ENABLED
    ? merged
    : merged.filter(command => command.name.toLowerCase() !== 'goal');
};
