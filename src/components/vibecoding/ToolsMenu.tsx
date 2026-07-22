import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '../shared/GlassPanel';
import { GlowButton } from '../shared/GlowButton';
import { IconBadge } from '../visual/IconBadge';
import { Logo } from '../visual/Logo';
import type { AgentCommandInfo } from '../../data/platformModels';
import {
  effortPresetsFor,
  intensityToEffort,
  modelPresetsFor,
  parseModelIntensity,
  providerLabel,
  type EffortProvider,
} from '../../utils/modelIntensity';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { useRecentModelOptions } from '../../hooks/useRecentModelOptions';

export interface ToolsMenuProps {
  onClose: () => void;
  /** Display model label from the session (provider name when unset). */
  model: string;
  /** Authoritative provider — drives header + provider-aware effort presets. */
  provider: EffortProvider;
  /** Commands the agent discovered for this session's agent (already filtered). */
  commands: AgentCommandInfo[];
  /** Session id — drives the on-open auto-refresh of discovered commands. */
  sessionId?: string;
  /** Current reasoning effort (provider-specific); undefined/'' = no override. */
  effort?: string;
  /** Server-recommended models for this provider, supplied by the session. */
  serverModelOptions?: Array<{ label: string; value: string }>;
  /**
   * Resolved effort options for the provider. When supplied, the chips render
   * the live server catalog's efforts (codex 4, claude 6); otherwise the
   * hardcoded fallback ladder is used. Passed down by the session screen.
   */
  effortOptions?: Array<{ label: string; value: string }>;
  /**
   * Read-only "当前有效" hint from the session's `effective_model_config`
   * (server-resolved concrete model/effort + provenance). Shown above the
   * MODEL field so the user knows what the agent actually runs with today.
   */
  effectiveLabel?: string;
  /** Actual immutable profile used by the active/current Run. */
  activeExecutionLabel?: string;
  /** Goal sessions expose commands here but keep their execution profile immutable. */
  settingsEditable?: boolean;
  /** Ordinary chat, an unsent Goal objective, or an already-created Goal session. */
  goalMode?: 'ordinary' | 'draft' | 'active';
  /** Switches the ordinary composer into or out of Goal objective entry. */
  onGoalModeChange?: (mode: 'ordinary' | 'draft') => void;
  /** Persist the edited model + effort. Empty strings clear; the model is a
   *  clean base name (effort is sent as a separate field, never baked in). */
  onSaveSettings: (patch: { model: string; effort: string }) => Promise<void>;
  /** Insert a `/`-style entry as editable prompt text (parent routes to input). */
  onInsertCommand: (text: string) => void;
}

// Slash-command label with leading slash + optional argument hint.
const commandInsertText = (cmd: AgentCommandInfo) =>
  `/${cmd.name}${cmd.argHint ? ` ${cmd.argHint}` : ''}`;

type CommandGroup = 'skill' | 'command' | 'builtin';

const commandGroup = (cmd: AgentCommandInfo): CommandGroup =>
  cmd.kind === 'skill'
    ? 'skill'
    : cmd.scope === 'builtin' || cmd.kind === 'builtin'
      ? 'builtin'
      : 'command';

export const ToolsMenu: React.FC<ToolsMenuProps> = ({
  onClose,
  model,
  provider,
  commands,
  effort,
  effortOptions,
  serverModelOptions,
  effectiveLabel,
  activeExecutionLabel,
  settingsEditable = true,
  goalMode = 'ordinary',
  onGoalModeChange,
  onSaveSettings,
  onInsertCommand,
  sessionId,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const isCodex = provider === 'codex';
  const recommendedModelOptions = useMemo(
    () =>
      serverModelOptions?.length
        ? serverModelOptions
        : modelPresetsFor(provider),
    [provider, serverModelOptions],
  );
  const { modelOptions: recentFirstModelOptions, rememberModel } =
    useRecentModelOptions(provider, recommendedModelOptions);
  const modelOptions = useMemo(
    () => [
      { label: t('toolsMenu.defaultModel'), value: '' },
      ...recentFirstModelOptions,
    ],
    [recentFirstModelOptions, t],
  );
  // The parent conditionally mounts this component, so each open is a fresh
  // mount and these drafts initialize from the latest session props — no
  // useEffect re-sync needed (which avoided a post-render setState storm).
  const parsed = parseModelIntensity(model);
  const [modelBase, setModelBase] = useState(parsed.base);
  // Prefer the authoritative effort field; fall back to a legacy baked model
  // suffix (parseModelIntensity) so old sessions migrate on first edit.
  const [effortDraft, setEffortDraft] = useState(
    effort?.trim() || intensityToEffort(parsed.intensity),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);

  // Auto-sync discovered `/`-commands on open. force=false → the store applies
  // its 1h gate + in-flight dedup, so within the hour this is a cheap persisted
  // read (no agent round-trip). Results land in the session capability snapshot,
  // then the `commands` prop updates and this menu re-renders.
  const refreshSessionCommands = useControlCenterStore(s => s.refreshSessionCommands);
  const [refreshingCommands, setRefreshingCommands] = useState(false);
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    setRefreshingCommands(true);
    refreshSessionCommands(sessionId, { force: false })
      .finally(() => {
        if (alive) setRefreshingCommands(false);
      });
    return () => {
      alive = false;
    };
  }, [sessionId, refreshSessionCommands]);

  // Manual refresh (force=true): bypasses the 1h auto-gate so the user can pull
  // fresh commands on demand right from the menu where they're viewing them.
  // (The composer's input-bar refresh button is hidden while this sheet is open.)
  const handleRefreshCommands = () => {
    if (!sessionId || refreshingCommands) return;
    setRefreshingCommands(true);
    refreshSessionCommands(sessionId, { force: true }).finally(() => {
      setRefreshingCommands(false);
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSaveSettings({
        // Clean base name only — effort is a separate field (see file header
        // in modelIntensity.ts). The gateway derives the codex level from it.
        model: modelBase.trim(),
        effort: effortDraft.trim(),
      });
      rememberModel(modelBase);
      setSettingsDirty(false);
      setSaving(false);
      // Auto-close on a successful save (clear `saving` first so we don't
      // setState on the about-to-unmount component).
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('toolsMenu.saveFailed'));
      setSaving(false);
    }
  };

  const handleInsert = (cmd: AgentCommandInfo) => {
    onInsertCommand(commandInsertText(cmd));
    onClose();
  };

  const agentLabel = providerLabel(provider);
  const accent = theme.colors.primary;
  const idleBorder = isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant;
  const rowBorder = isDark ? 'rgba(255,255,255,0.06)' : theme.colors.outlineVariant;
  const activeBg = isDark ? 'rgba(86,156,214,0.14)' : 'rgba(0,81,174,0.08)';
  const visibleCommands = useMemo(
    () => commands.filter(command => command.userInvocable !== false),
    [commands],
  );
  const commandGroups = useMemo(
    () => (['skill', 'command', 'builtin'] as const)
      .map(kind => ({ kind, commands: visibleCommands.filter(c => commandGroup(c) === kind) }))
      .filter(group => group.commands.length > 0),
    [visibleCommands],
  );

  const chipStyle = (active: boolean) => [
    styles.chip,
    {
      borderRadius: theme.borderRadius.full,
      borderColor: active ? accent : idleBorder,
      backgroundColor: active ? activeBg : 'transparent',
    },
  ];
  const chipText = (active: boolean) => [
    theme.typography.labelSm,
    { color: active ? accent : theme.colors.onSurfaceVariant },
  ];

  return (
    <GlassPanel style={styles.sheet}>
      {/* Header — compact */}
      <View style={[styles.header, { borderBottomColor: rowBorder }]}>
        <IconBadge
          name={isCodex ? 'code' : 'agent'}
          tone="primary"
          size={24}
          iconSize={12}
        />
        <View style={styles.headerCopy}>
          <Text
            style={[theme.typography.labelCaps, { color: accent, letterSpacing: 1.2 }]}>
            TOOLS
          </Text>
          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}
            numberOfLines={1}>
            {t('toolsMenu.subtitle', { agent: agentLabel, count: visibleCommands.length })}
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('toolsMenu.collapse')}
          onPress={onClose}
          style={styles.closeBtn}>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
            CLOSE ▾
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
        <Text
          style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }, styles.fieldLabel]}>
          对话模式
        </Text>
        <View
          style={[
            styles.modeSelector,
            { borderColor: idleBorder, backgroundColor: theme.colors.surfaceContainerLow },
          ]}>
          {([
            { key: 'ordinary', label: '普通对话' },
            { key: 'draft', label: 'Goal' },
          ] as const).map(option => {
            const active = option.key === 'ordinary'
              ? goalMode === 'ordinary'
              : goalMode === 'draft' || goalMode === 'active';
            const disabled = goalMode === 'active' || !onGoalModeChange;
            return (
              <TouchableOpacity
                key={option.key}
                testID={`tools-mode-${option.key === 'ordinary' ? 'ordinary' : 'goal'}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled }}
                disabled={disabled}
                activeOpacity={0.72}
                onPress={() => {
                  onGoalModeChange?.(option.key);
                  onClose();
                }}
                style={[
                  styles.modeOption,
                  active && { backgroundColor: activeBg },
                ]}>
                <Text style={[theme.typography.labelMd, { color: active ? accent : theme.colors.onSurfaceVariant }]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {goalMode === 'draft' ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }, styles.modeHint]}>
            下一条输入将创建 Goal；模型和 Effort 可在发送前调整。
          </Text>
        ) : goalMode === 'active' ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }, styles.modeHint]}>
            当前对话已绑定 Goal，后续输入都会发送给这个 Goal。
          </Text>
        ) : null}
        {activeExecutionLabel ? (
          <View style={[styles.effectiveRow, { borderRadius: theme.borderRadius.md, borderColor: rowBorder, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : theme.colors.surfaceContainerLow }]}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>本轮实际</Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface, flexShrink: 1 }]} numberOfLines={2}>
              {activeExecutionLabel}
            </Text>
          </View>
        ) : null}
        {effectiveLabel ? (
          <View
            style={[
              styles.effectiveRow,
              {
                borderRadius: theme.borderRadius.md,
                borderColor: rowBorder,
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.03)'
                  : theme.colors.surfaceContainerLow,
              },
            ]}>
            <Text
              style={[
                theme.typography.labelCaps,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {activeExecutionLabel ? '下轮配置' : t('toolsMenu.effective')}
            </Text>
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurface, flexShrink: 1 },
              ]}
              numberOfLines={2}>
              {effectiveLabel}
            </Text>
          </View>
        ) : null}

        {settingsEditable ? <>
        {/* MODEL */}
        <Text
          style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }, styles.fieldLabel]}>
          {t('toolsMenu.modelLabel')}
        </Text>
        <TextInput
          value={modelBase}
          onChangeText={v => {
            setModelBase(v);
            setSettingsDirty(true);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t('toolsMenu.modelPlaceholder')}
          placeholderTextColor={theme.colors.onSurfaceVariant}
          style={[
            theme.typography.bodyMd,
            styles.modelInput,
            {
              color: theme.colors.onSurface,
              borderRadius: theme.borderRadius.md,
              borderColor: idleBorder,
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.04)'
                : theme.colors.surfaceContainerLow,
            },
          ]}
        />
        <View style={styles.chipRow}>
          {modelOptions.map(preset => {
            const active =
              preset.value === ''
                ? modelBase.trim() === ''
                : modelBase.trim() === preset.value;
            return (
              <TouchableOpacity
                key={preset.label}
                activeOpacity={0.75}
                onPress={() => {
                  setModelBase(preset.value);
                  setSettingsDirty(true);
                }}
                style={chipStyle(active)}>
                <Text style={chipText(active)}>{preset.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* EFFORT (reasoning depth) */}
        <Text
          style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }, styles.fieldLabel]}>
          {t('toolsMenu.effortLabel')}
        </Text>
        <View style={styles.chipRow}>
          {(effortOptions && effortOptions.length
            ? effortOptions
            : effortPresetsFor(provider)
          ).map(option => {
            const active = effortDraft === option.value;
            return (
              <TouchableOpacity
                key={option.value || 'default'}
                testID={`tools-effort-${option.value || 'default'}`}
                activeOpacity={0.75}
                onPress={() => {
                  setEffortDraft(option.value);
                  setSettingsDirty(true);
                }}
                style={chipStyle(active)}>
                <Text style={chipText(active)}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        </> : (
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }, styles.readOnlyHint]}>
            Goal 的执行配置在创建时固定，后续任务与重新规划使用同一配置。
          </Text>
        )}

        {error ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.error }, styles.errorText]}>
            {error}
          </Text>
        ) : null}

        {settingsEditable ? (
          <GlowButton
            title={saving ? t('toolsMenu.saving') : settingsDirty ? t('toolsMenu.save') : t('toolsMenu.upToDate')}
            onPress={handleSave}
            disabled={saving || !settingsDirty}
            variant={settingsDirty ? 'primary' : 'outline'}
            style={styles.saveButton}
          />
        ) : null}

        {/* Commands — separated */}
        <View style={[styles.divider, { borderTopColor: rowBorder }]} />
        <View style={styles.commandsHeader}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
            {t('toolsMenu.commands')}
          </Text>
          <TouchableOpacity
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={t('toolsMenu.refresh')}
            disabled={refreshingCommands || !sessionId}
            onPress={handleRefreshCommands}>
            <Text
              style={[
                theme.typography.labelSm,
                {
                  color: refreshingCommands ? theme.colors.onSurfaceVariant : theme.colors.primary,
                  opacity: refreshingCommands ? 0.6 : 1,
                },
              ]}>
              {refreshingCommands ? t('toolsMenu.refreshing') : t('toolsMenu.refreshButton')}
            </Text>
          </TouchableOpacity>
        </View>
        {visibleCommands.length ? (
          <View style={styles.commandList}>
            {commandGroups.map(group => (
              <View key={group.kind} style={styles.commandGroup}>
                <Text
                  style={[
                    theme.typography.labelSm,
                    styles.commandGroupLabel,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {t(`toolsMenu.group.${group.kind}`)}
                </Text>
                {group.commands.map(cmd => {
                  const remoteLabel =
                    cmd.remote === 'local'
                      ? t('toolsMenu.remoteLocal')
                      : cmd.remote === 'unsupported'
                        ? t('toolsMenu.remoteUnsupported')
                        : null;
                  const dim = cmd.remote === 'unsupported';
                  const scopeLabel =
                    cmd.scope === 'project'
                      ? t('toolsMenu.scopeProject')
                      : cmd.scope === 'user'
                        ? t('toolsMenu.scopeUser')
                        : cmd.scope === 'plugin'
                          ? t('toolsMenu.scopePlugin')
                          : t('toolsMenu.scopeBuiltin');
                  return (
                    <TouchableOpacity
                      key={`${cmd.kind ?? 'cmd'}-${cmd.scope ?? 'cmd'}-${cmd.name}`}
                      testID={`tools-cmd-${cmd.name}`}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={t('toolsMenu.insertCommand', { name: cmd.name })}
                      onPress={() => handleInsert(cmd)}
                      style={[
                        styles.commandRow,
                        { borderColor: rowBorder },
                        dim && styles.commandRowDim,
                      ]}>
                      <View style={styles.commandMain}>
                        <Text
                          style={[theme.typography.codeSm, { color: accent }, styles.commandName]}>
                          /{cmd.name}
                          {cmd.argHint ? ` ${cmd.argHint}` : ''}
                        </Text>
                        <View style={styles.commandBadges}>
                          {remoteLabel ? (
                            <Text
                              style={[
                                theme.typography.labelSm,
                                { color: theme.colors.onSurfaceVariant },
                              ]}>
                              {remoteLabel}
                            </Text>
                          ) : null}
                          {cmd.scope ? (
                            <Text
                              style={[
                                theme.typography.labelSm,
                                { color: theme.colors.onSurfaceVariant, opacity: 0.6 },
                              ]}>
                              {scopeLabel}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      {cmd.description ? (
                        <Text
                          style={[
                            theme.typography.bodySm,
                            { color: theme.colors.onSurfaceVariant },
                          ]}
                          numberOfLines={1}>
                          {cmd.description}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.emptyCommands, { borderColor: rowBorder }]}>
            <Logo size={28} />
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              {t('toolsMenu.empty')}
            </Text>
          </View>
        )}
      </ScrollView>
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  sheet: {
    maxHeight: 340,
    padding: 0,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 7,
    borderBottomWidth: 1,
  },
  headerCopy: {
    flex: 1,
    gap: 0,
  },
  closeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  effectiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginTop: 10,
  },
  modeSelector: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 8,
    padding: 3,
  },
  modeOption: {
    flex: 1,
    minHeight: 34,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeHint: {
    marginTop: 6,
  },
  fieldLabel: {
    marginTop: 10,
    marginBottom: 5,
  },
  modelInput: {
    minHeight: 38,
    borderWidth: 1,
    paddingHorizontal: 11,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 7,
  },
  chip: {
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  errorText: {
    marginTop: 8,
  },
  saveButton: {
    marginTop: 11,
  },
  readOnlyHint: {
    marginTop: 10,
  },
  divider: {
    marginTop: 12,
    marginBottom: 8,
    borderTopWidth: 1,
  },
  commandsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  commandList: {
    gap: 10,
  },
  commandGroup: {
    gap: 6,
  },
  commandGroupLabel: {
    textTransform: 'uppercase',
  },
  commandRow: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
    gap: 2,
  },
  commandMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  commandBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  commandRowDim: {
    opacity: 0.45,
  },
  commandName: {
    fontWeight: '600',
  },
  emptyCommands: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 11,
    borderWidth: 1,
    borderRadius: 8,
  },
});
