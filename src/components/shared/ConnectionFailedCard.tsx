import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from './GlassPanel';
import { IconBadge } from '../visual/IconBadge';

interface ConnectionFailedCardProps {
  /** 失败原因(来自 store `lastConnectError`)。提供时以小字展示,便于诊断。 */
  error?: string | null;
  /** 重试回调,通常 = refreshFromServer / 页面 handleRefresh。卡在「从未连上」时它会
   *  触发 initializeFromServer 重跑(fa94c71 self-heal)。进行中按钮显 loading。 */
  onRetry: () => void | Promise<void>;
}

/**
 * 「连接失败 · 重试」卡片。当实时层从未建立服务端会话(`isConnectionFailed`:
 * `!serverMode && !lastSyncedAt`)时,列表页(home / device / vibe)在内容顶部渲染它,
 * 替代含糊的空白/空态 —— 用户报告的「几页全空白、下拉无反应」就停在这个状态。
 *
 * 之前:init 失败 → serverMode=false → store 全空 → 页面显 loading/空白,下拉
 * (旧 build)在 !serverMode 时静默 no-op,且无任何失败提示。
 * 现在:显式卡片(标题 + 原因 + 重试按钮),把「空白没提示」变成可诊断、可操作。
 */
export const ConnectionFailedCard: React.FC<ConnectionFailedCardProps> = ({
  error,
  onRetry,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation('common');
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <GlassPanel glowColor="error" style={styles.card}>
      <View style={styles.row}>
        <IconBadge
          name="warning"
          colorOverride={theme.colors.error}
          size={40}
          iconSize={20}
        />
        <View style={styles.body}>
          <Text
            style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}
            numberOfLines={2}>
            {t('error.connectionFailedTitle')}
          </Text>
          <Text
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant },
            ]}
            numberOfLines={3}>
            {error ? error : t('error.connectionFailedBody')}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={handleRetry}
        disabled={retrying}
        style={[
          styles.retryBtn,
          {
            borderColor: theme.colors.primary,
            borderRadius: theme.borderRadius.md,
          },
        ]}>
        {retrying ? (
          <ActivityIndicator color={theme.colors.primary} size="small" />
        ) : (
          <Text
            style={[theme.typography.labelMd, { color: theme.colors.primary }]}>
            {t('retry')}
          </Text>
        )}
      </TouchableOpacity>
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 16,
    gap: 14,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  body: {
    flex: 1,
    gap: 4,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderWidth: 1.5,
  },
});
