// Safety predicates for AI-suggested terminal commands. The old
// history/fallback suggestion builder (buildTerminalSuggestions) was removed
// when the terminal moved to server-generated AI suggestions (2026-09); only
// the danger filters remain — consumed by VoiceToBashModal and the AI chips.

const INTERACTIVE_COMMANDS = /^(?:vim|vi|nano|less|more|top|htop|ssh|mysql|psql|python|node|irb|pry)(?:\s|$)/;
export const DANGEROUS_COMMANDS = /\b(?:rm\s+-rf|sudo\s+rm|mkfs|diskutil\s+erase|shutdown|reboot|halt|poweroff)\b/;
const SECRET_MARKERS = /<redacted>|token=|password=|passwd=|secret=|api[_-]?key=/i;

export function isUnsafeSuggestion(command: string) {
  return (
    INTERACTIVE_COMMANDS.test(command) ||
    DANGEROUS_COMMANDS.test(command) ||
    SECRET_MARKERS.test(command)
  );
}
