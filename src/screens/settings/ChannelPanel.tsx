/**
 * 「线路」面板(About 页)—— 简约版:
 * 默认一行展示当前模式(自动/已锁定 X),右侧「手动选择」Switch(默认关);
 * 开关打开即展开路线列表(各线路实时状态+手动选择),关闭即回到全自动。
 * 数据源全部来自 config/localService,本组件零业务逻辑,纯展示+接线。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch, TouchableOpacity, StyleSheet } from 'react-native';
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

interface ChannelRowState {
  id: EndpointId;
  ttfbMs: number | null;
}

export const ChannelPanel: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('settings');
  const [mode, setModeState] = useState<ChannelMode>('auto');
  const [manualId, setManualId] = useState<EndpointId>('primary');
  const [activeId, setActiveId] = useState<EndpointId>(getActiveEndpointId());
  const [status, setStatus] = useState<ChannelRowState[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [modeState, statusRows] = await Promise.all([
      getChannelMode(),
      getChannelStatus(),
    ]);
    setModeState(modeState.mode);
    setManualId(modeState.manual);
    setStatus(statusRows as ChannelRowState[]);
    setActiveId(getActiveEndpointId());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = useCallback(
    async (on: boolean) => {
      setBusy(true);
      try {
        if (on) {
          // 打开即锁定当前生效通道,用户随后可在列表里改选。
          await setChannelMode('manual', activeId);
        } else {
          await setChannelMode('auto');
          await discoverReachableBaseUrl().catch(() => {});
        }
        await load();
      } finally {
        setBusy(false);
      }
    },
    [activeId, load],
  );

  const handlePick = useCallback(
    async (id: EndpointId) => {
      setBusy(true);
      try {
        await setChannelMode('manual', id);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const manual = mode === 'manual';

  const routeLabel = (id: EndpointId): string =>
    id === 'nat0'
      ? t('about.channel.routeNat0')
      : id === 'hk'
        ? t('about.channel.routeHk')
        : t('about.channel.routePrimary');

  const latencyLabel = (id: EndpointId): string => {
    if (!status) return t('about.channel.probing');
    const row = status.find(s => s.id === id);
    if (!row || row.ttfbMs == null) return t('about.channel.unreachable');
    return `${Math.round(row.ttfbMs)}ms`;
  };

  // 收起态摘要:自动 → 「自动 · 当前使用 HK 主通道 · 310ms」;
  // 手动 → 「已锁定 国内中继 · 312ms」。
  const summary = manual
    ? `${t('about.channel.locked')} ${routeLabel(activeId)} · ${latencyLabel(activeId)}`
    : `${t('about.channel.autoTag')} · ${t('about.channel.activeNow')} ${routeLabel(activeId)} · ${latencyLabel(activeId)}`;

  const routes: EndpointId[] = ['primary', 'nat0', 'hk'];

  return (
    <View testID="settings-channel-panel">
      <View style={styles.toggleRow}>
        <View style={styles.toggleCopy}>
          <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
            {t('about.channel.manualToggle')}
          </Text>
          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}
            numberOfLines={1}>
            {summary}
          </Text>
        </View>
        <Switch
          value={manual}
          onValueChange={value => void handleToggle(value)}
          disabled={busy}
          trackColor={{ true: theme.colors.primary, false: theme.colors.outlineVariant }}
          thumbColor={theme.colors.onSurface}
          testID="settings-channel-toggle"
        />
      </View>

      {manual ? (
        <View style={styles.routeList}>
          {routes.map(id => {
            const selected = manualId === id;
            return (
              <TouchableOpacity
                key={id}
                style={styles.routeRow}
                onPress={() => void handlePick(id)}
                disabled={busy}
                accessibilityRole="button"
                testID={`settings-channel-route-${id}`}>
                <Text
                  style={[
                    theme.typography.bodyMd,
                    { color: selected ? theme.colors.primary : theme.colors.onSurface },
                  ]}>
                  {selected ? '◉' : '○'} {routeLabel(id)}
                </Text>
                <Text
                  style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  {latencyLabel(id)}
                </Text>
              </TouchableOpacity>
            );
          })}
          <Text
            style={[theme.typography.labelSm, styles.manualHint, { color: theme.colors.onSurfaceVariant }]}>
            {t('about.channel.manualHint')}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 16,
  },
  toggleCopy: {
    flex: 1,
    gap: 3,
  },
  routeList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.3)',
    paddingTop: 4,
  },
  routeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  manualHint: {
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 12,
  },
});
