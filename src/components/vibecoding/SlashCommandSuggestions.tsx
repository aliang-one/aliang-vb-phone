// Inline slash-command typeahead shown above the chat input while the user is
// typing a `/`-command token. The owner (MessageComposer) decides WHEN to show
// it (input matches `/^\//.../`); this component just filters the supplied
// command list by the current query and renders the matches, mirroring the
// ToolsMenu command-row styling so the two surfaces read as one system.
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GlassPanel } from '../shared/GlassPanel';
import { useTheme } from '../../theme/useTheme';
import type { AgentCommandInfo } from '../../data/platformModels';

const MAX_ROWS = 8;

const scopeLabel = (scope?: string): string | null => {
  if (scope === 'project') return '项目';
  if (scope === 'user') return '用户';
  if (scope === 'builtin') return '内置';
  return null;
};

export interface SlashCommandSuggestionsProps {
  commands: AgentCommandInfo[];
  /** Lowercased substring to filter command names by ("" = show all). */
  query: string;
  onSelect: (cmd: AgentCommandInfo) => void;
}

export const SlashCommandSuggestions: React.FC<SlashCommandSuggestionsProps> = ({
  commands,
  query,
  onSelect,
}) => {
  const { theme } = useTheme();
  const accent = theme.colors.primary;

  // Dedupe by lowercased name (available_commands is already server-deduped,
  // but the sessionCommands fallback goes through mergeCommands — dedupe
  // defensively), keep only names containing the query, cap at MAX_ROWS.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const out: AgentCommandInfo[] = [];
    for (const cmd of commands) {
      const key = cmd.name.toLowerCase();
      if (seen.has(key)) continue;
      if (q && !key.includes(q)) continue;
      seen.add(key);
      out.push(cmd);
      if (out.length >= MAX_ROWS) break;
    }
    return out;
  }, [commands, query]);

  if (filtered.length === 0) return null;

  return (
    <GlassPanel style={styles.panel}>
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled>
        {filtered.map(cmd => {
          const badge = scopeLabel(cmd.scope);
          return (
            <TouchableOpacity
              key={`${cmd.scope ?? 'cmd'}-${cmd.name}`}
              testID={`slash-cmd-${cmd.name}`}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`插入 /${cmd.name}`}
              onPress={() => onSelect(cmd)}
              style={[styles.row, { borderBottomColor: theme.colors.outlineVariant }]}>
              <View style={styles.rowMain}>
                <Text
                  style={[theme.typography.codeSm, { color: accent }, styles.name]}>
                  /{cmd.name}
                  {cmd.argHint ? ` ${cmd.argHint}` : ''}
                </Text>
                {badge ? (
                  <Text
                    style={[
                      theme.typography.labelSm,
                      { color: theme.colors.onSurfaceVariant, opacity: 0.6 },
                    ]}>
                    {badge}
                  </Text>
                ) : null}
              </View>
              {cmd.description ? (
                <Text
                  style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
                  numberOfLines={1}>
                  {cmd.description}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  panel: {
    maxHeight: 220,
    padding: 0,
  },
  scroll: {},
  row: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    gap: 2,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {},
});
