/**
 * 软提醒升级弹层(BottomSheet,可关)。
 *
 * open 条件 = store 判定 available 且未被抑制(「稍后再说」按 latestVersion
 * 落盘记忆,同版本不再自动弹;手动「检查更新」会解除抑制强制可见)。
 * 「稍后再说」与滑出/返回键关闭同义(都走 dismiss)。
 */
import React, { useCallback } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../shared/BottomSheet';
import { GlowButton } from '../shared/GlowButton';
import { useTheme } from '../../theme/useTheme';
import { useAppUpdateStore } from '../../store/appUpdateStore';
import { APP_UPDATE_FALLBACK_URL } from '../../config/appUpdate';

export const UpdateAvailableSheet: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('settings');
  const status = useAppUpdateStore(s => s.status);
  const info = useAppUpdateStore(s => s.info);
  const promptSuppressed = useAppUpdateStore(s => s.promptSuppressed);
  const dismiss = useAppUpdateStore(s => s.dismiss);

  const open = status === 'available' && Boolean(info) && !promptSuppressed;
  // BottomSheet 关闭动画期间 children 仍挂载约 240ms;内容随 open 立即收起,
  // 让调用方与测试都能同步断言「已关闭」(参考 ModelConfirmSheet 的门控注释)。
  const visible = open;

  const handleUpdate = useCallback(() => {
    const url = info?.downloadUrl || APP_UPDATE_FALLBACK_URL;
    void Linking.openURL(url).catch(() => {});
    dismiss();
  }, [info?.downloadUrl, dismiss]);

  return (
    <BottomSheet
      open={open}
      onClose={dismiss}
      title={t('update.title')}
      badge={visible && info ? { label: info.latestVersion, tone: 'info' } : undefined}
    >
      {visible && info ? (
        <View style={styles.body}>
          <Text
            testID="update-changelog"
            style={[theme.typography.bodySm, { color: theme.colors.onSurface }]}
          >
            {info.changelog.trim() || t('update.changelogEmpty')}
          </Text>
          <View style={styles.footerRow}>
            <Pressable
              testID="update-later-button"
              accessibilityRole="button"
              accessibilityLabel={t('update.later')}
              onPress={dismiss}
              style={styles.textBtn}
            >
              <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                {t('update.later')}
              </Text>
            </Pressable>
            <GlowButton
              testID="update-now-button"
              title={t('update.updateNow')}
              onPress={handleUpdate}
              style={styles.updateButton}
            />
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  body: {
    gap: 14,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  textBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  updateButton: {
    minWidth: 140,
  },
});
