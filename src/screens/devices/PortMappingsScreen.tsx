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
} from '../../api/portMappings';
import { ApiResponseError } from '../../api/client';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { IconBadge, IconName } from '../../components/visual/IconBadge';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { useTheme } from '../../theme/useTheme';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type PortMappingsRoute = RouteProp<RootStackParamList, 'PortMappings'>;

const EXPIRY_OPTIONS = [
  { seconds: 3_600, labelKey: 'portMappings.expiry1h' },
  { seconds: 28_800, labelKey: 'portMappings.expiry8h' },
  { seconds: 86_400, labelKey: 'portMappings.expiry24h' },
  { seconds: 604_800, labelKey: 'portMappings.expiry7d' },
] as const;

const isAllowedTargetHost = (input: string) => {
  const host = input.trim().toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const octets = parts.map(Number);
  if (octets.some(octet => octet < 0 || octet > 255)) return false;
  if (octets[0] === 127 || octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  return octets[0] === 192 && octets[1] === 168;
};

const parsePort = (input: string) => {
  if (!/^\d+$/.test(input.trim())) return null;
  const port = Number(input);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
};

const effectiveStatus = (mapping: PortMapping) => {
  if (mapping.status === 'revoked') return 'revoked' as const;
  if (new Date(mapping.expires_at).getTime() <= Date.now()) {
    return 'expired' as const;
  }
  return 'active' as const;
};

const mappingErrorKey = (error: unknown, fallbackKey: string) => {
  if (
    error instanceof ApiResponseError &&
    [
      'tunnel_service_unavailable',
      'tunnel_gateway_unavailable',
      'tunnel_gateway_error',
    ].includes(error.code ?? '')
  ) {
    return 'portMappings.serviceUnavailable';
  }
  return fallbackKey;
};

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
        const result = await fetchPortMappings(route.params.deviceId);
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
              <MappingCard
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

interface MappingCardProps {
  mapping: PortMapping;
  copied: boolean;
  revoking: boolean;
  onCopy: () => void;
  onOpen: () => void;
  onRevoke: () => void;
}

const MappingCard = ({
  mapping,
  copied,
  revoking,
  onCopy,
  onOpen,
  onRevoke,
}: MappingCardProps) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('devices');
  const status = effectiveStatus(mapping);
  const active = status === 'active';
  const statusType = active ? 'success' : 'neutral';
  const urlSurfaceStyle = {
    backgroundColor: isDark
      ? 'rgba(0,0,0,0.20)'
      : theme.colors.surfaceContainerLow,
    borderRadius: theme.borderRadius.sm,
  };

  return (
    <GlassPanel style={styles.mappingCard} glowColor={active ? 'primary' : 'none'}>
      <View style={styles.mappingHeader}>
        <View style={styles.mappingTarget}>
          <IconBadge
            name="port"
            tone={active ? 'primary' : 'neutral'}
            size={36}
            iconSize={18}
          />
          <View style={styles.mappingTargetCopy}>
            <Text
              style={[theme.typography.codeMd, { color: theme.colors.onSurface }]}>
              {t('portMappings.target', {
                host: mapping.target_host,
                port: mapping.target_port,
              })}
            </Text>
            <Text
              style={[
                theme.typography.labelSm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {t('portMappings.expires', {
                time: new Date(mapping.expires_at).toLocaleString(),
              })}
            </Text>
          </View>
        </View>
        <StatusChip label={t(`portMappings.${status}`)} type={statusType} />
      </View>

      <View style={[styles.urlRow, urlSurfaceStyle]}>
        <Text
          selectable
          numberOfLines={2}
          style={[
            theme.typography.codeSm,
            styles.url,
            { color: active ? theme.colors.primary : theme.colors.onSurfaceVariant },
          ]}>
          {mapping.short_url}
        </Text>
        {copied ? (
          <Text style={[theme.typography.labelCaps, { color: theme.colors.success }]}>
            {t('portMappings.copied')}
          </Text>
        ) : null}
      </View>

      <View style={styles.mappingActions}>
        <IconAction
          name="copy"
          label={t('portMappings.copy')}
          disabled={!active}
          onPress={onCopy}
        />
        <IconAction
          name="external"
          label={t('portMappings.open')}
          disabled={!active}
          onPress={onOpen}
        />
        <View style={styles.actionSpacer} />
        <IconAction
          name="trash"
          label={t('portMappings.revoke')}
          tone="error"
          loading={revoking}
          disabled={!active}
          onPress={onRevoke}
        />
      </View>
    </GlassPanel>
  );
};

interface IconActionProps {
  name: IconName;
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'error';
  loading?: boolean;
  disabled?: boolean;
}

const IconAction = ({
  name,
  label,
  onPress,
  tone = 'primary',
  loading = false,
  disabled = false,
}: IconActionProps) => {
  const { theme, isDark } = useTheme();
  const actionStyle = {
    borderColor: isDark
      ? 'rgba(255,255,255,0.10)'
      : theme.colors.outlineVariant,
    backgroundColor: isDark
      ? 'rgba(255,255,255,0.04)'
      : theme.colors.surfaceContainerLow,
    borderRadius: theme.borderRadius.sm,
    opacity: disabled ? 0.38 : 1,
  };
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={0.68}
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.iconAction, actionStyle]}>
      {loading ? (
        <ActivityIndicator size="small" color={theme.colors.error} />
      ) : (
        <IconBadge
          name={name}
          tone={tone}
          size={28}
          iconSize={15}
          style={styles.iconBadgeBorderless}
        />
      )}
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
  mappingCard: {
    padding: 12,
    gap: 11,
    marginBottom: 10,
  },
  mappingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  mappingTarget: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mappingTargetCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  urlRow: {
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  url: {
    flex: 1,
    minWidth: 0,
  },
  mappingActions: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionSpacer: {
    flex: 1,
  },
  iconAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconBadgeBorderless: {
    borderWidth: 0,
  },
});
