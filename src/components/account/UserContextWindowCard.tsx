import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { GlowButton } from '../shared/GlowButton';
import { ContextWindowSlider } from '../shared/ContextWindowSlider';
import { IconBadge } from '../visual/IconBadge';
import { ApiResponseError } from '../../api/client';
import { putUserModelDefault } from '../../api/modelConfig';
import {
  refreshModelOptions,
  useModelOptions,
} from '../../hooks/useModelOptions';
import { resolveContextWindow } from '../../utils/contextWindow';

/**
 * Me → 上下文：用户级默认上下文窗口。
 *
 * 单独成卡（与「模型默认」并列）而不是塞进模型卡片：PUT /api/me/model-default
 * 对省略字段保持原值，两张卡片各自只下发自己改过的字段，互不覆盖。
 * 这里永远只发 `context_window`，不碰 provider/model/effort。
 */
export const UserContextWindowCard: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('account');
  const { data, userDefault, loading, error, refresh } = useModelOptions();
  const saved = resolveContextWindow(userDefault.context_window);
  const [contextWindow, setContextWindow] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // 外部默认值变化（另一张卡片保存 / 重新拉取）→ 同步本地编辑态。
  useEffect(() => {
    setContextWindow(resolveContextWindow(userDefault.context_window));
  }, [userDefault.context_window]);

  const dirty = contextWindow !== saved;

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const next = await putUserModelDefault({ context_window: contextWindow });
      setContextWindow(resolveContextWindow(next.context_window));
      // 通知所有 useModelOptions 订阅者（模型默认卡、新建会话页）立即读新值。
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
      <View style={styles.header}>
        <IconBadge name="code" tone="primary" size={28} iconSize={14} />
        <View style={styles.headerCopy}>
          <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
            {t('contextCard.title')}
          </Text>
          <Text
            style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}
            numberOfLines={2}>
            {t('contextCard.subtitle')}
          </Text>
        </View>
      </View>

      {loading && !data ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            {t('common.loadingCatalog')}
          </Text>
        </View>
      ) : null}
      {error ? (
        <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
          {error}
          {t('common.errorFallback')}
        </Text>
      ) : null}

      <ContextWindowSlider
        value={contextWindow}
        onChange={setContextWindow}
        label={t('common.contextFieldLabel')}
        disabled={!data}
        testID="me-context-window"
      />
      <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
        {t('contextCard.hint')}
      </Text>

      {status ? (
        <Text
          style={[
            theme.typography.bodySm,
            {
              color: status.startsWith(t('userDefault.failureStatusPrefix'))
                ? theme.colors.error
                : theme.colors.secondary,
            },
          ]}>
          {status}
        </Text>
      ) : null}

      <GlowButton
        title={
          saving
            ? t('common.saving')
            : dirty
              ? t('userDefault.saveDefault')
              : t('userDefault.upToDate')
        }
        onPress={handleSave}
        disabled={saving || !data || !dirty}
        variant={dirty ? 'primary' : 'outline'}
      />
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
});
