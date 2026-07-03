import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { GlowButton } from '../shared/GlowButton';
import { IconBadge } from '../visual/IconBadge';
import { ApiResponseError } from '../../api/client';
import {
  putUserModelDefault,
  type CatalogProvider,
  type UserModelDefault,
} from '../../api/modelConfig';
import {
  catalogEffortOptions,
  refreshModelOptions,
  useModelOptions,
} from '../../hooks/useModelOptions';
import {
  EFFORT_PROVIDERS,
  normalizeProvider,
  providerLabel as formatProviderLabel,
  type EffortProvider,
} from '../../utils/modelIntensity';
import { useTranslation } from 'react-i18next';

type ProviderDraft = EffortProvider | '';

const PROVIDER_OPTIONS: Array<{ label: string; value: ProviderDraft }> = [
  ...EFFORT_PROVIDERS.map(value => ({ label: formatProviderLabel(value), value })),
];

export const UserModelDefaultCard: React.FC = () => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('account');
  const { providerCatalog, userDefault, loading, error, refresh } = useModelOptions();
  const initialProvider = normalizeProvider(userDefault.provider ?? undefined) ?? 'codex';
  const [provider, setProvider] = useState<ProviderDraft>(initialProvider);
  const [model, setModel] = useState(userDefault.model ?? '');
  const [effort, setEffort] = useState(userDefault.effort ?? '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setProvider(normalizeProvider(userDefault.provider ?? undefined) ?? 'codex');
    setModel(userDefault.model ?? '');
    setEffort(userDefault.effort ?? '');
  }, [userDefault.provider, userDefault.model, userDefault.effort]);

  const effortOptions = useMemo(
    () => catalogEffortOptions(provider || 'codex', providerCatalog),
    [provider, providerCatalog],
  );
  const modelOptions = useMemo(
    () =>
      provider
        ? providerCatalog.find(item => item.provider === provider)?.models ?? []
        : [],
    [provider, providerCatalog],
  );
  const savedProvider = normalizeProvider(userDefault.provider ?? undefined) ?? 'codex';
  const dirty =
    provider !== savedProvider ||
    model.trim() !== (userDefault.model ?? '') ||
    effort.trim() !== (userDefault.effort ?? '');

  const accent = theme.colors.primary;
  const providerLabel = (provider?: CatalogProvider | null) =>
    provider ? formatProviderLabel(provider) : t('userDefault.notSet');
  const idleBorder = isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant;
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

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const next: UserModelDefault = await putUserModelDefault({
        provider: provider || null,
        model: model.trim() || null,
        effort: effort.trim() || null,
      });
      setProvider(normalizeProvider(next.provider ?? undefined) ?? 'codex');
      setModel(next.model ?? '');
      setEffort(next.effort ?? '');
      refreshModelOptions();
      refresh();
      setStatus(t('userDefault.savedStatus'));
    } catch (err) {
      setStatus(
        err instanceof ApiResponseError && err.status === 404
          ? t('userDefault.save404Error')
          : err instanceof Error
            ? `${t('userDefault.saveErrorPrefix')} ${err.message}`
            : t('userDefault.saveErrorFallback'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassPanel style={styles.card}>
      <TouchableOpacity
        activeOpacity={0.78}
        accessibilityRole="button"
        accessibilityLabel={expanded ? t('userDefault.collapseA11yLabel') : t('userDefault.expandA11yLabel')}
        onPress={() => setExpanded(value => !value)}
        style={styles.header}>
        <IconBadge name="settings" tone="primary" size={28} iconSize={14} />
        <View style={styles.headerCopy}>
          <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
            {t('userDefault.title')}
          </Text>
          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}
            numberOfLines={1}>
            {t('userDefault.subtitle')}
          </Text>
        </View>
        <IconBadge
          name="chevron"
          tone="neutral"
          size={26}
          iconSize={13}
          style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            {t('common.loadingCatalog')}
          </Text>
        </View>
      ) : null}
      {error ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
          {error}{t('common.errorFallback')}
        </Text>
      ) : null}

      <Text
        style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
        {t('userDefault.currentPrefix')} {providerLabel(userDefault.provider)} · model={userDefault.model || t('common.default')} · effort={userDefault.effort || t('common.default')}
      </Text>

      {expanded ? (
        <>
          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }, styles.fieldLabel]}>
            {t('common.providerFieldLabel')}
          </Text>
          <View style={styles.chipRow}>
            {PROVIDER_OPTIONS.map(opt => {
              const active = provider === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  activeOpacity={0.75}
                  onPress={() => {
                    setProvider(opt.value);
                    setEffort('');
                  }}
                  style={chipStyle(active)}>
                  <Text style={chipText(active)}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }, styles.fieldLabel]}>
            {t('common.modelFieldLabel')}
          </Text>
          <TextInput
            value={model}
            onChangeText={setModel}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('userDefault.modelPlaceholder')}
            placeholderTextColor={theme.colors.onSurfaceVariant}
            style={[
              theme.typography.bodyMd,
              styles.textInput,
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
          {modelOptions.length ? (
            <View style={styles.chipRow}>
              {modelOptions.map(opt => {
                const active = model === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    activeOpacity={0.75}
                    onPress={() => setModel(opt.value)}
                    style={chipStyle(active)}>
                    <Text style={chipText(active)}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }, styles.fieldLabel]}>
            {t('common.effortFieldLabel')}
          </Text>
          <View style={styles.chipRow}>
            {effortOptions.map(opt => {
              const active = effort === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value || 'default'}
                  activeOpacity={0.75}
                  onPress={() => setEffort(opt.value)}
                  style={chipStyle(active)}>
                  <Text style={chipText(active)}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {status ? (
            <Text
              style={[
                theme.typography.bodySm,
                { color: status.startsWith(t('userDefault.failureStatusPrefix')) ? theme.colors.error : theme.colors.secondary },
              ]}>
              {status}
            </Text>
          ) : null}

          <GlowButton
            title={saving ? t('common.saving') : dirty ? t('userDefault.saveDefault') : t('userDefault.upToDate')}
            onPress={handleSave}
            disabled={saving || !dirty}
            variant={dirty ? 'primary' : 'outline'}
          />
        </>
      ) : null}
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 12,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  headerCopy: {
    flex: 1,
    gap: 1,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  fieldLabel: {
    marginTop: 6,
  },
  textInput: {
    minHeight: 38,
    borderWidth: 1,
    paddingHorizontal: 11,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  chip: {
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
});
