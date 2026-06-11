import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { GridBackground } from '../../components/layout/GridBackground';
import { RootStackScreenProps } from '../../app/navigation/types';
import { loginWithAccessKey } from '../../api/auth';
import { useAuthStore } from '../../../stores/useSettingsStore';

export const LoginScreen: React.FC<RootStackScreenProps<'Login'>> = () => {
  const { theme, isDark } = useTheme();
  const login = useAuthStore(state => state.login);
  const [agentId, setAgentId] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    const trimmedAgentId = agentId.trim();
    const trimmedAccessKey = accessKey.trim();

    if (!trimmedAgentId || !trimmedAccessKey) {
      return;
    }

    setError('');
    setLoading(true);

    try {
      const result = await loginWithAccessKey(trimmedAgentId, trimmedAccessKey);
      login(result.agentId, result.accessToken);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to authenticate with the local service.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaWrapper>
      {isDark && <GridBackground />}
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text
            style={[
              theme.typography.headlineMd,
              { color: theme.colors.onSurface },
            ]}>
            AUTHENTICATE
          </Text>
          <Text
            style={[
              theme.typography.labelCaps,
              { color: theme.colors.onSurfaceVariant },
              styles.subtitle,
            ]}>
            ENTER CREDENTIALS TO ACCESS COMMAND CENTER
          </Text>
        </View>

        {/* Form */}
        <GlassPanel style={styles.form}>
          {/* Agent ID */}
          <View style={styles.field}>
            <Text
              style={[
                theme.typography.labelCaps,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              AGENT_ID
            </Text>
            <TextInput
              value={agentId}
              onChangeText={setAgentId}
              placeholder="user@terminal-01"
              placeholderTextColor={theme.colors.onSurfaceVariant}
              autoCapitalize="none"
              style={[
                theme.typography.codeSm,
                {
                  color: theme.colors.onSurface,
                  backgroundColor: isDark
                    ? 'rgba(255, 255, 255, 0.03)'
                    : theme.colors.surfaceContainer,
                  borderRadius: theme.borderRadius.sm,
                  borderColor: isDark
                    ? 'rgba(255, 255, 255, 0.08)'
                    : theme.colors.outlineVariant,
                },
                styles.input,
              ]}
            />
          </View>

          {/* Access Key */}
          <View style={styles.field}>
            <Text
              style={[
                theme.typography.labelCaps,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              ACCESS_KEY
            </Text>
            <TextInput
              value={accessKey}
              onChangeText={setAccessKey}
              placeholder="••••••••••••"
              placeholderTextColor={theme.colors.onSurfaceVariant}
              secureTextEntry
              style={[
                theme.typography.codeSm,
                {
                  color: theme.colors.onSurface,
                  backgroundColor: isDark
                    ? 'rgba(255, 255, 255, 0.03)'
                    : theme.colors.surfaceContainer,
                  borderRadius: theme.borderRadius.sm,
                  borderColor: isDark
                    ? 'rgba(255, 255, 255, 0.08)'
                    : theme.colors.outlineVariant,
                },
                styles.input,
              ]}
            />
          </View>

          {/* Login Button */}
          <GlowButton
            title="AUTHENTICATE"
            onPress={handleLogin}
            loading={loading}
            disabled={!agentId.trim() || !accessKey.trim()}
            variant="primary"
            textStyle={{
              fontFamily: 'JetBrains Mono',
              letterSpacing: 2,
            }}
          />

          {error ? (
            <Text style={[theme.typography.bodySm, { color: theme.colors.error }]}>
              {error}
            </Text>
          ) : null}

          {/* Biometric */}
          <TouchableOpacity style={styles.biometricRow}>
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              [FINGERPRINT] BIOMETRIC_AUTH
            </Text>
          </TouchableOpacity>
        </GlassPanel>

        {/* Meta Data */}
        <View style={styles.metaArea}>
          <View style={styles.metaRow}>
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              NODE_LOCATION
            </Text>
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              us-east-1a
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              PROTO_STAMP
            </Text>
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              TLS1.3/AES-256
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              SESSION_ID
            </Text>
            <Text
              style={[
                theme.typography.codeSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {Math.random().toString(36).substring(2, 10).toUpperCase()}
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    marginBottom: 32,
  },
  subtitle: {
    marginTop: 4,
  },
  form: {
    padding: 16,
    gap: 16,
  },
  field: {
    gap: 6,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  biometricRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  metaArea: {
    marginTop: 24,
    gap: 8,
    paddingHorizontal: 8,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
