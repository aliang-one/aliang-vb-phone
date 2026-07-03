import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCameraPermission } from 'react-native-vision-camera';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { IconBadge } from '../../components/visual/IconBadge';
import { DeviceCodeScanner } from './DeviceCodeScanner';
import { RootStackParamList } from '../../app/navigation/types';
import { useControlCenterStore } from '../../store/controlCenterStore';
import {
  extractScanCode,
  scanLoginConfirm,
  scanLoginDeny,
  scanLoginScan,
} from '../../api/scanLogin';
import { ApiResponseError } from '../../api/client';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

type Phase = 'idle' | 'confirming' | 'working' | 'success' | 'error';

// Map an official-website scan-login error to a user-facing message.
// 404 = 扫码不存在/过期;409 = 状态不对(已被别处确认/拒绝);401 = 手机未登录。
function describeScanError(error: unknown, t: TFunction): string {
  if (error instanceof ApiResponseError) {
    if (error.status === 404) return t('scanner.error.notFound');
    if (error.status === 409) return t('scanner.error.conflict');
    if (error.status === 401) return t('scanner.error.unauthorized');
    return error.message;
  }
  return error instanceof Error ? error.message : t('scanner.error.fallback');
}

export const DeviceCameraScannerScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('devices');
  const navigation = useNavigation<Navigation>();
  const isFocused = useIsFocused();
  const { hasPermission, canRequestPermission, requestPermission, status } =
    useCameraPermission();
  const refreshFromServer = useControlCenterStore(state => state.refreshFromServer);

  const [scanCode, setScanCode] = useState<string | undefined>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [scannerError, setScannerError] = useState('');

  const reset = () => {
    setScanCode(undefined);
    setPhase('idle');
    setMessage('');
    setScannerError('');
  };

  const handleRequestPermission = async () => {
    const granted = await requestPermission();
    if (!granted) {
      setMessage(t('scanner.permissionDenied'));
    }
  };

  // Scan → extract sc_ → POST /auth/scan/scan (pending→scanned) → ask to confirm.
  const handleScannedValue = async (rawValue?: string) => {
    const code = extractScanCode(rawValue ?? '');
    if (!code) {
      setMessage(t('scanner.unrecognized'));
      return;
    }
    if (phase === 'working' || phase === 'confirming') {
      return; // 一次只处理一个码
    }
    setScanCode(code);
    setPhase('working');
    setMessage('');
    setScannerError('');
    try {
      await scanLoginScan(code);
      setPhase('confirming');
    } catch (error) {
      setPhase('error');
      setMessage(describeScanError(error, t));
    }
  };

  const handleConfirm = async () => {
    if (!scanCode) return;
    setPhase('working');
    setMessage('');
    try {
      await scanLoginConfirm(scanCode); // scanned→authorized,桌面 agent 登录并自动注册设备
      setPhase('success');
      setMessage(t('scanner.successMessage'));
      // agent 登录后会自动 register_sync 把设备注册到该用户名下;刷新设备列表。
      void refreshFromServer().catch(() => {});
      setTimeout(() => navigation.goBack(), 1600);
    } catch (error) {
      setPhase('error');
      setMessage(describeScanError(error, t));
    }
  };

  const handleDeny = async () => {
    if (!scanCode) {
      reset();
      return;
    }
    try {
      await scanLoginDeny(scanCode);
    } catch {
      // 忽略拒绝失败,直接回到扫码态
    }
    reset();
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={t('scanner.title')}
        subtitle={t('scanner.subtitle')}
        onBack={navigation.goBack}
        rightAction={
          <StatusChip
            label={hasPermission ? t('scanner.cameraOn') : status.toUpperCase()}
            type={hasPermission ? 'success' : 'warning'}
          />
        }
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Plain View, NOT GlassPanel: the scanner preview is an Android
            SurfaceView (CameraX PreviewView), and a SurfaceView renders BLACK
            when an ancestor clips it with overflow:'hidden' + borderRadius —
            GlassPanel always applies both, so the scan-login camera was black
            on Xiaomi/MIUI (frames flowed to the surface but were never shown).
            Keep this container unclipped; give it a border/bg manually. */}
        <View
          style={[
            styles.cameraPanel,
            {
              backgroundColor: isDark
                ? 'rgba(255, 255, 255, 0.04)'
                : theme.colors.surfaceContainerLow,
              borderColor: isDark
                ? 'rgba(255, 255, 255, 0.08)'
                : theme.colors.outlineVariant,
              borderRadius: theme.borderRadius.md,
            },
          ]}>
          {hasPermission ? (
            <View style={styles.cameraFrame}>
              <DeviceCodeScanner
                isActive={isFocused && phase !== 'working' && phase !== 'confirming'}
                style={StyleSheet.absoluteFill}
                onCodeScanned={handleScannedValue}
                onError={error => setScannerError(error.message)}
              />
              <View pointerEvents="none" style={styles.scanOverlay}>
                <View style={[styles.corner, styles.cornerTopLeft]} />
                <View style={[styles.corner, styles.cornerTopRight]} />
                <View style={[styles.corner, styles.cornerBottomLeft]} />
                <View style={[styles.corner, styles.cornerBottomRight]} />
                <View style={[styles.scanLine, { backgroundColor: theme.colors.primary }]} />
              </View>
              {phase !== 'idle' ? (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={reset}
                  style={[
                    styles.rescanButton,
                    {
                      backgroundColor: theme.colors.primary,
                      borderRadius: theme.borderRadius.full,
                    },
                  ]}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onPrimary }]}>
                    {t('scanner.rescan')}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <View style={styles.permissionPanel}>
              <IconBadge name="scan" tone="primary" size={72} iconSize={36} />
              <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
                {t('scanner.permissionTitle')}
              </Text>
              <Text
                style={[
                  theme.typography.bodySm,
                  { color: theme.colors.onSurfaceVariant, textAlign: 'center' },
                ]}>
                {t('scanner.permissionBody')}
              </Text>
              <GlowButton
                title={canRequestPermission ? t('scanner.allowCamera') : t('scanner.openSettings')}
                onPress={
                  canRequestPermission
                    ? handleRequestPermission
                    : () => Linking.openSettings()
                }
                variant="primary"
                style={styles.permissionButton}
              />
            </View>
          )}
        </View>

        {scannerError ? (
          <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
            {scannerError}
          </Text>
        ) : null}

        {scanCode && phase !== 'idle' ? (
          <GlassPanel
            style={styles.resultPanel}
            glowColor={
              phase === 'success'
                ? 'secondary'
                : phase === 'error'
                ? 'error'
                : 'primary'
            }>
            <View style={styles.resultHeader}>
              <IconBadge
                name={
                  phase === 'success'
                    ? 'check'
                    : phase === 'error'
                    ? 'warning'
                    : 'agent'
                }
                tone={
                  phase === 'success'
                    ? 'secondary'
                    : phase === 'error'
                    ? 'error'
                    : 'primary'
                }
                size={44}
                iconSize={22}
              />
              <View style={styles.resultTitle}>
                <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                  {phase === 'confirming'
                    ? t('scanner.confirmTitle')
                    : phase === 'working'
                    ? t('scanner.workingTitle')
                    : phase === 'success'
                    ? t('scanner.successTitle')
                    : t('scanner.errorTitle')}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                  {scanCode}
                </Text>
              </View>
              <StatusChip
                label={
                  phase === 'confirming'
                    ? 'PENDING'
                    : phase === 'working'
                    ? 'WORKING'
                    : phase === 'success'
                    ? 'DONE'
                    : 'ERROR'
                }
                type={
                  phase === 'success'
                    ? 'success'
                    : phase === 'error'
                    ? 'error'
                    : 'info'
                }
              />
            </View>
            {message ? (
              <Text
                style={[
                  theme.typography.bodySm,
                  { color: phase === 'error' ? theme.colors.error : theme.colors.onSurfaceVariant },
                ]}>
                {message}
              </Text>
            ) : null}
            {phase === 'confirming' ? (
              <View style={styles.confirmRow}>
                <GlowButton title={t('scanner.confirmLogin')} onPress={handleConfirm} variant="primary" />
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={handleDeny}
                  style={[
                    styles.denyButton,
                    {
                      borderColor: theme.colors.outlineVariant,
                      borderRadius: theme.borderRadius.full,
                    },
                  ]}>
                  <Text style={[theme.typography.labelMd, { color: theme.colors.onSurfaceVariant }]}>
                    {t('scanner.cancel')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {phase === 'error' ? (
              <GlowButton title={t('scanner.rescan')} onPress={reset} variant="primary" />
            ) : null}
          </GlassPanel>
        ) : null}

        <GlassPanel style={styles.manualPanel}>
          <View style={styles.manualTop}>
            <IconBadge name="code" tone="neutral" size={36} iconSize={18} />
            <View style={styles.resultTitle}>
              <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                {t('scanner.manualTitle')}
              </Text>
              <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                {t('scanner.manualHint')}
              </Text>
            </View>
          </View>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('scanner.manualPlaceholder')}
            placeholderTextColor={theme.colors.onSurfaceVariant}
            onSubmitEditing={event => handleScannedValue(event.nativeEvent.text)}
            style={[
              theme.typography.codeSm,
              styles.manualInput,
              {
                color: theme.colors.onSurface,
                borderColor: theme.colors.outlineVariant,
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.04)'
                  : theme.colors.surfaceContainer,
                borderRadius: theme.borderRadius.md,
              },
            ]}
          />
        </GlassPanel>
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 14,
  },
  // Camera preview container. MUST stay unclipped (no overflow:'hidden'):
  // the scanner is an Android SurfaceView (CameraX PreviewView); clipping it
  // with overflow:'hidden' + borderRadius renders the preview BLACK. bg/border
  // are set inline on the element so this style intentionally has no clip.
  cameraPanel: {
    padding: 0,
    borderWidth: 1,
  },
  cameraFrame: {
    height: 320,
    backgroundColor: '#000',
  },
  scanOverlay: {
    ...StyleSheet.absoluteFill,
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: '#fff',
  },
  cornerTopLeft: {
    top: 24,
    left: 24,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cornerTopRight: {
    top: 24,
    right: 24,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cornerBottomLeft: {
    bottom: 24,
    left: 24,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  cornerBottomRight: {
    bottom: 24,
    right: 24,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  scanLine: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '50%',
    height: 2,
    opacity: 0.7,
  },
  rescanButton: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  permissionPanel: {
    height: 320,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  permissionButton: {
    marginTop: 4,
  },
  resultPanel: {
    padding: 16,
    gap: 12,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resultTitle: {
    flex: 1,
    gap: 3,
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  denyButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
  },
  manualPanel: {
    padding: 16,
    gap: 12,
  },
  manualTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  manualInput: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
