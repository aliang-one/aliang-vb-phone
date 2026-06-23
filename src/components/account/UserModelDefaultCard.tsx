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
  normalizeProvider,
  type EffortProvider,
} from '../../utils/modelIntensity';

type ProviderDraft = EffortProvider | '';

const PROVIDER_OPTIONS: Array<{ label: string; value: ProviderDraft }> = [
  { label: '自动', value: '' },
  { label: 'Codex', value: 'codex' },
  { label: 'Claude Code', value: 'claude_code' },
];

const providerLabel = (provider?: CatalogProvider | null) =>
  provider === 'claude_code' ? 'Claude Code' : provider === 'codex' ? 'Codex' : '未设置';

export const UserModelDefaultCard: React.FC = () => {
  const { theme, isDark } = useTheme();
  const { providerCatalog, userDefault, loading, error, refresh } = useModelOptions();
  const initialProvider = normalizeProvider(userDefault.provider ?? undefined) ?? '';
  const [provider, setProvider] = useState<ProviderDraft>(initialProvider);
  const [model, setModel] = useState(userDefault.model ?? '');
  const [effort, setEffort] = useState(userDefault.effort ?? '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setProvider(normalizeProvider(userDefault.provider ?? undefined) ?? '');
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
  const savedProvider = normalizeProvider(userDefault.provider ?? undefined) ?? '';
  const dirty =
    provider !== savedProvider ||
    model.trim() !== (userDefault.model ?? '') ||
    effort.trim() !== (userDefault.effort ?? '');

  const accent = theme.colors.primary;
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
      setProvider(normalizeProvider(next.provider ?? undefined) ?? '');
      setModel(next.model ?? '');
      setEffort(next.effort ?? '');
      refreshModelOptions();
      refresh();
      setStatus('已保存为新建会话默认配置。');
    } catch (err) {
      setStatus(
        err instanceof ApiResponseError && err.status === 404
          ? '保存失败: 当前服务端还不支持默认模型接口,请重启或更新服务端。'
          : err instanceof Error
            ? `保存失败: ${err.message}`
            : '保存失败,请重试。',
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
        accessibilityLabel={expanded ? '收起默认模型配置' : '展开默认模型配置'}
        onPress={() => setExpanded(value => !value)}
        style={styles.header}>
        <IconBadge name="settings" tone="primary" size={28} iconSize={14} />
        <View style={styles.headerCopy}>
          <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
            默认模型
          </Text>
          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}
            numberOfLines={1}>
            用户级 · 新建 session 默认使用
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
            正在加载模型目录…
          </Text>
        </View>
      ) : null}
      {error ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
          {error}(将使用内置档位)
        </Text>
      ) : null}

      <Text
        style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
        当前: {providerLabel(userDefault.provider)} · model={userDefault.model || '默认'} · effort={userDefault.effort || '默认'}
      </Text>

      {expanded ? (
        <>
          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }, styles.fieldLabel]}>
            PROVIDER
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
            MODEL
          </Text>
          <TextInput
            value={model}
            onChangeText={setModel}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="留空 = CLI 默认模型"
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
            EFFORT
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
                { color: status.startsWith('保存失败') ? theme.colors.error : theme.colors.secondary },
              ]}>
              {status}
            </Text>
          ) : null}

          <GlowButton
            title={saving ? '保存中…' : dirty ? '保存默认配置' : '已是最新'}
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
