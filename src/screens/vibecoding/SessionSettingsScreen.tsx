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
import {
  MODEL_PRESETS,
  intensityToEffort,
  parseModelIntensity,
  type EffortProvider,
} from '../../utils/modelIntensity';
import { catalogEffortOptions, useModelOptions } from '../../hooks/useModelOptions';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type SessionSettingsRoute = RouteProp<RootStackParamList, 'SessionSettings'>;

// Resolve the effort-provider discriminant from a session, falling back to the
// model label only for legacy snapshots that lack the authoritative field.
const resolveProvider = (
  provider?: EffortProvider,
  model?: string,
): EffortProvider =>
  provider ?? (model?.toLowerCase().includes('codex') ? 'codex' : 'claude_code');

export const SessionSettingsScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<SessionSettingsRoute>();
  const session = useVibeRun(route.params.sessionId);
  const updateAgentSession = useControlCenterStore(
    state => state.updateAgentSession,
  );

  const provider = resolveProvider(session?.provider, session?.model);
  // Live catalog drives the effort chips (codex 4, claude 6) with a hardcoded
  // fallback before it loads.
  const { providerCatalog } = useModelOptions();
  const effortOptions = catalogEffortOptions(provider, providerCatalog);
  const effective = session?.effectiveModelConfig;
  const effectiveLabel = effective
    ? [
        `model=${effective.model || '用户默认'}`,
        effective.source?.model ? `(${effective.source.model})` : '',
        `· effort=${effective.effort || '用户默认'}`,
        effective.source?.effort ? `(${effective.source.effort})` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : null;
  const parsed = parseModelIntensity(session?.model);
  const [modelBase, setModelBase] = useState(parsed.base);
  // Prefer the authoritative effort field; fall back to a legacy baked suffix
  // so old sessions migrate to the clean model + separate effort on first save.
  const [effortDraft, setEffortDraft] = useState(
    session?.effort?.trim() || intensityToEffort(parsed.intensity),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      // Send a CLEAN model base + a separate effort field. "" clears each
      // (revert to CLI default). Takes effect on the NEXT user message — the
      // server re-emits ai.session.create before each ai.message carrying both;
      // the gateway injects --model and derives reasoning effort from `effort`.
      await updateAgentSession(session.id, {
        model: modelBase.trim(),
        effort: effortDraft.trim(),
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
      <TopAppBar title="会话设置" subtitle="MODEL / EFFORT" onBack={navigation.goBack} />
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
          placeholder="留空继承用户默认模型"
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
          指定模型名后会作为本 session 覆盖;留空继承 Me 中的用户默认。
        </Text>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          2. 工作强度 EFFORT
        </Text>
        <View style={styles.chipRow}>
          {effortOptions.map(option => {
            const active = effortDraft === option.value;
            return (
              <TouchableOpacity
                key={option.value || 'default'}
                activeOpacity={0.75}
                onPress={() => setEffortDraft(option.value)}
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
          EFFORT 作为独立字段下发,网关据此设置推理强度({provider === 'codex' ? 'Codex' : 'Claude'} 档位:{effortOptions.filter(o => o.value).map(o => o.value).join('/')});选「默认」则继承用户默认。与模型互相独立,无需先选模型。
        </Text>

        {effectiveLabel ? (
          <GlassPanel style={styles.noteCard}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.secondary }]}>
              当前有效
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
              {effectiveLabel}
            </Text>
          </GlassPanel>
        ) : null}

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
