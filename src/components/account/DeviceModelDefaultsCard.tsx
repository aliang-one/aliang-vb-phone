import React, { useMemo, useState } from 'react';
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
import { IconBadge } from '../visual/IconBadge';
import { useModelOptions } from '../../hooks/useModelOptions';
import {
  putDeviceModelConfig,
  type CatalogProvider,
} from '../../api/modelConfig';
import {
  EFFORT_PROVIDERS,
  normalizeProvider,
  providerLabel,
  type EffortProvider,
} from '../../utils/modelIntensity';
import type { Device } from '../../data/platformModels';

const PROVIDER_OPTIONS: Array<{ label: string; value: EffortProvider | '' }> = [
  { label: '默认', value: '' },
  ...EFFORT_PROVIDERS.map(value => ({ label: providerLabel(value), value })),
];

interface DeviceRowProps {
  device: Device;
  providerCatalog: ReturnType<typeof useModelOptions>['providerCatalog'];
  serverDefault: ReturnType<typeof useModelOptions>['serverDefault'];
}

/**
 * One device's compact [provider, model, effort] override editor. Blank =
 * inherit the server default. Shows a read-only "有效" preview derived from
 * server_default + the device's picks. Saves via `putDeviceModelConfig` (null
 * for cleared fields).
 *
 * The phone's `Device` type doesn't currently carry a server-attached
 * model_config override (the device snapshot shape predates this feature), so
 * the editor seeds blank ("inherit") until the user sets it. The "有效" preview
 * falls back to the server default.
 */
const DeviceRow: React.FC<DeviceRowProps> = ({
  device,
  providerCatalog,
  serverDefault,
}) => {
  const { theme, isDark } = useTheme();
  const [provider, setProvider] = useState<EffortProvider | ''>(
    normalizeProvider(undefined) ?? '',
  );
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty =
    provider !== '' || model.trim() !== '' || effort.trim() !== '';

  const effortOptions = useMemo(() => {
    const resolved = provider || 'codex';
    const efforts =
      providerCatalog.find(item => item.provider === resolved)?.efforts ?? [];
    const list = [...efforts];
    if (!list.some(o => o.value === '')) {
      list.unshift({ label: '默认', value: '' });
    }
    return list;
  }, [provider, providerCatalog]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await putDeviceModelConfig(device.id, {
        provider: provider || null,
        model: model.trim() || null,
        effort: effort.trim() || null,
      });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败,请重试。');
    } finally {
      setSaving(false);
    }
  };

  // "有效" preview: server default unless the device overrides a field.
  const effectiveModel = model.trim() || serverDefault.model || '默认';
  const effectiveEffort = effort.trim() || serverDefault.effort || '默认';
  const effectiveProvider =
    provider || normalizeProvider(serverDefault.provider ?? undefined) || 'codex';

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

  return (
    <View style={[styles.deviceCard, { borderColor: idleBorder }]}>
      <View style={styles.deviceHead}>
        <IconBadge name="device" tone="neutral" size={26} iconSize={13} />
        <View style={styles.deviceCopy}>
          <Text
            style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}
            numberOfLines={1}>
            {device.name}
          </Text>
          <Text
            style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}
            numberOfLines={1}>
            {device.host || device.os} · {device.status}
          </Text>
        </View>
      </View>

      {/* PROVIDER */}
      <Text
        style={[
          theme.typography.labelSm,
          { color: theme.colors.onSurfaceVariant },
          styles.fieldLabel,
        ]}>
        PROVIDER
      </Text>
      <View style={styles.chipRow}>
        {PROVIDER_OPTIONS.map(opt => {
          const active = provider === opt.value;
          return (
            <TouchableOpacity
              key={opt.value || 'default'}
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

      {/* MODEL */}
      <Text
        style={[
          theme.typography.labelSm,
          { color: theme.colors.onSurfaceVariant },
          styles.fieldLabel,
        ]}>
        MODEL
      </Text>
      <TextInput
        value={model}
        onChangeText={setModel}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="留空 = 继承服务器默认"
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

      {/* EFFORT */}
      <Text
        style={[
          theme.typography.labelSm,
          { color: theme.colors.onSurfaceVariant },
          styles.fieldLabel,
        ]}>
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

      {/* 有效 preview */}
      <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }, styles.effective]}>
        有效: {providerLabel(effectiveProvider)} · model={effectiveModel} · effort={effectiveEffort}
      </Text>

      {error ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
          {error}
        </Text>
      ) : null}
      {savedAt && !error ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.secondary }]}>
          已保存。
        </Text>
      ) : null}

      <View style={styles.actionsRow}>
        <TouchableOpacity
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`保存 ${device.name} 的模型配置`}
          onPress={handleSave}
          disabled={saving || !dirty}
          style={[
            styles.saveBtn,
            {
              borderRadius: theme.borderRadius.md,
              borderColor: dirty ? accent : idleBorder,
              backgroundColor: dirty
                ? isDark
                  ? 'rgba(86,156,214,0.18)'
                  : 'rgba(0,81,174,0.1)'
                : 'transparent',
              opacity: saving || !dirty ? 0.5 : 1,
            },
          ]}>
          {saving ? (
            <ActivityIndicator color={accent} size="small" />
          ) : (
            <Text
              style={[
                theme.typography.labelMd,
                { color: dirty ? accent : theme.colors.onSurfaceVariant },
              ]}>
              保存
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

interface DeviceModelDefaultsCardProps {
  devices: Device[];
}

/**
 * Lists the current user's devices, each with a compact model/effort override
 * editor (blank = inherit server default) and a "有效" preview. Saves per-device
 * via `putDeviceModelConfig`.
 */
export const DeviceModelDefaultsCard: React.FC<DeviceModelDefaultsCardProps> = ({
  devices,
}) => {
  const { theme } = useTheme();
  const { providerCatalog, serverDefault, loading, error } = useModelOptions();

  return (
    <GlassPanel style={styles.card}>
      <View style={styles.header}>
        <IconBadge name="device" tone="secondary" size={28} iconSize={14} />
        <View style={styles.headerCopy}>
          <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
            设备默认
          </Text>
          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}
            numberOfLines={1}>
            为每台设备指定模型;留空 = 继承服务器默认
          </Text>
        </View>
      </View>

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

      {!devices.length ? (
        <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
          还没有已注册设备。
        </Text>
      ) : null}
      <View style={styles.list}>
        {devices.map(device => (
          <DeviceRow
            key={device.id}
            device={device}
            providerCatalog={providerCatalog}
            serverDefault={serverDefault}
          />
        ))}
      </View>
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
  list: {
    gap: 10,
  },
  deviceCard: {
    borderWidth: 1,
    borderRadius: 11,
    padding: 11,
    gap: 2,
  },
  deviceHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 4,
  },
  deviceCopy: {
    flex: 1,
    gap: 1,
  },
  fieldLabel: {
    marginTop: 8,
    marginBottom: 4,
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
    marginTop: 6,
  },
  chip: {
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  effective: {
    marginTop: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    marginTop: 10,
  },
  saveBtn: {
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 9,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
