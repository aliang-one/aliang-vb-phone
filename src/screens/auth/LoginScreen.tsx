import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { Logo } from '../../components/visual/Logo';
import { useTheme } from '../../theme/useTheme';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useLocale } from '../../i18n/useLocale';
import { useSessionStore } from '../../../stores/useSettingsStore';
import {
  readCredentialFlag,
  loadCredentials,
  writeCredentialFlag,
  type LoadResult,
} from '../../services/credentialStore';
import { ALIANG_ACCOUNT_BASE_URL } from '../../config/accountService';

export const LoginScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('auth');
  const { locale, setLocale } = useLocale();
  const login = useSessionStore(state => state.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bioRetry, setBioRetry] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  // Aborts a pending auto-submit if the user starts typing before the biometric
  // prompt resolves.
  const cancelledRef = useRef(false);

  const handleSubmitWith = async (emailArg: string, passwordArg: string) => {
    if (!emailArg.trim() || !passwordArg) return;
    setLoading(true);
    setError('');
    try {
      await login(emailArg.trim(), passwordArg);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t('errorFallback'),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => handleSubmitWith(email, password);

  const onEmailChange = (value: string) => {
    cancelledRef.current = true;
    setEmail(value);
  };
  const onPasswordChange = (value: string) => {
    cancelledRef.current = true;
    setPassword(value);
  };

  // On focus: if saved credentials exist, try biometric one-tap login (or
  // prefill on biometry-less devices). Self-heals the flag if the keychain
  // entry is gone, and offers a retry button only when retry can succeed.
  useFocusEffect(
    React.useCallback(() => {
      let mounted = true;
      cancelledRef.current = false;
      (async () => {
        const flag = await readCredentialFlag();
        if (!mounted || !flag.hasCreds) return;
        setBioLoading(true);
        const result: LoadResult = await loadCredentials({
          title: t('biometricPromptTitle'),
          cancel: t('biometricPromptCancel'),
        });
        setBioLoading(false);
        if (!mounted || cancelledRef.current) return;
        if (result.status === 'ok') {
          setEmail(result.email);
          setPassword(result.password);
          if (flag.usesBiometry) {
            await handleSubmitWith(result.email, result.password);
          }
        } else {
          // cancelled OR unavailable → self-heal flag.
          await writeCredentialFlag({ hasCreds: false, usesBiometry: false });
          // retry only when retry can succeed (cancel), not on unavailable.
          setBioRetry(result.status === 'cancelled' && flag.usesBiometry);
        }
      })();
      return () => {
        mounted = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  return (
    <SafeAreaWrapper>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}>
          <View style={styles.langRow}>
            {(['en', 'zh'] as const).map(opt => (
              <Pressable
                key={opt}
                onPress={() => setLocale(opt)}
                style={[
                  styles.langBtn,
                  {
                    borderColor: locale === opt ? theme.colors.primary : theme.colors.outlineVariant,
                    backgroundColor:
                      locale === opt
                        ? isDark
                          ? 'rgba(86,156,214,0.12)'
                          : 'rgba(0,81,174,0.08)'
                        : 'transparent',
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: locale === opt ? theme.colors.primary : theme.colors.onSurfaceVariant },
                  ]}>
                  {opt === 'en' ? 'EN' : '中文'}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.brandRow}>
            <Logo size={52} />
            <View style={styles.brandCopy}>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                ALIANG VIBECODING
              </Text>
              <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
                {t('title')}
              </Text>
            </View>
            <StatusChip label="ALIANG.ONE" type="info" />
          </View>

          <GlassPanel style={styles.panel}>
            {bioLoading ? (
              <View style={styles.bioLoadingRow}>
                <ActivityIndicator color={theme.colors.primary} size="small" />
                <Text
                  style={[
                    theme.typography.labelSm,
                    { color: theme.colors.onSurfaceVariant },
                  ]}>
                  {t('biometricLoading')}
                </Text>
              </View>
            ) : null}
            {bioRetry ? (
              <GlowButton
                title={t('biometricRetry')}
                testID="biometric-retry"
                onPress={async () => {
                  const result = await loadCredentials({
                    title: t('biometricPromptTitle'),
                    cancel: t('biometricPromptCancel'),
                  });
                  if (result.status !== 'ok') return;
                  cancelledRef.current = false;
                  setEmail(result.email);
                  setPassword(result.password);
                  setBioRetry(false);
                  await handleSubmitWith(result.email, result.password);
                }}
                style={styles.submitButton}
              />
            ) : null}
            <Field
              label={t('email')}
              value={email}
              onChangeText={onEmailChange}
              autoCapitalize="none"
              keyboardType="email-address"
              theme={theme}
              isDark={isDark}
            />
            <Field
              label={t('password')}
              value={password}
              onChangeText={onPasswordChange}
              secureTextEntry
              theme={theme}
              isDark={isDark}
            />
            {error ? (
              <Text style={[theme.typography.bodySm, styles.errorText, { color: theme.colors.error }]}>
                {error}
              </Text>
            ) : null}
            <GlowButton
              title={t('signIn')}
              onPress={handleSubmit}
              loading={loading}
              disabled={!email.trim() || !password || loading}
              style={styles.submitButton}
            />
            {loading ? (
              <View style={styles.syncRow}>
                <ActivityIndicator color={theme.colors.primary} size="small" />
                <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  {t('syncing')}
                </Text>
              </View>
            ) : null}
          </GlassPanel>
	          <Text style={[theme.typography.codeSm, styles.endpointText, { color: theme.colors.onSurfaceVariant }]}>
	            {ALIANG_ACCOUNT_BASE_URL}
	          </Text>
	        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaWrapper>
  );
};

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address';
  secureTextEntry?: boolean;
  theme: ReturnType<typeof useTheme>['theme'];
  isDark: boolean;
}

const Field: React.FC<FieldProps> = ({
  label,
  value,
  onChangeText,
  autoCapitalize,
  keyboardType,
  secureTextEntry,
  theme,
  isDark,
}) => (
  <View style={styles.field}>
    <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
      {label}
    </Text>
    <TextInput
      value={value}
      onChangeText={onChangeText}
      autoCapitalize={autoCapitalize}
      keyboardType={keyboardType}
      secureTextEntry={secureTextEntry}
      placeholderTextColor={theme.colors.onSurfaceVariant}
      style={[
        theme.typography.bodyMd,
        styles.input,
        {
          color: theme.colors.onSurface,
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : theme.colors.outlineVariant,
          backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : theme.colors.surfaceContainerLowest,
        },
      ]}
    />
  </View>
);

const styles = StyleSheet.create({
  keyboard: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 16,
    gap: 14,
  },
  langRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  langBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 999,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandCopy: {
    flex: 1,
    gap: 2,
  },
  panel: {
    padding: 14,
    gap: 14,
  },
  field: {
    gap: 6,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  submitButton: {
    marginTop: 2,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bioLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    lineHeight: 18,
  },
	  endpointText: {
	    textAlign: 'center',
	  },
	});
