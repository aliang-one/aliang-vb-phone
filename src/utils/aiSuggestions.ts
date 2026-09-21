import { isUnsafeSuggestion } from './terminalSuggestions';

export interface AiSuggestionChip {
  command: string;
  dangerous: boolean;
}

export const MAX_AI_SUGGESTION_CHIPS = 6;

/** Both old ({command, dangerous}) and new ({commands, dangerousFlags}) server
 *  responses satisfy this; mirrors src/api/commandGen.ts CommandGenResult. */
export interface CommandGenResultLike {
  command?: string;
  commands?: string[];
  dangerous?: boolean;
  dangerousFlags?: boolean[];
}

/** Map a commandGen response into chips. Per-command flags when present;
 *  otherwise the aggregate `dangerous` applies to every entry (old-server
 *  compat). The local isUnsafeSuggestion check always ORs in — the phone's
 *  interactive/danger/secret filters catch what the server's filter misses.
 *  Commands are trimmed BEFORE that check so the ^-anchored INTERACTIVE_COMMANDS
 *  regex can't be defeated by a leading space, and chips normalize early. */
export function chipsFromCommandGenResult(
  result: CommandGenResultLike,
): AiSuggestionChip[] {
  const commands =
    result.commands && result.commands.length > 0
      ? result.commands
      : result.command
        ? [result.command]
        : [];
  return commands.map((command, index) => {
    const trimmed = command.trim();
    return {
      command: trimmed,
      dangerous:
        isUnsafeSuggestion(trimmed) ||
        (result.dangerousFlags
          ? Boolean(result.dangerousFlags[index])
          : Boolean(result.dangerous)),
    };
  });
}

/** Merge a fresh batch (FIRST in the result) above the existing chips: newest
 *  batch first, case-insensitive dedupe by command, hard cap. */
export function mergeAiSuggestions(
  prev: AiSuggestionChip[],
  incoming: AiSuggestionChip[],
  max: number = MAX_AI_SUGGESTION_CHIPS,
): AiSuggestionChip[] {
  const merged: AiSuggestionChip[] = [];
  const seen = new Set<string>();
  for (const chip of [...incoming, ...prev]) {
    const key = chip.command.trim();
    if (!key) continue;
    const dedupeKey = key.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    merged.push({ command: key, dangerous: chip.dangerous });
    if (merged.length >= max) break;
  }
  return merged;
}
