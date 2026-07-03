import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '../shared/GlassPanel';
import { GlowButton } from '../shared/GlowButton';
import { IconBadge } from '../visual/IconBadge';
import { catalogEffortOptions, useModelOptions } from '../../hooks/useModelOptions';
import {
  putProjectModelConfig,
  type ProjectProviderModelConfig,
  type ProviderModelSelection,
} from '../../api/modelConfig';
import {
  EFFORT_PROVIDERS,
  normalizeProvider,
  providerLabel,
  type EffortProvider,
} from '../../utils/modelIntensity';

interface ProjectModelSelectionCardProps {
  projectId: string;
  modelConfig?: ProjectProviderModelConfig;
  /** Older server payloads only carried one provider/model/effort triple. */
  legacyOverride?: {
    provider?: string | null;
    model?: string | null;
    effort?: string | null;
  };
}

type Drafts = Record<EffortProvider, { model: string; effort: string }>;

const PROVIDER_TABS: Array<{ label: string; value: EffortProvider }> = [
  ...EFFORT_PROVIDERS.map(value => ({ label: providerLabel(value), value })),
];

const emptyDrafts = (): Drafts =>
  EFFORT_PROVIDERS.reduce(
    (acc, provider) => ({
      ...acc,
      [provider]: { model: '', effort: '' },
    }),
    {} as Drafts,
  );

const draftsFromConfig = (
  config?: ProjectProviderModelConfig,
  legacy?: ProjectModelSelectionCardProps['legacyOverride'],
): Drafts => {
  const next = emptyDrafts();
  for (const provider of PROVIDER_TABS.map(tab => tab.value)) {
    next[provider] = {
      model: config?.[provider]?.model ?? '',
      effort: config?.[provider]?.effort ?? '',
    };
  }
  const legacyProvider = normalizeProvider(legacy?.provider ?? undefined);
  if (legacyProvider && !config?.[legacyProvider]) {
    next[legacyProvider] = {
      model: legacy?.model ?? '',
      effort: legacy?.effort ?? '',
    };
  }
  return next;
};

const normalizeDrafts = (drafts: Drafts): Drafts =>
  EFFORT_PROVIDERS.reduce(
    (acc, provider) => ({
      ...acc,
      [provider]: {
        model: drafts[provider].model.trim(),
        effort: drafts[provider].effort.trim(),
      },
    }),
    {} as Drafts,
  );

const serializeConfig = (drafts: Drafts): ProjectProviderModelConfig => {
  const trimmed = normalizeDrafts(drafts);
  const next: ProjectProviderModelConfig = {};
  for (const provider of PROVIDER_TABS.map(tab => tab.value)) {
    const draft = trimmed[provider];
    if (draft.model || draft.effort) {
      next[provider] = {
        model: draft.model || null,
        effort: draft.effort || null,
      };
    }
  }
  return next;
};

const hasSameDrafts = (a: Drafts, b: Drafts) =>
  PROVIDER_TABS.every(
    tab =>
      a[tab.value].model === b[tab.value].model &&
      a[tab.value].effort === b[tab.value].effort,
  );

/**
 * Project-scoped model selection editor. Each agent provider has a separate
 * tabs; each provider keeps its own model/effort picks. A newly-created session
 * reads the tab matching that session's provider.
 */
export const ProjectModelSelectionCard: React.FC<ProjectModelSelectionCardProps> = ({
  projectId,
  modelConfig,
  legacyOverride,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('devices');
  const { providerCatalog, serverDefault } = useModelOptions();
  const [activeProvider, setActiveProvider] = useState<EffortProvider>('codex');
  const [drafts, setDrafts] = useState<Drafts>(() =>
    draftsFromConfig(modelConfig, legacyOverride),
  );
  const [baseline, setBaseline] = useState<Drafts>(() =>
    draftsFromConfig(modelConfig, legacyOverride),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const legacyProvider = legacyOverride?.provider;
  const legacyModel = legacyOverride?.model;
  const legacyEffort = legacyOverride?.effort;

  useEffect(() => {
    const next = draftsFromConfig(modelConfig, {
      provider: legacyProvider,
      model: legacyModel,
      effort: legacyEffort,
    });
    setDrafts(next);
    setBaseline(next);
  }, [legacyEffort, legacyModel, legacyProvider, modelConfig]);

  const current = drafts[activeProvider];
  const normalizedDrafts = useMemo(() => normalizeDrafts(drafts), [drafts]);
  const normalizedBaseline = useMemo(() => normalizeDrafts(baseline), [baseline]);
  const dirty = !hasSameDrafts(normalizedDrafts, normalizedBaseline);
  const effortOptions = useMemo(
    () => catalogEffortOptions(activeProvider, providerCatalog),
    [activeProvider, providerCatalog],
  );

  const idleBorder = isDark
    ? 'rgba(255,255,255,0.08)'
    : theme.colors.outlineVariant;
  const accent = theme.colors.primary;
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
  const tabStyle = (active: boolean) => [
    styles.providerTab,
    {
      borderRadius: theme.borderRadius.md,
      borderColor: active ? accent : idleBorder,
      backgroundColor: active ? activeBg : 'transparent',
    },
  ];

  const updateActiveDraft = (patch: Partial<ProviderModelSelection>) => {
    setSaved(false);
    setDrafts(prev => ({
      ...prev,
      [activeProvider]: {
        ...prev[activeProvider],
        ...(patch.model !== undefined ? { model: patch.model ?? '' } : null),
        ...(patch.effort !== undefined ? { effort: patch.effort ?? '' } : null),
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const model_config = serializeConfig(drafts);
      await putProjectModelConfig(projectId, {
        provider: null,
        model: null,
        effort: null,
        model_config,
      });
      const nextBaseline = draftsFromConfig(model_config);
      setBaseline(nextBaseline);
      setDrafts(nextBaseline);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modelOverride.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const activeEffectiveModel =
    current.model.trim() || serverDefault.model || t('modelOverride.default');
  const activeEffectiveEffort =
    current.effort.trim() || serverDefault.effort || t('modelOverride.default');

  return (
    <GlassPanel style={styles.card}>
      <View style={styles.header}>
        <IconBadge name="code" tone="primary" size={28} iconSize={14} />
        <View style={styles.headerCopy}>
          <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
            {t('modelOverride.title')}
          </Text>
          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}
            numberOfLines={1}>
            {t('modelOverride.subtitle')}
          </Text>
        </View>
      </View>

      <View style={styles.providerTabs}>
        {PROVIDER_TABS.map(tab => {
          const active = activeProvider === tab.value;
          const hasSelection = Boolean(
            drafts[tab.value].model.trim() || drafts[tab.value].effort.trim(),
          );
          return (
            <TouchableOpacity
              key={tab.value}
              activeOpacity={0.75}
              testID={`project-model-provider-${tab.value}`}
              onPress={() => setActiveProvider(tab.value)}
              style={tabStyle(active)}>
              <Text style={chipText(active)}>{tab.label}</Text>
              {hasSelection ? (
                <View
                  style={[
                    styles.tabDot,
                    { backgroundColor: active ? accent : theme.colors.onSurfaceVariant },
                  ]}
                />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <Text
        style={[
          theme.typography.labelSm,
          { color: theme.colors.onSurfaceVariant },
          styles.fieldLabel,
        ]}>
        {providerLabel(activeProvider).toUpperCase()} MODEL
      </Text>
      <TextInput
        testID={`project-model-input-${activeProvider}`}
        value={current.model}
        onChangeText={value => updateActiveDraft({ model: value })}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('modelOverride.inheritPlaceholder')}
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

      <Text
        style={[
          theme.typography.labelSm,
          { color: theme.colors.onSurfaceVariant },
          styles.fieldLabel,
        ]}>
        {providerLabel(activeProvider).toUpperCase()} EFFORT
      </Text>
      <View style={styles.chipRow}>
        {effortOptions.map(opt => {
          const active = current.effort === opt.value;
          return (
            <TouchableOpacity
              key={opt.value || 'default'}
              activeOpacity={0.75}
              onPress={() => updateActiveDraft({ effort: opt.value })}
              style={chipStyle(active)}>
              <Text style={chipText(active)}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View
        style={[
          styles.effectiveRow,
          {
            borderRadius: theme.borderRadius.md,
            borderColor: idleBorder,
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
          {t('modelOverride.currentTab')}
        </Text>
        <Text
          style={[
            theme.typography.codeSm,
            { color: theme.colors.onSurface, flexShrink: 1 },
          ]}
          numberOfLines={2}>
          {providerLabel(activeProvider)} · model={activeEffectiveModel} ·
          effort={activeEffectiveEffort}
        </Text>
      </View>

      {error ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
          {error}
        </Text>
      ) : null}
      {saved && !error ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.secondary }]}>
          {t('modelOverride.saved')}
        </Text>
      ) : null}

      <GlowButton
        testID="project-model-save"
        title={saving ? t('modelOverride.saving') : dirty ? t('modelOverride.save') : t('modelOverride.upToDate')}
        onPress={handleSave}
        disabled={saving || !dirty}
        variant={dirty ? 'primary' : 'outline'}
        style={styles.saveButton}
      />
      {saving ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : null}
    </GlassPanel>
  );
};

export const ProjectModelOverrideCard = ProjectModelSelectionCard;

const styles = StyleSheet.create({
  card: {
    padding: 12,
    gap: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 10,
  },
  headerCopy: {
    flex: 1,
    gap: 1,
  },
  providerTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  providerTab: {
    flex: 1,
    minHeight: 38,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  tabDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  fieldLabel: {
    marginTop: 10,
    marginBottom: 5,
  },
  modelInput: {
    minHeight: 40,
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
  effectiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginTop: 12,
  },
  saveButton: {
    marginTop: 12,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
});
