/**
 * 「线路」面板(About 页):展示双通道实时延迟与当前使用通道,支持
 * 自动(默认,探测择优+故障切换)与手动锁定(关闭一切自动切换)。
 * 数据源全部来自 config/localService,本组件零业务逻辑,纯展示+接线。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import {
  getChannelMode,
  getChannelStatus,
  setChannelMode,
  discoverReachableBaseUrl,
  getActiveEndpointId,
  type ChannelMode,
} from '../../config/localService';
import type { EndpointId } from '../../config/channelSelector';
import { StatusChip } from '../../components/shared/StatusChip';

interface ChannelRowState {
  id: EndpointId;
  ttfbMs: number | null;
}

export const ChannelPanel: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('settings');
  const [mode, setMode] = useState<ChannelMode>('auto');
  const [manualId, setManualId] = useState<EndpointId>('primary');
  const [activeId, setActiveId] = useState<EndpointId>(getActiveEndpointId());
  const [status, setStatus] = useState<ChannelRowState[] | null>(null);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    const [modeState, statusRows] = await Promise.all([
      getChannelMode(),
      getChannelStatus(),
    ]);
    setMode(modeState.mode);
    setManualId(modeState.manual);
    setStatus(statusRows as ChannelRowState[]);
    setActiveId(getActiveEndpointId());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSelect = useCallback(
    async (selection: { mode: ChannelMode; manual?: EndpointId }) => {
      setSwitching(true);
      try {
        await setChannelMode(selection.mode, selection.manual);
        if (selection.mode === 'auto') {
          // 立即恢复一次完整择优,面板上的"当前使用"马上反映新策略。
          await discoverReachableBaseUrl().catch(() => {});
        }
        await load();
      } finally {
        setSwitching(false);
      }
    },
    [load],
  );

  const latencyLabel = (id: EndpointId): string => {
    if (!status) return t('about.channel.probing');
    const row = status.find(s => s.id === id);
    if (!row || row.ttfbMs == null) return t('about.channel.unreachable');
    return `${Math.round(row.ttfbMs)}ms`;
  };

  const rows: Array<{
    key: string;
    mode: ChannelMode;
    manual?: EndpointId;
    label: string;
    sub: string;
  }> = [
    {
      key: 'auto',
      mode: 'auto',
      label: t('about.channel.modeAuto'),
      sub: t('about.channel.modeAutoSub'),
    },
    {
      key: 'primary',
      mode: 'manual',
      manual: 'primary',
      label: t('about.channel.routePrimary'),
      sub: t('about.channel.routePrimarySub'),
    },
    {
      key: 'nat0',
      mode: 'manual',
      manual: 'nat0',
      label: t('about.channel.routeNat0'),
      sub: t('about.channel.routeNat0Sub'),
    },
  ];

  const isSelected = (row: (typeof rows)[number]): boolean =>
    row.mode === 'auto' ? mode === 'auto' : mode === 'manual' && manualId === row.manual;

  const activeLabel =
    activeId === 'nat0'
      ? t('about.channel.routeNat0')
      : t('about.channel.routePrimary');

  return (
    <View testID="settings-channel-panel">
      <View style={styles.activeRow}>
        <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
          {t('about.channel.activeNow')}
        </Text>
        <StatusChip label={activeLabel} type="info" />
      </View>

      {rows.map(row => {
        const selected = isSelected(row);
        return (
          <TouchableOpacity
            key={row.key}
            style={styles.routeRow}
            onPress={() => {
              void handleSelect({ mode: row.mode, manual: row.manual });
            }}
            disabled={switching}
            accessibilityRole="button"
            testID={`settings-channel-${row.key}`}>
            <View style={styles.routeCopy}>
              <Text
                style={[
                  theme.typography.bodyMd,
                  { color: selected ? theme.colors.primary : theme.colors.onSurface },
                ]}>
                {row.label}
              </Text>
              <Text
                style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={1}>
                {row.sub}
              </Text>
            </View>
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {row.mode === 'manual' ? latencyLabel(row.manual!) : ''}
            </Text>
            <Text
              style={[
                theme.typography.labelMd,
                { color: selected ? theme.colors.primary : theme.colors.onSurfaceVariant },
              ]}>
              {selected ? '◉' : '○'}
            </Text>
          </TouchableOpacity>
        );
      })}

      {mode === 'manual' ? (
        <Text style={[theme.typography.labelSm, styles.manualHint, { color: theme.colors.onSurfaceVariant }]}>
          {t('about.channel.manualHint')}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  activeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 6,
  },
  routeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 12,
  },
  routeCopy: {
    flex: 1,
    gap: 3,
  },
  manualHint: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
});
