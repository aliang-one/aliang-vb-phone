import React, { useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  Keyboard,
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
  // Whether to show the explicit biometric login entry button (saved creds +
  // biometry available). The user taps it to trigger the prompt — no auto-prompt.
  const [bioEntry, setBioEntry] = useState(false);
  // Spinner state on the entry button while the prompt + login are in flight.
  const [bioBusy, setBioBusy] = useState(false);

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

  // Explicit biometric login (user tapped the entry button). Dismiss the keyboard
  // first — the IME and BiometricPrompt fight for the window and the prompt gets
  // canceled (Android ERROR_CANCELED) when the keyboard is up — then wait for
  // interactions (the dismiss animation) to settle before prompting.
  const handleBiometricLogin = () => {
    Keyboard.dismiss();
    setBioBusy(true);
    InteractionManager.runAfterInteractions(async () => {
      const result: LoadResult = await loadCredentials({
        title: t('biometricPromptTitle'),
        cancel: t('biometricPromptCancel'),
      });
      setBioBusy(false);
      if (result.status !== 'ok') {
        // cancelled: leave the entry button so the user can tap again or type.
        // unavailable: biometry no longer usable (enrollment removed / passcode
        // off) — hide the entry and clear the flag so it doesn't come back.
        if (result.status === 'unavailable') {
          await writeCredentialFlag({
            hasCreds: false,
            usesBiometry: false,
            savedAccount: null,
          });
          setBioEntry(false);
        }
        return;
      }
      setEmail(result.email);
      setPassword(result.password);
      await handleSubmitWith(result.email, result.password);
    });
  };

  // On focus: just READ the flag to decide what to offer. No auto-prompt (the
  // auto-prompt raced with manual typing and the keyboard, firing after login or
  // getting canceled). The user explicitly taps the entry button instead.
  useFocusEffect(
    React.useCallback(() => {
      let mounted = true;
      (async () => {
        const flag = await readCredentialFlag();
        if (!mounted) return;
        setBioEntry(flag.hasCreds && flag.usesBiometry);
        if (flag.hasCreds && !flag.usesBiometry) {
          // Biometry-less device: prefill the form (plain read, no prompt).
          const result = await loadCredentials({
            title: t('biometricPromptTitle'),
            cancel: t('biometricPromptCancel'),
          });
          if (!mounted) return;
          if (result.status === 'ok') {
            setEmail(result.email);
            setPassword(result.password);
          } else if (result.status === 'unavailable') {
            await writeCredentialFlag({ hasCreds: false, usesBiometry: false, savedAccount: null });
          }
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
            {bioEntry ? (
              <GlowButton
                title={t('biometricRetry')}
                testID="biometric-entry"
                onPress={handleBiometricLogin}
                loading={bioBusy}
                style={styles.submitButton}
              />
            ) : null}
            <Field
              label={t('email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              theme={theme}
              isDark={isDark}
            />
            <Field
              label={t('password')}
              value={password}
              onChangeText={setPassword}
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
  errorText: {
    lineHeight: 18,
  },
	  endpointText: {
	    textAlign: 'center',
	  },
	});
