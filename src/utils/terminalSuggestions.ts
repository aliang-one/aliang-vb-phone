import type { TerminalCommandHistoryItem } from '../store/types';

interface TerminalSuggestionInput {
  directory?: string;
  history?: TerminalCommandHistoryItem[];
  max?: number;
}

const FALLBACK_COMMANDS = [
  'pwd',
  'ls -la',
  'git status --short',
  'git log --oneline -5',
  'npm test -- --runInBand',
  'npm run lint',
];

const INTERACTIVE_COMMANDS = /^(?:vim|vi|nano|less|more|top|htop|ssh|mysql|psql|python|node|irb|pry)(?:\s|$)/;
const DANGEROUS_COMMANDS = /\b(?:rm\s+-rf|sudo\s+rm|mkfs|diskutil\s+erase|shutdown|reboot|halt|poweroff)\b/;
const SECRET_MARKERS = /<redacted>|token=|password=|passwd=|secret=|api[_-]?key=/i;

export function buildTerminalSuggestions({
  directory = '',
  history = [],
  max = 4,
}: TerminalSuggestionInput) {
  const suggestions: string[] = [];

  const add = (command: string) => {
    const normalized = command.trim();
    if (!normalized || isUnsafeSuggestion(normalized)) return;
    if (suggestions.some(item => item.toLowerCase() === normalized.toLowerCase())) {
      return;
    }
    suggestions.push(normalized);
  };

  [...history]
    .sort((left, right) =>
      commandSortDate(right).localeCompare(commandSortDate(left)),
    )
    .forEach(item => add(item.command));

  if (looksLikeNodeProject(directory)) {
    add('npm test -- --runInBand');
    add('npm run lint');
  }
  if (looksLikeGitWorkingTree(directory)) {
    add('git status --short');
  }

  FALLBACK_COMMANDS.forEach(add);

  return suggestions.slice(0, max);
}

function isUnsafeSuggestion(command: string) {
  return (
    INTERACTIVE_COMMANDS.test(command) ||
    DANGEROUS_COMMANDS.test(command) ||
    SECRET_MARKERS.test(command)
  );
}

function commandSortDate(command: TerminalCommandHistoryItem) {
  return command.createdAt || command.timestamp || '';
}

function looksLikeGitWorkingTree(directory: string) {
  return Boolean(directory && directory !== '~');
}

function looksLikeNodeProject(directory: string) {
  return /(?:node|npm|yarn|pnpm|package|web|app|phone|server|client|frontend|backend|project|repo|vibe)/i.test(
    directory,
  );
}
