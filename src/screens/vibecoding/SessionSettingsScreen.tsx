import React, { useMemo, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore, useVibeRun } from '../../store/controlCenterStore';
import {
  catalogModelOptions,
  intensityToEffort,
  parseModelIntensity,
  providerLabel,
  type EffortProvider,
} from '../../utils/modelIntensity';
import { catalogEffortOptions, useModelOptions } from '../../hooks/useModelOptions';
import { useRecentModelOptions } from '../../hooks/useRecentModelOptions';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type SessionSettingsRoute = RouteProp<RootStackParamList, 'SessionSettings'>;

// Resolve the effort-provider discriminant from a session, falling back to the
// model label only for legacy snapshots that lack the authoritative field.
const resolveProvider = (
  provider?: EffortProvider,
  model?: string,
): EffortProvider =>
  provider ??
  (model?.toLowerCase().includes('codex')
    ? 'codex'
    : model?.toLowerCase().includes('opencode')
      ? 'opencode'
      : 'claude_code');

export const SessionSettingsScreen: React.FC = () => {
  const { t } = useTranslation('vibecoding');
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
  // Provider-aware model chips (codex: gpt-5.4/5.5, claude_code: glm-5.1/5.2),
  // led by "默认" (clear → inherit).
  const serverModelOptions = useMemo(
    () => catalogModelOptions(provider, providerCatalog),
    [provider, providerCatalog],
  );
  const { modelOptions: recentFirstModelOptions, rememberModel } =
    useRecentModelOptions(provider, serverModelOptions);
  const modelOptions = useMemo(
    () => [
      { label: t('sessionSettings.defaultChip'), value: '' },
      ...recentFirstModelOptions,
    ],
    [recentFirstModelOptions, t],
  );
  const effective = session?.effectiveModelConfig;
  const userDefaultLabel = t('sessionSettings.userDefault');
  const effectiveLabel = effective
    ? [
        `model=${effective.model || userDefaultLabel}`,
        effective.source?.model ? `(${effective.source.model})` : '',
        `· effort=${effective.effort || userDefaultLabel}`,
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
      rememberModel(modelBase);
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sessionSettings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (!session) {
    return (
      <SafeAreaWrapper>
        <TopAppBar title={t('sessionSettings.title')} onBack={navigation.goBack} />
        <View style={styles.emptyContainer}>
          <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurfaceVariant }]}>
            {t('sessionSettings.empty')}
          </Text>
        </View>
      </SafeAreaWrapper>
    );
  }

  if (session.purpose === 'goal') {
    return (
      <SafeAreaWrapper>
        <TopAppBar title={t('sessionSettings.title')} onBack={navigation.goBack} />
        <View style={styles.goalReadOnly}>
          <GlassPanel style={styles.noteCard}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>GOAL 配置</Text>
            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>模型与推理强度在 Goal 创建时固定。</Text>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>规划、任务执行和重新规划使用同一份配置，普通会话设置不会覆盖它。</Text>
            {effectiveLabel ? <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>{effectiveLabel}</Text> : null}
          </GlassPanel>
        </View>
      </SafeAreaWrapper>
    );
  }

  return (
    <SafeAreaWrapper>
      <TopAppBar title={t('sessionSettings.title')} subtitle={t('sessionSettings.subtitle')} onBack={navigation.goBack} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          {t('sessionSettings.sectionModel')}
        </Text>
        <TextInput
          value={modelBase}
          onChangeText={setModelBase}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t('sessionSettings.modelPlaceholder')}
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
          {modelOptions.map(preset => {
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
          {t('sessionSettings.modelHint')}
        </Text>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          {t('sessionSettings.sectionEffort')}
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
          {t('sessionSettings.effortHint', {
            provider: providerLabel(provider),
            levels: effortOptions.filter(o => o.value).map(o => o.value).join('/'),
          })}
        </Text>

        {effectiveLabel ? (
          <GlassPanel style={styles.noteCard}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.secondary }]}>
              {t('sessionSettings.effective')}
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
              {effectiveLabel}
            </Text>
          </GlassPanel>
        ) : null}

        <GlassPanel style={styles.noteCard}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
            {t('sessionSettings.timingTitle')}
          </Text>
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {t('sessionSettings.timingDetail')}
          </Text>
        </GlassPanel>

        {error && (
          <Text style={[theme.typography.bodySm, { color: theme.colors.error }, styles.errorText]}>
            {error}
          </Text>
        )}

        <GlowButton
          title={saving ? t('sessionSettings.saving') : t('sessionSettings.saveButton')}
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
  goalReadOnly: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
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
