import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { GridBackground } from '../../components/layout/GridBackground';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { IconBadge } from '../../components/visual/IconBadge';
import { useTheme } from '../../theme/useTheme';
import {
  checkPlatformService,
  getPlatformServiceBaseUrl,
  type PlatformServiceHealth,
} from '../../config/localService';
import { useSessionStore } from '../../../stores/useSettingsStore';

export const LoginScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const login = useSessionStore(state => state.login);
  const passwordInputRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [serviceBaseUrl, setServiceBaseUrl] = useState('');
  const [serviceHealth, setServiceHealth] = useState<PlatformServiceHealth | null>(null);
  const [checkingService, setCheckingService] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = useMemo(
    () => email.trim().length > 0 && password.length > 0 && !submitting,
    [email, password, submitting],
  );
  const buttonDisabled = email.trim().length === 0 || password.length === 0 || submitting;
  const accentColor = isDark ? theme.colors.secondary : theme.colors.primary;
  const mutedBorderColor = isDark ? 'rgba(47, 248, 1, 0.22)' : theme.colors.outlineVariant;
  const displayServiceHost = useMemo(
    () => serviceBaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') || 'Detecting service',
    [serviceBaseUrl],
  );
  const serviceStatusLabel = checkingService ? 'SCANNING' : serviceHealth?.ok ? 'ONLINE' : 'OFFLINE';
  const serviceStatusType = checkingService ? 'info' : serviceHealth?.ok ? 'success' : 'error';

  useEffect(() => {
    let alive = true;
    getPlatformServiceBaseUrl()
      .then(value => {
        if (alive) setServiceBaseUrl(value);
      })
      .catch(() => {});

    checkPlatformService()
      .then(result => {
        if (!alive) return;
        setServiceHealth(result);
        setServiceBaseUrl(result.baseUrl);
      })
      .finally(() => {
        if (alive) setCheckingService(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const handleLogin = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');

    try {
      await login(email, password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败，请检查账号或平台服务。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaWrapper style={styles.safeArea}>
      {isDark ? <GridBackground spacing={24} /> : null}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.backgroundTint,
          { backgroundColor: isDark ? 'rgba(47, 248, 1, 0.035)' : 'rgba(0, 81, 174, 0.04)' },
        ]}
      />

      <View
        style={[
          styles.topBar,
          {
            backgroundColor: isDark ? 'rgba(11, 14, 17, 0.86)' : theme.colors.surfaceContainerLow,
            borderBottomColor: isDark ? 'rgba(255,255,255,0.1)' : theme.colors.outlineVariant,
          },
        ]}>
        <View style={styles.topBarBrand}>
          <IconBadge name="terminal" tone="primary" size={30} iconSize={15} />
          <Text style={[theme.typography.codeSm, styles.topBarTitle, { color: theme.colors.primary }]}>
            PLATFORM_LOGIN
          </Text>
        </View>
        <IconBadge name="shield" tone={serviceHealth?.ok ? 'secondary' : 'neutral'} size={30} iconSize={15} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <View
            style={[
              styles.header,
              {
                borderLeftColor: accentColor,
              },
            ]}>
            <View style={styles.headerTitleRow}>
              <View style={[styles.headerDot, { backgroundColor: accentColor }]} />
              <Text style={[styles.gatewayTitle, { color: accentColor }]}>
                PLATFORM_SESSION
              </Text>
            </View>
            <Text style={[theme.typography.codeSm, styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
              USER LOGIN // DEVICES / PROJECTS / AGENTS
            </Text>
          </View>

          <GlassPanel
            glowColor="primary"
            style={[
              styles.panel,
              {
                backgroundColor: isDark ? 'rgba(24, 34, 22, 0.72)' : theme.colors.surfaceContainerLow,
                borderColor: mutedBorderColor,
              },
            ]}>
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.panelScanline, { borderColor: accentColor }]} />

            <View
              style={[
                styles.serviceRow,
                {
                  backgroundColor: isDark ? 'rgba(7, 17, 6, 0.72)' : theme.colors.surfaceContainerLowest,
                  borderColor: mutedBorderColor,
                },
              ]}>
              <View style={styles.serviceText}>
                <Text style={[theme.typography.labelCaps, styles.noTracking, { color: theme.colors.onSurfaceVariant }]}>
                  PLATFORM SERVICE
                </Text>
                <Text
                  style={[theme.typography.codeSm, styles.serviceUrl, { color: accentColor }]}
                  numberOfLines={1}>
                  {displayServiceHost}
                </Text>
              </View>
              <View style={styles.serviceStatus}>
                {checkingService ? <ActivityIndicator size="small" color={accentColor} /> : null}
                <StatusChip
                  label={serviceStatusLabel}
                  type={serviceStatusType}
                  style={styles.statusChip}
                />
              </View>
            </View>

            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={[theme.typography.labelCaps, styles.noTracking, { color: theme.colors.onSurfaceVariant }]}>
                  USER_EMAIL
                </Text>
                <View
                  style={[
                    styles.inputShell,
                    {
                      backgroundColor: isDark ? 'rgba(7, 17, 6, 0.76)' : theme.colors.surfaceContainerLowest,
                      borderColor: mutedBorderColor,
                    },
                  ]}>
                  <Text style={[theme.typography.codeMd, styles.prompt, { color: accentColor }]}>{'>'}</Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="username"
                    autoComplete="email"
                    placeholder="name@example.com"
                    placeholderTextColor={isDark ? 'rgba(185, 204, 178, 0.48)' : theme.colors.onSurfaceVariant}
                    style={[
                      theme.typography.codeSm,
                      styles.input,
                      { color: theme.colors.onSurface },
                    ]}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => passwordInputRef.current?.focus()}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={[theme.typography.labelCaps, styles.noTracking, { color: theme.colors.onSurfaceVariant }]}>
                  PASSWORD
                </Text>
                <View
                  style={[
                    styles.inputShell,
                    {
                      backgroundColor: isDark ? 'rgba(7, 17, 6, 0.76)' : theme.colors.surfaceContainerLowest,
                      borderColor: mutedBorderColor,
                    },
                  ]}>
                  <Text style={[theme.typography.codeMd, styles.prompt, { color: accentColor }]}>{'>'}</Text>
                  <TextInput
                    ref={passwordInputRef}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    textContentType="password"
                    autoComplete="current-password"
                    placeholder="输入平台密码"
                    placeholderTextColor={isDark ? 'rgba(185, 204, 178, 0.48)' : theme.colors.onSurfaceVariant}
                    style={[
                      theme.typography.codeSm,
                      styles.input,
                      { color: theme.colors.onSurface },
                    ]}
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                  />
                </View>
              </View>

              {error ? (
                <View
                  style={[
                    styles.errorBox,
                    {
                      backgroundColor: isDark ? 'rgba(255, 180, 171, 0.08)' : theme.colors.errorContainer,
                      borderColor: isDark ? 'rgba(255, 180, 171, 0.32)' : theme.colors.error,
                    },
                  ]}>
                  <Text style={[theme.typography.bodySm, styles.error, { color: theme.colors.error }]}>
                    {error}
                  </Text>
                </View>
              ) : null}

              <GlowButton
                title="登录平台"
                onPress={handleLogin}
                loading={submitting}
                disabled={buttonDisabled}
                style={[
                  styles.authButton,
                  !buttonDisabled
                    ? {
                        backgroundColor: accentColor,
                        shadowColor: accentColor,
                        shadowOffset: { width: 0, height: 0 },
                        shadowOpacity: isDark ? 0.28 : 0.12,
                        shadowRadius: 16,
                      }
                    : null,
                ]}
                textStyle={[styles.authButtonText, { color: isDark ? theme.colors.onSecondary : theme.colors.onPrimary }]}
              />
            </View>
          </GlassPanel>

          <View style={styles.metaGrid}>
            <View
              style={[
                styles.metaCard,
                {
                  backgroundColor: isDark ? 'rgba(20, 30, 18, 0.78)' : theme.colors.surfaceContainerLow,
                  borderColor: mutedBorderColor,
                },
              ]}>
              <Text style={[theme.typography.labelCaps, styles.metaLabel, { color: theme.colors.onSurfaceVariant }]}>
                NODE_LOCATION
              </Text>
              <Text style={[theme.typography.codeSm, styles.metaValue, { color: theme.colors.onSurface }]} numberOfLines={1}>
                {displayServiceHost}
              </Text>
            </View>
            <View
              style={[
                styles.metaCard,
                {
                  backgroundColor: isDark ? 'rgba(20, 30, 18, 0.78)' : theme.colors.surfaceContainerLow,
                  borderColor: mutedBorderColor,
                },
              ]}>
              <Text style={[theme.typography.labelCaps, styles.metaLabel, { color: theme.colors.onSurfaceVariant }]}>
                SESSION_SCOPE
              </Text>
              <Text style={[theme.typography.codeSm, styles.metaValue, { color: theme.colors.onSurface }]} numberOfLines={1}>
                USER DEVICES
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View pointerEvents="none" style={[styles.corner, styles.cornerTopLeft, { borderColor: accentColor }]} />
      <View pointerEvents="none" style={[styles.corner, styles.cornerTopRight, { borderColor: accentColor }]} />
      <View pointerEvents="none" style={[styles.corner, styles.cornerBottomLeft, { borderColor: accentColor }]} />
      <View pointerEvents="none" style={[styles.corner, styles.cornerBottomRight, { borderColor: accentColor }]} />
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    overflow: 'hidden',
  },
  backgroundTint: {
    opacity: 1,
  },
  topBar: {
    height: 48,
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  topBarTitle: {
    fontWeight: '800',
    letterSpacing: 0,
  },
  keyboard: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 30,
    gap: 20,
  },
  header: {
    borderLeftWidth: 2,
    paddingLeft: 16,
    paddingVertical: 4,
    gap: 8,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerDot: {
    width: 8,
    height: 8,
  },
  gatewayTitle: {
    fontFamily: 'Space Grotesk',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
    letterSpacing: 0,
  },
  subtitle: {
    letterSpacing: 0,
  },
  panel: {
    padding: 18,
    gap: 18,
    position: 'relative',
  },
  panelScanline: {
    top: -1,
    left: 0,
    right: 0,
    height: 68,
    borderBottomWidth: 1,
    opacity: 0.08,
  },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  serviceText: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  serviceUrl: {
    letterSpacing: 0,
  },
  serviceStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusChip: {
    borderRadius: 4,
  },
  form: {
    gap: 16,
  },
  field: {
    gap: 8,
  },
  inputShell: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  prompt: {
    marginRight: 10,
    letterSpacing: 0,
  },
  input: {
    flex: 1,
    minHeight: 46,
    paddingVertical: 10,
    paddingHorizontal: 0,
    letterSpacing: 0,
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  error: {
    lineHeight: 18,
  },
  authButton: {
    borderRadius: 4,
    marginTop: 4,
  },
  authButtonText: {
    fontFamily: 'JetBrains Mono',
    fontWeight: '700',
    letterSpacing: 0,
  },
  metaGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  metaCard: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 5,
  },
  metaLabel: {
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0,
  },
  metaValue: {
    letterSpacing: 0,
  },
  noTracking: {
    letterSpacing: 0,
  },
  corner: {
    position: 'absolute',
    width: 16,
    height: 16,
  },
  cornerTopLeft: {
    top: 14,
    left: 14,
    borderTopWidth: 1,
    borderLeftWidth: 1,
  },
  cornerTopRight: {
    top: 14,
    right: 14,
    borderTopWidth: 1,
    borderRightWidth: 1,
  },
  cornerBottomLeft: {
    bottom: 14,
    left: 14,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
  },
  cornerBottomRight: {
    bottom: 14,
    right: 14,
    borderBottomWidth: 1,
    borderRightWidth: 1,
  },
});
