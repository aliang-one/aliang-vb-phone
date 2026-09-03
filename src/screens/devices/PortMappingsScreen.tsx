import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../app/navigation/types';
import {
  createPortMapping,
  fetchPortMappings,
  PortMapping,
  revokePortMapping,
  tunnelHealth,
  TunnelStatusInfo,
} from '../../api/portMappings';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { PortMappingCard } from '../../components/devices/PortMappingCard';
import { IconBadge } from '../../components/visual/IconBadge';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { useTheme } from '../../theme/useTheme';
import {
  EXPIRY_OPTIONS,
  isAllowedTargetHost,
  mappingErrorKey,
  parsePort,
} from '../../utils/portInput';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type PortMappingsRoute = RouteProp<RootStackParamList, 'PortMappings'>;

export const PortMappingsScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('devices');
  const navigation = useNavigation<Navigation>();
  const route = useRoute<PortMappingsRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const device = devices.find(item => item.id === route.params.deviceId);
  const [targetHost, setTargetHost] = useState('127.0.0.1');
  const [targetPort, setTargetPort] = useState('');
  const [expiresInSeconds, setExpiresInSeconds] = useState(28_800);
  const [mappings, setMappings] = useState<PortMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const loadMappings = useCallback(
    async (refresh = false) => {
      refresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const result = await fetchPortMappings({ deviceId: route.params.deviceId });
        if (!mountedRef.current) return;
        setMappings(
          [...result].sort(
            (left, right) =>
              new Date(right.created_at).getTime() -
              new Date(left.created_at).getTime(),
          ),
        );
      } catch (loadError) {
        if (!mountedRef.current) return;
        setError(t(mappingErrorKey(loadError, 'portMappings.loadFailed')));
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [route.params.deviceId, t],
  );

  useEffect(() => {
    loadMappings();
  }, [loadMappings]);

  const parsedPort = parsePort(targetPort);
  const hostValid = isAllowedTargetHost(targetHost);
  const supportsTunnel =
    (device?.capabilities.includes('http_tunnel_v1') &&
      device.capabilities.includes('websocket_tunnel_v1')) ??
    false;
  const canCreate = Boolean(
    device &&
      device.status === 'online' &&
      supportsTunnel &&
      hostValid &&
      parsedPort,
  );
  const detectedPorts = useMemo(
    () =>
      [...new Set(device?.activePorts ?? [])]
        .sort((a, b) => a - b)
        .slice(0, 12),
    [device?.activePorts],
  );
  // The Piko data channel is per-device, so every mapping of this device
  // carries the same tunnel_status; surface it so a dead tunnel (502 on the
  // public URL) is visible instead of silently showing 'active' mappings.
  const deviceTunnel = mappings.find(item => item.tunnel_status)?.tunnel_status;

  const handleCreate = async () => {
    if (!device || !canCreate || parsedPort == null) return;
    setCreating(true);
    setError(null);
    try {
      const mapping = await createPortMapping({
        deviceId: device.id,
        targetHost: targetHost.trim(),
        targetPort: parsedPort,
        expiresInSeconds,
      });
      if (!mountedRef.current) return;
      setMappings(current => [
        mapping,
        ...current.filter(item => item.id !== mapping.id),
      ]);
      setTargetPort('');
    } catch (createError) {
      if (!mountedRef.current) return;
      setError(t(mappingErrorKey(createError, 'portMappings.createFailed')));
    } finally {
      if (mountedRef.current) setCreating(false);
    }
  };

  const handleCopy = (mapping: PortMapping) => {
    Clipboard.setString(mapping.short_url);
    setCopiedId(mapping.id);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setCopiedId(null);
    }, 1800);
  };

  const handleOpen = async (mapping: PortMapping) => {
    try {
      await Linking.openURL(mapping.short_url);
    } catch {
      if (mountedRef.current) setError(t('portMappings.openFailed'));
    }
  };

  const performRevoke = async (mapping: PortMapping) => {
    setRevokingId(mapping.id);
    setError(null);
    try {
      const revoked = await revokePortMapping(mapping.id);
      if (!mountedRef.current) return;
      setMappings(current =>
        current.map(item => (item.id === revoked.id ? revoked : item)),
      );
    } catch (revokeError) {
      if (!mountedRef.current) return;
      setError(t(mappingErrorKey(revokeError, 'portMappings.revokeFailed')));
    } finally {
      if (mountedRef.current) setRevokingId(null);
    }
  };

  const confirmRevoke = (mapping: PortMapping) => {
    Alert.alert(
      t('portMappings.revokeTitle'),
      t('portMappings.revokeBody'),
      [
        { text: t('portMappings.cancel'), style: 'cancel' },
        {
          text: t('portMappings.confirmRevoke'),
          style: 'destructive',
          onPress: () => {
            performRevoke(mapping);
          },
        },
      ],
    );
  };

  if (!device) {
    return (
      <SafeAreaWrapper>
        <TopAppBar
          title={t('portMappings.title')}
          onBack={navigation.goBack}
        />
      </SafeAreaWrapper>
    );
  }

  const inputColors = {
    color: theme.colors.onSurface,
    borderColor: isDark
      ? 'rgba(255,255,255,0.10)'
      : theme.colors.outlineVariant,
    backgroundColor: isDark
      ? 'rgba(255,255,255,0.04)'
      : theme.colors.surfaceContainerLow,
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={t('portMappings.title')}
        subtitle={t('portMappings.subtitle', { device: device.name })}
        onBack={navigation.goBack}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                loadMappings(true);
              }}
              tintColor={theme.colors.primary}
            />
          }>
          <SectionLabel text={t('portMappings.createSection')} />
          <GlassPanel style={styles.formPanel}>
            <View style={styles.inputRow}>
              <View style={styles.hostField}>
                <FieldLabel text={t('portMappings.hostLabel')} />
                <TextInput
                  value={targetHost}
                  onChangeText={setTargetHost}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={t('portMappings.hostPlaceholder')}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  style={[
                    theme.typography.codeMd,
                    styles.input,
                    inputColors,
                    { borderRadius: theme.borderRadius.md },
                  ]}
                />
              </View>
              <View style={styles.portField}>
                <FieldLabel text={t('portMappings.portLabel')} />
                <TextInput
                  value={targetPort}
                  onChangeText={value => setTargetPort(value.replace(/\D/g, ''))}
                  keyboardType="number-pad"
                  maxLength={5}
                  placeholder={t('portMappings.portPlaceholder')}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  style={[
                    theme.typography.codeMd,
                    styles.input,
                    inputColors,
                    { borderRadius: theme.borderRadius.md },
                  ]}
                />
              </View>
            </View>

            {!hostValid ? (
              <ValidationText text={t('portMappings.invalidHost')} />
            ) : null}
            {targetPort.length > 0 && parsedPort == null ? (
              <ValidationText text={t('portMappings.invalidPort')} />
            ) : null}

            {detectedPorts.length > 0 ? (
              <>
                <FieldLabel text={t('portMappings.detectedPorts')} />
                <View style={styles.chipRow}>
                  {detectedPorts.map(port => (
                    <ChoiceChip
                      key={port}
                      label={`${port}`}
                      active={targetPort === `${port}`}
                      onPress={() => setTargetPort(`${port}`)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            <FieldLabel text={t('portMappings.expiryLabel')} />
            <View style={styles.chipRow}>
              {EXPIRY_OPTIONS.map(option => (
                <ChoiceChip
                  key={option.seconds}
                  label={t(option.labelKey)}
                  active={expiresInSeconds === option.seconds}
                  onPress={() => setExpiresInSeconds(option.seconds)}
                />
              ))}
            </View>

            {device.status !== 'online' ? (
              <Notice text={t('portMappings.offline')} />
            ) : !supportsTunnel ? (
              <Notice text={t('portMappings.unsupported')} />
            ) : null}

            <GlowButton
              title={
                creating
                  ? t('portMappings.creating')
                  : t('portMappings.create')
              }
              onPress={handleCreate}
              loading={creating}
              disabled={!canCreate}
            />
          </GlassPanel>

          {error ? (
            <Text
              accessibilityRole="alert"
              style={[theme.typography.bodySm, styles.error, { color: theme.colors.error }]}>
              {error}
            </Text>
          ) : null}

          <SectionLabel text={t('portMappings.listSection')} />
          {deviceTunnel ? <TunnelStatusLine status={deviceTunnel} /> : null}
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text
                style={[
                  theme.typography.bodySm,
                  { color: theme.colors.onSurfaceVariant },
                ]}>
                {t('portMappings.loading')}
              </Text>
            </View>
          ) : mappings.length === 0 ? (
            <GlassPanel style={styles.emptyPanel}>
              <IconBadge name="port" tone="neutral" size={38} iconSize={19} />
              <View style={styles.emptyCopy}>
                <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                  {t('portMappings.emptyTitle')}
                </Text>
                <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                  {t('portMappings.emptyBody')}
                </Text>
              </View>
            </GlassPanel>
          ) : (
            mappings.map(mapping => (
              <PortMappingCard
                key={mapping.id}
                mapping={mapping}
                copied={copiedId === mapping.id}
                revoking={revokingId === mapping.id}
                onCopy={() => handleCopy(mapping)}
                onOpen={() => {
                  handleOpen(mapping);
                }}
                onRevoke={() => confirmRevoke(mapping)}
              />
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaWrapper>
  );
};

const SectionLabel = ({ text }: { text: string }) => {
  const { theme } = useTheme();
  return (
    <Text
      style={[
        theme.typography.labelCaps,
        styles.sectionLabel,
        { color: theme.colors.onSurfaceVariant },
      ]}>
      {text}
    </Text>
  );
};

const TUNNEL_STATE_LABEL_KEYS: Record<string, string> = {
  connecting: 'portMappings.tunnelConnecting',
  connected: 'portMappings.tunnelConnected',
  reconnecting: 'portMappings.tunnelReconnecting',
  failed: 'portMappings.tunnelFailed',
  stopped: 'portMappings.tunnelStopped',
  control_disconnected: 'portMappings.tunnelControlDisconnected',
};

const TunnelStatusLine = ({ status }: { status: TunnelStatusInfo }) => {
  const { theme } = useTheme();
  const { t } = useTranslation('devices');
  const health = tunnelHealth(status);
  const dotColor =
    health === 'ok'
      ? theme.colors.success
      : health === 'down'
        ? theme.colors.error
        : theme.colors.warning;
  const labelKey =
    TUNNEL_STATE_LABEL_KEYS[status.state] ?? 'portMappings.tunnelUnknown';
  return (
    <View style={styles.tunnelRow}>
      <View style={[styles.tunnelDot, { backgroundColor: dotColor }]} />
      <Text
        style={[
          theme.typography.labelSm,
          { color: theme.colors.onSurfaceVariant, flex: 1 },
        ]}>
        {t('portMappings.tunnelPrefix')} · {t(labelKey)}
        {status.error ? `\n${status.error}` : null}
      </Text>
    </View>
  );
};

const FieldLabel = ({ text }: { text: string }) => {
  const { theme } = useTheme();
  return (
    <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
      {text}
    </Text>
  );
};

const ValidationText = ({ text }: { text: string }) => {
  const { theme } = useTheme();
  return (
    <Text style={[theme.typography.labelSm, { color: theme.colors.error }]}>
      {text}
    </Text>
  );
};

const Notice = ({ text }: { text: string }) => {
  const { theme, isDark } = useTheme();
  const surfaceStyle = {
    borderColor: theme.colors.warning,
    backgroundColor: isDark
      ? 'rgba(206,145,120,0.10)'
      : 'rgba(184,134,11,0.08)',
    borderRadius: theme.borderRadius.sm,
  };
  return (
    <View style={[styles.notice, surfaceStyle]}>
      <Text style={[theme.typography.bodySm, { color: theme.colors.onSurface }]}>
        {text}
      </Text>
    </View>
  );
};

interface ChoiceChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

const ChoiceChip = ({ label, active, onPress }: ChoiceChipProps) => {
  const { theme, isDark } = useTheme();
  const chipStyle = {
    borderRadius: theme.borderRadius.full,
    borderColor: active
      ? theme.colors.primary
      : theme.colors.outlineVariant,
    backgroundColor: active
      ? isDark
        ? 'rgba(86,156,214,0.14)'
        : 'rgba(0,81,174,0.08)'
      : 'transparent',
  };
  return (
    <TouchableOpacity
      activeOpacity={0.72}
      onPress={onPress}
      style={[styles.choiceChip, chipStyle]}>
      <Text
        style={[
          theme.typography.labelSm,
          { color: active ? theme.colors.primary : theme.colors.onSurfaceVariant },
        ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  sectionLabel: {
    marginTop: 8,
    marginBottom: 8,
  },
  tunnelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  tunnelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  formPanel: {
    padding: 14,
    gap: 12,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  hostField: {
    flex: 1,
    gap: 6,
  },
  portField: {
    width: 100,
    gap: 6,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choiceChip: {
    minHeight: 34,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  error: {
    marginTop: 10,
  },
  loadingRow: {
    minHeight: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyPanel: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emptyCopy: {
    flex: 1,
    gap: 4,
  },
});
