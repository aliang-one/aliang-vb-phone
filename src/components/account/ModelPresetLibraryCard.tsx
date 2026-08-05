import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { GlowButton } from '../shared/GlowButton';
import { IconBadge } from '../visual/IconBadge';
import { useModelOptions } from '../../hooks/useModelOptions';
import {
  fetchModelOptions,
  getUserPresets,
  putUserPresets,
  type CatalogProvider,
  type ModelPreset,
  type ModelOptions,
} from '../../api/modelConfig';
import {
  EFFORT_PROVIDERS,
  normalizeProvider,
  providerLabel,
  type EffortProvider,
} from '../../utils/modelIntensity';
import { useTranslation } from 'react-i18next';

// RN doesn't register the global crypto.randomUUID polyfill by default (no
// react-native-get-random-values import in index.js), so synthesize a unique
// id locally. Good enough for client-side row keys + server round-trips.
const newPresetId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const PROVIDER_OPTIONS: Array<{ label: string; value: EffortProvider }> = [
  ...EFFORT_PROVIDERS.map(value => ({ label: providerLabel(value), value })),
];

interface DraftState {
  id: string;
  label: string;
  provider: EffortProvider;
  model: string;
  effort: string;
}

const toDraft = (preset: ModelPreset): DraftState => ({
  id: preset.id,
  label: preset.label,
  provider: normalizeProvider(preset.provider) ?? 'codex',
  model: preset.model ?? '',
  effort: preset.effort ?? '',
});

/**
 * The user's personal model-preset library (loaded from the server). Add / edit
 * / delete presets; each preset's model + effort are dropdowns sourced from the
 * matching provider's catalog entry. Saves the user's whole list via
 * `putUserPresets`.
 *
 * NOTE: `fetchModelOptions().presets` returns the MERGED server+user presets
 * (read-only view), while `getUserPresets()` returns just the user's own list
 * (what we PUT). We edit + save the user's own list.
 */
export const ModelPresetLibraryCard: React.FC = () => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('account');
  const { providerCatalog, loading: catalogLoading } = useModelOptions();

  const [presets, setPresets] = useState<ModelPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { presets: userPresets } = await getUserPresets();
      setPresets(userPresets ?? []);
    } catch {
      // Fallback to the merged view if the user-presets endpoint 404s; the PUT
      // below will create the user's list on first save.
      try {
        const opts: ModelOptions = await fetchModelOptions();
        setPresets(opts.presets ?? []);
      } catch (err2) {
        setError(
          err2 instanceof Error ? err2.message : t('presetLibrary.loadErrorFallback'),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const modelOptionsFor = useCallback(
    (provider: EffortProvider) =>
      providerCatalog.find(item => item.provider === provider)?.models ?? [],
    [providerCatalog],
  );
  const effortOptionsFor = useCallback(
    (provider: EffortProvider) => {
      const efforts =
        providerCatalog.find(item => item.provider === provider)?.efforts ?? [];
      const list = [...efforts];
      if (!list.some(o => o.value === '')) {
        list.unshift({ label: t('common.default'), value: '' });
      }
      return list;
    },
    [providerCatalog, t],
  );

  const handleAdd = () => {
    setEditing({
      id: newPresetId(),
      label: '',
      provider: 'codex',
      model: '',
      effort: '',
    });
  };

  const handleEdit = (preset: ModelPreset) => {
    setEditing(toDraft(preset));
  };

  const handleDelete = async (preset: ModelPreset) => {
    const next = presets.filter(item => item.id !== preset.id);
    setPresets(next);
    setSaving(true);
    setError(null);
    try {
      const { presets: saved } = await putUserPresets(next);
      setPresets(saved ?? next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('presetLibrary.deleteError'));
      setPresets(presets); // rollback
    } finally {
      setSaving(false);
    }
  };

  const handleCommitDraft = async () => {
    if (!editing) return;
    if (!editing.label.trim()) {
      setError(t('presetLibrary.emptyNameError'));
      return;
    }
    const draftPreset: ModelPreset = {
      id: editing.id,
      label: editing.label.trim(),
      provider: editing.provider,
      model: editing.model.trim() || null,
      effort: editing.effort.trim() || null,
    };
    const exists = presets.some(item => item.id === editing.id);
    const next = exists
      ? presets.map(item => (item.id === editing.id ? draftPreset : item))
      : [...presets, draftPreset];
    setPresets(next);
    setEditing(null);
    setError(null);
    setSaving(true);
    try {
      const { presets: saved } = await putUserPresets(next);
      setPresets(saved ?? next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('presetLibrary.saveError'));
      setPresets(presets); // rollback
    } finally {
      setSaving(false);
    }
  };

  const accent = theme.colors.primary;
  const idleBorder = isDark
    ? 'rgba(255,255,255,0.08)'
    : theme.colors.outlineVariant;
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

  const draftModelOptions = editing ? modelOptionsFor(editing.provider) : [];
  const draftEffortOptions = editing ? effortOptionsFor(editing.provider) : [];

  const sortedPresets = useMemo(
    () => [...presets].sort((a, b) => a.label.localeCompare(b.label)),
    [presets],
  );

  return (
    <GlassPanel style={styles.card}>
      <View style={styles.header}>
        <IconBadge name="code" tone="primary" size={28} iconSize={14} />
        <View style={styles.headerCopy}>
          <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
            {t('presetLibrary.title')}
          </Text>
          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}
            numberOfLines={1}>
            {t('presetLibrary.subtitle', { count: presets.length })}
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={t('presetLibrary.addA11yLabel')}
          onPress={handleAdd}
          style={[styles.addBtn, { borderColor: accent }]}>
          <Text style={[theme.typography.labelMd, { color: accent }]}>{t('presetLibrary.addButton')}</Text>
        </TouchableOpacity>
      </View>

      {loading || catalogLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            {t('presetLibrary.loading')}
          </Text>
        </View>
      ) : null}

      {error ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
          {error}
        </Text>
      ) : null}

      {/* Existing presets list */}
      {!sortedPresets.length && !loading && !catalogLoading ? (
        <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
          {t('presetLibrary.empty')}
        </Text>
      ) : null}
      <View style={styles.list}>
        {sortedPresets.map(preset => (
          <View key={preset.id} style={[styles.row, { borderColor: idleBorder }]}>
            <View style={styles.rowMain}>
              <Text
                style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}
                numberOfLines={1}>
                {preset.label}
              </Text>
              <Text
                style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={1}>
                {preset.provider} · {preset.model || t('common.default')} ·{' '}
                {preset.effort || t('common.default')}
              </Text>
            </View>
            <View style={styles.rowActions}>
              <TouchableOpacity
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('presetLibrary.editA11yLabel', { label: preset.label })}
                onPress={() => handleEdit(preset)}
                style={styles.rowBtn}>
                <Text style={[theme.typography.labelSm, { color: accent }]}>{t('presetLibrary.editLabel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('presetLibrary.deleteA11yLabel', { label: preset.label })}
                onPress={() => handleDelete(preset)}
                style={styles.rowBtn}>
                <Text
                  style={[theme.typography.labelSm, { color: theme.colors.error }]}>
                  {t('presetLibrary.deleteLabel')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* Inline editor */}
      {editing ? (
        <View style={[styles.editor, { borderColor: accent }]}>
          <TextInput
            value={editing.label}
            onChangeText={v => setEditing({ ...editing, label: v })}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('presetLibrary.namePlaceholder')}
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

          <Text
            style={[
              theme.typography.labelSm,
              { color: theme.colors.onSurfaceVariant },
              styles.fieldLabel,
            ]}>
            {t('common.providerFieldLabel')}
          </Text>
          <View style={styles.chipRow}>
            {PROVIDER_OPTIONS.map(opt => {
              const active = editing.provider === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  activeOpacity={0.75}
                  onPress={() =>
                    setEditing({
                      ...editing,
                      provider: opt.value as CatalogProvider,
                      model: '',
                      effort: '',
                    })
                  }
                  style={chipStyle(active)}>
                  <Text style={chipText(active)}>{opt.label}</Text>
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
            {t('common.modelFieldLabel')}
          </Text>
          <TextInput
            value={editing.model}
            onChangeText={v => setEditing({ ...editing, model: v })}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('common.inheritPlaceholder')}
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
          {draftModelOptions.length ? (
            <View style={styles.chipRow}>
              {draftModelOptions.map(opt => {
                const active = editing.model === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value || 'default'}
                    activeOpacity={0.75}
                    onPress={() => setEditing({ ...editing, model: opt.value })}
                    style={chipStyle(active)}>
                    <Text style={chipText(active)}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          <Text
            style={[
              theme.typography.labelSm,
              { color: theme.colors.onSurfaceVariant },
              styles.fieldLabel,
            ]}>
            {t('common.effortFieldLabel')}
          </Text>
          <View style={styles.chipRow}>
            {draftEffortOptions.map(opt => {
              const active = editing.effort === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value || 'default'}
                  activeOpacity={0.75}
                  onPress={() => setEditing({ ...editing, effort: opt.value })}
                  style={chipStyle(active)}>
                  <Text style={chipText(active)}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.editorActions}>
            <GlowButton
              title={t('presetLibrary.cancel')}
              onPress={() => setEditing(null)}
              variant="outline"
              style={styles.editorBtn}
            />
            <GlowButton
              title={saving ? t('common.saving') : t('common.save')}
              onPress={handleCommitDraft}
              loading={saving}
              style={styles.editorBtn}
            />
          </View>
        </View>
      ) : null}
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 12,
    gap: 8,
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
  addBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  list: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 9,
    gap: 10,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 10,
  },
  rowBtn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  editor: {
    borderWidth: 1,
    borderRadius: 11,
    padding: 11,
    marginTop: 6,
    gap: 4,
  },
  textInput: {
    minHeight: 40,
    borderWidth: 1,
    paddingHorizontal: 11,
  },
  fieldLabel: {
    marginTop: 8,
    marginBottom: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 6,
  },
  chip: {
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  editorActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  editorBtn: {
    flex: 1,
  },
});
