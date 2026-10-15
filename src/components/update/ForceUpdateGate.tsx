/**
 * 强制更新全屏门(App 根挂载,挨着 ChallengeModal)。
 *
 * 仅当 store 判定为 forced(本地复算通过 + 服务端最新行 force 标志)时渲染;
 * 检查失败/断网绝不渲染——断网不能把人锁死。无关闭路径(Android 返回键
 * onRequestClose 为 no-op),用户升级到新版本后,下次检查本地版本号变化,
 * 判定自动通过、Gate 自然消失——没有"解除"操作。
 */
import React, { useCallback, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { useAppUpdateStore } from '../../store/appUpdateStore';
import { getInstalledAppVersion } from '../../native/AppVersion';
import { APP_UPDATE_FALLBACK_URL } from '../../config/appUpdate';

export const ForceUpdateGate: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('settings');
  const status = useAppUpdateStore(s => s.status);
  const info = useAppUpdateStore(s => s.info);
  const checkNow = useAppUpdateStore(s => s.checkNow);
  const [retrying, setRetrying] = useState(false);
  // 「立即更新」打开失败时的页内错误提示。Gate 是原生 Modal,盖在全局
  // ToastViewport 之上——toast 在这里不可见,必须用页内文案。
  const [openFailed, setOpenFailed] = useState(false);

  const handleUpdate = useCallback(() => {
    const url = info?.downloadUrl || APP_UPDATE_FALLBACK_URL;
    setOpenFailed(false);
    Linking.openURL(url).catch(() => {
      setOpenFailed(true);
    });
  }, [info?.downloadUrl]);

  // 重试检查:服务端配置被运维修正(撤掉 force/换对 download_url)后,用户
  // 不必等 30 分钟前台节流——立即可解锁。粘滞语义下重查失败仍保持 forced。
  const handleRetry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await checkNow({ manual: true });
    } finally {
      setRetrying(false);
    }
  }, [checkNow, retrying]);

  if (status !== 'forced' || !info) {
    return null;
  }

  const current = getInstalledAppVersion()?.versionName ?? '?';

  return (
    // onRequestClose 是刻意的 no-op:Android 返回键不允许绕过强制更新。
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <GlassPanel opaque bordered style={styles.panel}>
          <Text
            testID="force-update-title"
            style={[theme.typography.titleMd, { color: theme.colors.error }]}
          >
            {t('about.update.forceTitle')}
          </Text>
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {t('about.update.forceNotice')}
          </Text>
          <View style={styles.versionRow}>
            <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
              {t('about.update.current')}
            </Text>
            <Text
              testID="force-update-current"
              style={[theme.typography.labelMd, { color: theme.colors.onSurface }]}
            >
              {current}
            </Text>
          </View>
          <View style={styles.versionRow}>
            <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
              {t('about.update.latest')}
            </Text>
            <Text
              testID="force-update-latest"
              style={[theme.typography.labelMd, { color: theme.colors.primary }]}
            >
              {info.latestVersion}
            </Text>
          </View>
          <ScrollView style={styles.changelogBox} nestedScrollEnabled>
            <Text
              testID="force-update-changelog"
              style={[theme.typography.bodySm, { color: theme.colors.onSurface }]}
            >
              {info.changelog.trim() || t('about.update.changelogEmpty')}
            </Text>
          </ScrollView>
          <Pressable
            testID="force-update-button"
            accessibilityRole="button"
            accessibilityLabel={t('about.update.updateNow')}
            onPress={handleUpdate}
            style={[
              styles.updateButton,
              { backgroundColor: theme.colors.primary, borderRadius: theme.borderRadius.md },
            ]}
          >
            <Text style={[theme.typography.labelMd, { color: theme.colors.onPrimary }]}>
              {t('about.update.updateNow')}
            </Text>
          </Pressable>
          {openFailed ? (
            <Text
              testID="force-update-open-error"
              style={[theme.typography.bodySm, { color: theme.colors.error }]}
            >
              {t('about.update.openFailed')}
            </Text>
          ) : null}
          <Pressable
            testID="force-update-retry"
            accessibilityRole="button"
            accessibilityLabel={t('about.update.retryCheck')}
            onPress={() => {
              void handleRetry();
            }}
            disabled={retrying}
            style={styles.retryButton}
          >
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {retrying ? t('about.update.checking') : t('about.update.retryCheck')}
            </Text>
          </Pressable>
        </GlassPanel>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  panel: {
    width: '100%',
    maxWidth: 380,
    padding: 18,
    borderRadius: 16,
    gap: 12,
  },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  changelogBox: {
    maxHeight: 180,
    borderRadius: 8,
    padding: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
  },
  updateButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  retryButton: {
    alignItems: 'center',
    paddingVertical: 6,
  },
});
