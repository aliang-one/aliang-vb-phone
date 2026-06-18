import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore, useVibeRun } from '../../store/controlCenterStore';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type SessionSettingsRoute = RouteProp<RootStackParamList, 'SessionSettings'>;

// Valid reasoning-effort tiers accepted downstream by sub2api
// (normalizeOpenAIReasoningEffort: low/medium/high/xhigh). We bake the tier into
// the model name as a `-<tier>` suffix (e.g. "glm-5.2-xhigh") because the phone
// can only control the agent CLI's `--model` flag — it cannot inject a separate
// reasoning_effort field into the CLI's outbound request. sub2api splits the
// model string on `-`/`_`/space and reads the last segment as the effort.
const INTENSITY_TIERS = ['low', 'medium', 'high', 'xhigh'] as const;
type Intensity = 'none' | (typeof INTENSITY_TIERS)[number];

// Model name presets (concrete model ids). "默认" clears the field (revert to
// the agent CLI's own default). Free text in the input overrides the chips.
const MODEL_PRESETS: Array<{ label: string; value: string }> = [
  { label: '默认', value: '' },
  { label: 'glm-5.2', value: 'glm-5.2' },
  { label: 'gpt-5.2', value: 'gpt-5.2' },
  { label: 'gpt-5.5', value: 'gpt-5.5' },
  { label: 'claude-sonnet-4-6', value: 'claude-sonnet-4-6' },
];

const INTENSITY_OPTIONS: Array<{ label: string; value: Intensity }> = [
  { label: '默认', value: 'none' },
  { label: 'LOW', value: 'low' },
  { label: 'MEDIUM', value: 'medium' },
  { label: 'HIGH', value: 'high' },
  { label: 'XHIGH', value: 'xhigh' },
];

// `VibeCodingRun.model` is a DISPLAY label: when no concrete model is set it
// falls back to one of these provider names (see aiSessionModelLabel in
// internals.ts). Treat those as "no explicit model".
const PROVIDER_DEFAULT_LABELS = new Set(['Claude Code', 'GPT-5 Codex']);

// Split a stored model string into base name + intensity tier. "glm-5.2-xhigh"
// -> { base: "glm-5.2", intensity: "xhigh" }; "gpt-5.2" -> { base, "none" }.
const parseModelIntensity = (
  model: string | undefined,
): { base: string; intensity: Intensity } => {
  const value = (model ?? '').trim();
  if (!value || PROVIDER_DEFAULT_LABELS.has(value)) {
    return { base: '', intensity: 'none' };
  }
  const last = value.split('-').pop() ?? '';
  if ((INTENSITY_TIERS as readonly string[]).includes(last)) {
    return { base: value.slice(0, -(last.length + 1)), intensity: last as Intensity };
  }
  return { base: value, intensity: 'none' };
};

const composeModel = (base: string, intensity: Intensity) => {
  const trimmed = base.trim();
  if (!trimmed) return ''; // no model => use the agent's default
  return intensity === 'none' ? trimmed : `${trimmed}-${intensity}`;
};

export const SessionSettingsScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<SessionSettingsRoute>();
  const session = useVibeRun(route.params.sessionId);
  const updateAgentSession = useControlCenterStore(
    state => state.updateAgentSession,
  );

  const parsed = parseModelIntensity(session?.model);
  const [modelBase, setModelBase] = useState(parsed.base);
  const [intensity, setIntensity] = useState<Intensity>(parsed.intensity);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      // Compose `model` = base + optional `-<intensity>` suffix. "" clears
      // (revert to CLI default). Takes effect on the NEXT user message — the
      // server re-emits ai.session.create before each ai.message and the gateway
      // re-spawns the CLI with the new --model; sub2api then splits off the
      // intensity suffix as reasoning_effort.
      await updateAgentSession(session.id, {
        model: composeModel(modelBase, intensity),
      });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败,请重试。');
    } finally {
      setSaving(false);
    }
  };

  if (!session) {
    return (
      <SafeAreaWrapper>
        <TopAppBar title="会话设置" onBack={navigation.goBack} />
        <View style={styles.emptyContainer}>
          <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurfaceVariant }]}>
            会话不存在或已结束。
          </Text>
        </View>
      </SafeAreaWrapper>
    );
  }

  return (
    <SafeAreaWrapper>
      <TopAppBar title="会话设置" subtitle="MODEL / INTENSITY" onBack={navigation.goBack} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          1. 模型 MODEL
        </Text>
        <TextInput
          value={modelBase}
          onChangeText={setModelBase}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="留空使用 Agent 默认模型"
          placeholderTextColor={theme.colors.onSurfaceVariant}
          style={[
            theme.typography.bodyMd,
            styles.modelInput,
            {
              color: theme.colors.onSurface,
              borderRadius: theme.borderRadius.md,
              borderColor: isDark
                ? 'rgba(255,255,255,0.08)'
                : theme.colors.outlineVariant,
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.04)'
                : theme.colors.surfaceContainerLow,
            },
          ]}
        />
        <View style={styles.chipRow}>
          {MODEL_PRESETS.map(preset => {
            const active =
              preset.value === ''
                ? modelBase.trim() === ''
                : modelBase.trim() === preset.value;
            return (
              <TouchableOpacity
                key={preset.label}
                activeOpacity={0.75}
                onPress={() => setModelBase(preset.value)}
                style={[
                  styles.chip,
                  {
                    borderRadius: theme.borderRadius.full,
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(86, 156, 214, 0.12)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : 'transparent',
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.labelSm,
                    {
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                    },
                  ]}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
            styles.hint,
          ]}>
          指定模型名后会作为 --model 传给 codex / claude;留空则用 CLI 默认模型。
        </Text>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          2. 工作强度 INTENSITY
        </Text>
        <View style={styles.chipRow}>
          {INTENSITY_OPTIONS.map(option => {
            const active = intensity === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                activeOpacity={0.75}
                onPress={() => setIntensity(option.value)}
                disabled={!modelBase.trim()}
                style={[
                  styles.chip,
                  {
                    borderRadius: theme.borderRadius.full,
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(86, 156, 214, 0.12)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : 'transparent',
                    opacity: modelBase.trim() ? 1 : 0.4,
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.labelSm,
                    {
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                    },
                  ]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
            styles.hint,
          ]}>
          强度会拼进模型名后缀(如 {modelBase.trim() || 'glm-5.2'}-
          {intensity === 'none' ? 'xhigh' : intensity}),由 sub2api 解析为
          reasoning_effort;选「默认」则不附加。需先选模型才能设强度。
        </Text>

        <GlassPanel style={styles.noteCard}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
            生效时机
          </Text>
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            更改会在你发送的下一条消息生效;当前正在运行的一轮仍用原配置,无需重启会话。
          </Text>
        </GlassPanel>

        {error && (
          <Text style={[theme.typography.bodySm, { color: theme.colors.error }, styles.errorText]}>
            {error}
          </Text>
        )}

        <GlowButton
          title={saving ? '保存中…' : '保存设置'}
          onPress={handleSave}
          disabled={saving}
          style={styles.saveButton}
        />
      </ScrollView>
      {saving && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      )}
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    marginTop: 18,
    marginBottom: 8,
  },
  modelInput: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  hint: {
    marginTop: 10,
  },
  noteCard: {
    marginTop: 18,
    padding: 12,
    gap: 8,
  },
  errorText: {
    marginTop: 12,
  },
  saveButton: {
    marginTop: 16,
  },
  emptyContainer: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
});
