import React, { useState } from 'react';
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
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { IconBadge } from '../../components/visual/IconBadge';
import { useTheme } from '../../theme/useTheme';
import { useSessionStore } from '../../../stores/useSettingsStore';
import { useControlCenterStore } from '../../store/controlCenterStore';

export const LoginScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const login = useSessionStore(state => state.login);
  const token = useSessionStore(state => state.token);
  const initializeFromServer = useControlCenterStore(state => state.initializeFromServer);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123456');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      await login(username.trim(), password);
      await initializeFromServer(useSessionStore.getState().token ?? token ?? undefined);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to sign in to the platform.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaWrapper>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}>
          <View style={styles.brandRow}>
            <IconBadge name="agent" tone="primary" size={52} iconSize={26} filled />
            <View style={styles.brandCopy}>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                ALIANG VIBECODING
              </Text>
              <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
                Mobile user space
              </Text>
            </View>
            <StatusChip label="LOGIN" type="info" />
          </View>

          <GlassPanel style={styles.panel}>
            <Field
              label="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              theme={theme}
              isDark={isDark}
            />
            <Field
              label="Password"
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
              title="SIGN IN"
              onPress={handleSubmit}
              loading={loading}
              disabled={!username.trim() || !password || loading}
              style={styles.submitButton}
            />
            {loading ? (
              <View style={styles.syncRow}>
                <ActivityIndicator color={theme.colors.primary} size="small" />
                <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  Syncing devices, projects, and VibeCoding sessions
                </Text>
              </View>
            ) : null}
          </GlassPanel>

          <GlassPanel style={styles.defaultPanel}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
              LOCAL DEFAULT
            </Text>
            <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
              admin / admin123456
            </Text>
          </GlassPanel>
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
  defaultPanel: {
    padding: 12,
    gap: 6,
  },
});
