// Inline slash-command typeahead shown above the chat input while the user is
// typing a `/`-command token. The owner (MessageComposer) decides WHEN to show
// it (input matches `/^\//.../`); this component just filters the supplied
// command list by the current query and renders the matches, mirroring the
// ToolsMenu command-row styling so the two surfaces read as one system.
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GlassPanel } from '../shared/GlassPanel';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AgentCommandInfo } from '../../data/platformModels';
import { searchCommands } from '../../utils/commandSearch';

const MAX_ROWS = 8;

const scopeLabel = (
  scope: string | undefined,
  t: TFunction<'vibecoding'>,
): string | null => {
  if (scope === 'project') return t('slash.scopeProject');
  if (scope === 'user') return t('slash.scopeUser');
  if (scope === 'builtin') return t('slash.scopeBuiltin');
  return null;
};

export interface SlashCommandSuggestionsProps {
  commands: AgentCommandInfo[];
  /** Query typed after the leading `/`. Fuzzy-matched (subsequence) against
   *  command name + description, ranked by relevance; "" = show all. */
  query: string;
  onSelect: (cmd: AgentCommandInfo) => void;
}

export const SlashCommandSuggestions: React.FC<SlashCommandSuggestionsProps> = ({
  commands,
  query,
  onSelect,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation('vibecoding');
  const accent = theme.colors.primary;

  // Fuzzy subsequence search (name primary, description secondary) ranked by
  // relevance — maximizes recall (finds /brainstorming from "brnst", not just
  // prefixes) while ordering the best matches first. Deduped by name, capped.
  const filtered = useMemo(
    () => searchCommands(commands, query, MAX_ROWS),
    [commands, query],
  );

  if (filtered.length === 0) return null;

  return (
    <GlassPanel style={styles.panel}>
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled>
        {filtered.map(cmd => {
          const scopeBadge = scopeLabel(cmd.scope, t);
          // remote category: 'local' = interactive REPL builtin (agent runs it,
          // no model turn); 'unsupported' = can't be driven remotely. Both are
          // still tappable (the agent replies with the outcome); the label only
          // sets expectations so users don't think /compact silently succeeded.
          const remoteLabel =
            cmd.remote === 'local'
              ? t('slash.remoteLocal')
              : cmd.remote === 'unsupported'
                ? t('slash.remoteUnsupported')
                : null;
          const dim = cmd.remote === 'unsupported';
          return (
            <TouchableOpacity
              key={`${cmd.scope ?? 'cmd'}-${cmd.name}`}
              testID={`slash-cmd-${cmd.name}`}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('slash.insert', { name: cmd.name })}
              onPress={() => onSelect(cmd)}
              style={[
                styles.row,
                { borderBottomColor: theme.colors.outlineVariant },
                dim && styles.dimmed,
              ]}>
              <View style={styles.rowMain}>
                <Text
                  style={[theme.typography.codeSm, { color: accent }, styles.name]}>
                  /{cmd.name}
                  {cmd.argHint ? ` ${cmd.argHint}` : ''}
                </Text>
                <View style={styles.badges}>
                  {remoteLabel ? (
                    <Text
                      style={[
                        theme.typography.labelSm,
                        { color: theme.colors.onSurfaceVariant },
                      ]}>
                      {remoteLabel}
                    </Text>
                  ) : null}
                  {scopeBadge ? (
                    <Text
                      style={[
                        theme.typography.labelSm,
                        { color: theme.colors.onSurfaceVariant, opacity: 0.6 },
                      ]}>
                      {scopeBadge}
                    </Text>
                  ) : null}
                </View>
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
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dimmed: {
    opacity: 0.45,
  },
  name: {},
});
