/**
 * 「关于」子页(Me 页入口进入):版本、检查更新、隐私政策 + 账号危险区
 * (删除账号)。2026-10-15 自 SettingsScreen 整体迁移,交互逻辑一行未改,
 * 只换容器;各行 testID 保持原名,既有选择器不破坏。
 */
import React, { useCallback, useState } from 'react';
import {
  Linking,
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { RootStackParamList } from '../../app/navigation/types';
import { useSessionStore } from '../../../stores/useSettingsStore';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { useToastStore } from '../../store/toastStore';
import { ApiResponseError } from '../../api/client';
import { getInstalledAppVersion } from '../../native/AppVersion';
import { useAppUpdateStore } from '../../store/appUpdateStore';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

// Apple 5.1.1(i): the privacy policy must be reachable from inside the app,
// not only on the website.
const PRIVACY_POLICY_URL = 'https://www.aliang.one/privacy';

export const AboutScreen: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('settings');
  const navigation = useNavigation<Navigation>();
  const show = useToastStore(s => s.show);
  const appUpdateChecking = useAppUpdateStore(s => s.status === 'checking');
  const checkAppUpdate = useAppUpdateStore(s => s.checkNow);
  const deleteAccount = useSessionStore(state => state.deleteAccount);
  const disconnectFromServer = useControlCenterStore(
    state => state.disconnectFromServer,
  );
  const resetSessionData = useControlCenterStore(
    state => state.resetSessionData,
  );
  const installedVersion = getInstalledAppVersion();

  // 手动「检查更新」:await 完成后按终态给反馈;有新版时不 toast——
  // Sheet(软提醒)/全屏 Gate(强制)自己会上屏。「没查成」(网络失败、官网
  // 无配置行、版本不可判、本机版本不可读)统一给失败反馈——不再把没查成
  // 说成「已是最新」。
  const handleCheckAppUpdate = useCallback(async () => {
    await checkAppUpdate({ manual: true });
    const s = useAppUpdateStore.getState();
    if (s.status === 'upToDate' && s.lastCheckDecided) {
      show(t('about.update.upToDateToast'), 'success');
    } else if (s.status !== 'available' && s.status !== 'forced') {
      show(t('about.update.checkFailedToast'), 'error');
    }
  }, [checkAppUpdate, show, t]);

  // Delete-account confirm dialog (Apple 5.1.1(v)): password-gated, errors are
  // surfaced inside the modal — a failed attempt must NOT close it or clear
  // the session.
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openDeleteModal = () => {
    setDeletePassword('');
    setDeleteError(null);
    setDeleteModalOpen(true);
  };

  // Mid-request dismissal is blocked so the in-flight DELETE can't be orphaned.
  const closeDeleteModal = () => {
    if (deletingAccount) return;
    setDeleteModalOpen(false);
  };

  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    setDeleteError(null);
    try {
      // Same realtime teardown as logout; the session wipe inside the store
      // clears the token, which flips RootNavigator to Login.
      disconnectFromServer();
      resetSessionData();
      await deleteAccount(deletePassword);
      setDeleteModalOpen(false);
      show(t('dangerZone.deleteSuccess'));
    } catch (error) {
      // 401 = wrong password — say so plainly instead of the raw HTTP error.
      // Anything else (network down, 5xx) surfaces the server/client message.
      if (error instanceof ApiResponseError && error.status === 401) {
        setDeleteError(t('dangerZone.wrongPassword'));
      } else {
        setDeleteError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setDeletingAccount(false);
    }
  };

  const renderSectionTitle = (label: string) => (
    <Text
      style={[
        theme.typography.labelCaps,
        { color: theme.colors.onSurfaceVariant },
        styles.sectionTitle,
      ]}>
      {label}
    </Text>
  );

  return (
    <SafeAreaWrapper>
      <TopAppBar title={t('about.appbarTitle')} onBack={navigation.goBack} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <GlassPanel style={styles.panel}>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                {t('about.version')}
              </Text>
              <Text
                testID="settings-app-version"
                style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={1}>
                {installedVersion
                  ? `${installedVersion.versionName} (${installedVersion.versionCode})`
                  : '-'}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => {
              void handleCheckAppUpdate();
            }}
            disabled={appUpdateChecking}
            accessibilityRole="button"
            testID="settings-check-update-row">
            <View style={styles.settingCopy}>
              <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                {t('about.checkUpdate')}
              </Text>
            </View>
            {appUpdateChecking ? (
              <StatusChip label="…" type="neutral" />
            ) : (
              <Text style={[theme.typography.labelMd, { color: theme.colors.primary }]}>
                ›
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => {
              // Best-effort: no in-app browser to fall back to; ignore.
              Linking.openURL(PRIVACY_POLICY_URL).catch(() => {});
            }}
            accessibilityRole="button">
            <View style={styles.settingCopy}>
              <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                {t('about.privacyPolicy')}
              </Text>
              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                {PRIVACY_POLICY_URL}
              </Text>
            </View>
            <Text style={[theme.typography.labelMd, { color: theme.colors.primary }]}>
              ›
            </Text>
          </TouchableOpacity>
        </GlassPanel>

        {renderSectionTitle(t('dangerZone.title'))}
        <GlassPanel style={styles.panel}>
          <TouchableOpacity
            style={styles.settingRow}
            onPress={openDeleteModal}
            accessibilityRole="button"
            testID="settings-delete-account-row">
            <View style={styles.settingCopy}>
              <Text style={[theme.typography.bodyMd, { color: theme.colors.error }]}>
                {t('dangerZone.deleteAccountTitle')}
              </Text>
              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                {t('dangerZone.deleteAccountSubtitle')}
              </Text>
            </View>
            <Text style={[theme.typography.labelMd, { color: theme.colors.error }]}>
              ›
            </Text>
          </TouchableOpacity>
        </GlassPanel>
      </ScrollView>

      <Modal
        visible={deleteModalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteModal}>
        <View style={styles.modalOverlay}>
          {/* opaque: the translucent glass fill lets the dimmed screen bleed
          through inside a Modal — see GlassPanel.opaque. */}
          <GlassPanel opaque style={styles.deletePanel}>
            <View style={styles.deleteBody}>
              <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                {t('dangerZone.deleteModalTitle')}
              </Text>
              <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                {t('dangerZone.deleteModalBody')}
              </Text>
              {deleteError ? (
                <Text
                  testID="settings-delete-error"
                  style={[theme.typography.bodySm, { color: theme.colors.error }]}>
                  {deleteError}
                </Text>
              ) : null}
              <TextInput
                testID="settings-delete-password"
                value={deletePassword}
                onChangeText={setDeletePassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('dangerZone.deletePasswordPlaceholder')}
                placeholderTextColor={theme.colors.onSurfaceVariant}
                style={[
                  theme.typography.bodyMd,
                  styles.deleteInput,
                  {
                    color: theme.colors.onSurface,
                    borderColor: theme.colors.outlineVariant,
                  },
                ]}
              />
              <View style={styles.deleteActions}>
                <GlowButton
                  title={t('dangerZone.deleteCancel')}
                  onPress={closeDeleteModal}
                  variant="outline"
                  disabled={deletingAccount}
                  style={styles.deleteButton}
                />
                <GlowButton
                  title={t('dangerZone.deleteConfirm')}
                  onPress={() => void handleDeleteAccount()}
                  loading={deletingAccount}
                  disabled={deletingAccount || !deletePassword.trim()}
                  style={[styles.deleteButton, { backgroundColor: theme.colors.error }]}
                  testID="settings-delete-confirm"
                />
              </View>
            </View>
          </GlassPanel>
        </View>
      </Modal>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
  },
  panel: {
    padding: 0,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 16,
  },
  settingCopy: {
    flex: 1,
    gap: 3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  deletePanel: {
    width: '100%',
    maxWidth: 380,
    padding: 18,
    borderRadius: 16,
  },
  deleteBody: {
    gap: 12,
  },
  deleteInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  deleteActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  deleteButton: {
    flex: 1,
  },
});
