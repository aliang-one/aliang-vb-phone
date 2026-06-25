import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { GlowButton } from '../shared/GlowButton';
import { IconBadge } from '../visual/IconBadge';
import type { AgentCommandInfo } from '../../data/platformModels';
import {
  effortPresetsFor,
  intensityToEffort,
  modelPresetsFor,
  parseModelIntensity,
  type EffortProvider,
} from '../../utils/modelIntensity';
import { useControlCenterStore } from '../../store/controlCenterStore';

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
  /** Persist the edited model + effort. Empty strings clear; the model is a
   *  clean base name (effort is sent as a separate field, never baked in). */
  onSaveSettings: (patch: { model: string; effort: string }) => Promise<void>;
  /** Insert a `/`-style entry as editable prompt text (parent routes to input). */
  onInsertCommand: (text: string) => void;
}

// Slash-command label with leading slash + optional argument hint.
const commandInsertText = (cmd: AgentCommandInfo) =>
  `/${cmd.name}${cmd.argHint ? ` ${cmd.argHint}` : ''}`;

export const ToolsMenu: React.FC<ToolsMenuProps> = ({
  onClose,
  model,
  provider,
  commands,
  effort,
  effortOptions,
  effectiveLabel,
  onSaveSettings,
  onInsertCommand,
  sessionId,
}) => {
  const { theme, isDark } = useTheme();
  const isCodex = provider === 'codex';
  // Provider-aware model chips (codex: gpt-5.4/5.5, claude_code: glm-5.1/5.2),
  // led by "默认" (clear → inherit). Hardcoded fallback; matches the server
  // catalog seed.
  const modelOptions = [
    { label: '默认', value: '' },
    ...modelPresetsFor(provider),
  ];
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
  // read (no agent round-trip). Results land in project.availableCommands → the
  // `commands` prop updates → this menu re-renders live with any new commands.
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
      setSettingsDirty(false);
      setSaving(false);
      // Auto-close on a successful save (clear `saving` first so we don't
      // setState on the about-to-unmount component).
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败,请重试。');
      setSaving(false);
    }
  };

  const handleInsert = (cmd: AgentCommandInfo) => {
    onInsertCommand(commandInsertText(cmd));
    onClose();
  };

  const agentLabel = isCodex ? 'Codex' : 'Claude Code';
  const accent = theme.colors.primary;
  const idleBorder = isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant;
  const rowBorder = isDark ? 'rgba(255,255,255,0.06)' : theme.colors.outlineVariant;
  const activeBg = isDark ? 'rgba(86,156,214,0.14)' : 'rgba(0,81,174,0.08)';

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
            {agentLabel} · {commands.length} 条快捷指令
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="收起工具菜单"
          onPress={onClose}
          style={styles.closeBtn}>
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
            CLOSE ▾
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
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
              当前有效
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

        {/* MODEL */}
        <Text
          style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }, styles.fieldLabel]}>
          模型 MODEL
        </Text>
        <TextInput
          value={modelBase}
          onChangeText={v => {
            setModelBase(v);
            setSettingsDirty(true);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="留空 = 用户默认"
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
          思考深度 EFFORT
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

        {error ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.error }, styles.errorText]}>
            {error}
          </Text>
        ) : null}

        <GlowButton
          title={saving ? '保存中…' : settingsDirty ? '保存' : '已是最新'}
          onPress={handleSave}
          disabled={saving || !settingsDirty}
          variant={settingsDirty ? 'primary' : 'outline'}
          style={styles.saveButton}
        />

        {/* Commands — separated */}
        <View style={[styles.divider, { borderTopColor: rowBorder }]} />
        <View style={styles.commandsHeader}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
            快捷指令
          </Text>
          <TouchableOpacity
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel="刷新命令列表"
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
              {refreshingCommands ? '刷新中…' : '↻ 刷新'}
            </Text>
          </TouchableOpacity>
        </View>
        {commands.length ? (
          <View style={styles.commandList}>
            {commands.map(cmd => {
              const remoteLabel =
                cmd.remote === 'local'
                  ? '本机'
                  : cmd.remote === 'unsupported'
                    ? '本机·不可远程'
                    : null;
              const dim = cmd.remote === 'unsupported';
              return (
              <TouchableOpacity
                key={`${cmd.scope ?? 'cmd'}-${cmd.name}`}
                testID={`tools-cmd-${cmd.name}`}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`插入 /${cmd.name}`}
                onPress={() => handleInsert(cmd)}
                style={[styles.commandRow, { borderColor: rowBorder }, dim && styles.commandRowDim]}>
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
                        {cmd.scope === 'project' ? '项目' : cmd.scope === 'user' ? '用户' : '内置'}
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
          </View>
        ) : (
          <View style={[styles.emptyCommands, { borderColor: rowBorder }]}>
            <IconBadge name="agent" tone="neutral" size={22} iconSize={12} />
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              该 Agent 暂未上报命令。命令来自项目/用户的 .claude/commands;确认 Agent 已更新并重连。
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
    gap: 6,
  },
  commandRow: {
    borderWidth: 1,
    borderRadius: 9,
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
    borderRadius: 9,
  },
});
