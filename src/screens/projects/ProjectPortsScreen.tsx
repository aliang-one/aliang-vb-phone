import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  createPortMapping,
  PortMapping,
  revokePortMapping,
} from '../../api/portMappings';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { PortMappingCard } from '../../components/devices/PortMappingCard';
import { IconBadge } from '../../components/visual/IconBadge';
import { useProjectPortMappings } from '../../hooks/useProjectPortMappings';
import { useTheme } from '../../theme/useTheme';
import { useControlCenterStore } from '../../store/controlCenterStore';
import { RootStackParamList } from '../../app/navigation/types';
import {
  EXPIRY_OPTIONS,
  mappingErrorKey,
  mappingLifetimeSeconds,
  nearestExpiryOption,
  parsePort,
  resolveTunnelBlocker,
} from '../../utils/portInput';

// The project page always maps to the agent's loopback interface — the
// preview server / dev server it exposes listens there.
const TARGET_HOST = '127.0.0.1';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type ProjectPortsRoute = RouteProp<RootStackParamList, 'ProjectPorts'>;

/**
 * Project-scoped public-port management, reached from the project-detail hero
 * "ports" cell. Everything the old inline section did lives here: the tagged
 * mapping list, the old-server guard, the tunnel gating, and the create form
 * (with agent-detected port quick chips).
 */
export const ProjectPortsScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('projects');
  const { t: td } = useTranslation('devices');
  const navigation = useNavigation<Navigation>();
  const route = useRoute<ProjectPortsRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const project = projects.find(item => item.id === route.params.projectId);
  const device =
    devices.find(item => item.id === route.params.deviceId) ||
    devices.find(item => project?.deviceId && item.id === project.deviceId) ||
    devices.find(item => item.projectIds.includes(route.params.projectId));

  // Shared data source (also feeds the hero "ports" metric on the detail
  // page). reload() after create/revoke keeps list and counts in sync.
  const { mappings, loading, error: loadError, reload } =
    useProjectPortMappings(project?.id);

  const [targetPort, setTargetPort] = useState('');
  const [expiresInSeconds, setExpiresInSeconds] = useState(28_800);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Action errors (create/revoke/open). Rendered in preference to the load
  // error so the latest failure is always what the user sees.
  const [actionError, setActionError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Unmount guard in its own empty-dep effect (never re-armed when the load
  // callback identity changes) — same pattern as PortMappingsScreen.
  useEffect(
    () => () => {
      mountedRef.current = false;
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const parsedPort = parsePort(targetPort);
  // Shared tunnel gate (same helper as the device screen): offline → agent
  // lacks the tunnel capabilities → server tunnel unconfigured. The no-device
  // case keeps its own read-only branch below, so the blocker is only
  // consulted when a device exists (helper also maps missing device →
  // 'offline', which would otherwise shadow that branch).
  const blocker = resolveTunnelBlocker(device);
  const canCreate = Boolean(device && blocker === null && parsedPort);

  const detectedPorts = useMemo(
    () =>
      [...new Set(project?.detectedPorts ?? [])]
        .sort((a, b) => a - b)
        .slice(0, 12),
    [project?.detectedPorts],
  );

  // A new server attaches `tag: null | object` to EVERY mapping; an old server
  // omits the field entirely. Non-empty + all-undefined therefore identifies
  // the old image (an empty list proves nothing either way).
  const legacyServer =
    mappings.length > 0 && mappings.every(item => item.tag === undefined);

  const handleCreate = async () => {
    if (!device || !project || !canCreate || parsedPort == null) return;
    setCreating(true);
    setActionError(null);
    try {
      await createPortMapping({
        deviceId: device.id,
        targetHost: TARGET_HOST,
        targetPort: parsedPort,
        expiresInSeconds,
        projectId: project.id,
      });
      if (!mountedRef.current) return;
      setTargetPort('');
      await reload();
    } catch (createError) {
      if (!mountedRef.current) return;
      setActionError(td(mappingErrorKey(createError, 'portMappings.createFailed')));
    } finally {
      if (mountedRef.current) setCreating(false);
    }
  };

  const performRevoke = async (mapping: PortMapping) => {
    setRevokingId(mapping.id);
    setActionError(null);
    try {
      await revokePortMapping(mapping.id);
      if (!mountedRef.current) return;
      await reload();
    } catch (revokeError) {
      if (!mountedRef.current) return;
      setActionError(td(mappingErrorKey(revokeError, 'portMappings.revokeFailed')));
    } finally {
      if (mountedRef.current) setRevokingId(null);
    }
  };

  const confirmRevoke = (mapping: PortMapping) => {
    Alert.alert(
      td('portMappings.revokeTitle'),
      td('portMappings.revokeBody'),
      [
        { text: td('portMappings.cancel'), style: 'cancel' },
        {
          text: td('portMappings.confirmRevoke'),
          style: 'destructive',
          onPress: () => {
            performRevoke(mapping);
          },
        },
      ],
    );
  };

  // Copy feedback: "COPIED" chip on the card for 1.8s — mirrors the
  // handleCopy / copiedTimerRef pattern in PortMappingsScreen (timer
  // cleared on unmount, mountedRef guards the late setState).
  const handleCopy = (mapping: PortMapping) => {
    Clipboard.setString(mapping.short_url);
    setCopiedId(mapping.id);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setCopiedId(null);
    }, 1800);
  };

  // Expired-card tap: prefill the create form with the mapping's port and
  // original expiry preset, then bring the form (bottom of the scroll) into
  // view — re-creating the same public URL becomes tap + one button press.
  // The optional call guards host instances (test mocks) without the method.
  const handleRecreate = (mapping: PortMapping) => {
    setActionError(null);
    setTargetPort(`${mapping.target_port}`);
    setExpiresInSeconds(
      nearestExpiryOption(mappingLifetimeSeconds(mapping)).seconds,
    );
    scrollRef.current?.scrollToEnd?.({ animated: true });
  };

  const displayedError =
    actionError ??
    (loadError ? td(mappingErrorKey(loadError, 'portMappings.loadFailed')) : null);

  const inputColors = {
    color: theme.colors.onSurface,
    borderColor: isDark
      ? 'rgba(255,255,255,0.10)'
      : theme.colors.outlineVariant,
    backgroundColor: isDark
      ? 'rgba(255,255,255,0.04)'
      : theme.colors.surfaceContainerLow,
  };

  if (!project) {
    return (
      <SafeAreaWrapper>
        <TopAppBar
          title={t('portMappings.section')}
          subtitle={t('projectDetail.notFoundSubtitle')}
          onBack={navigation.goBack}
        />
      </SafeAreaWrapper>
    );
  }

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={t('portMappings.section')}
        subtitle={project.name}
        onBack={navigation.goBack}
      />
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text
              style={[
                theme.typography.bodySm,
                { color: theme.colors.onSurfaceVariant },
              ]}>
              {td('portMappings.loading')}
            </Text>
          </View>
        ) : legacyServer ? (
          // Old server image: the list it returns isn't project-scoped, so
          // neither the cards nor the create form may render here.
          <Notice text={t('portMappings.oldServer')} />
        ) : mappings.length === 0 ? (
          <GlassPanel style={styles.emptyPanel}>
            <IconBadge name="port" tone="neutral" size={38} iconSize={19} />
            <View style={styles.emptyCopy}>
              <Text
                style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                {t('portMappings.emptyTitle')}
              </Text>
              <Text
                style={[
                  theme.typography.bodySm,
                  { color: theme.colors.onSurfaceVariant },
                ]}>
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
                Linking.openURL(mapping.short_url).catch(() => {
                  if (mountedRef.current) {
                    setActionError(td('portMappings.openFailed'));
                  }
                });
              }}
              onRevoke={() => confirmRevoke(mapping)}
              // Only wired when the create form is actually rendered below
              // (same branch: not a legacy server, device online + tunnel up).
              onRecreate={
                !legacyServer && blocker === null
                  ? () => handleRecreate(mapping)
                  : undefined
              }
            />
          ))
        )}

        {displayedError ? (
          <Text
            accessibilityRole="alert"
            style={[
              theme.typography.bodySm,
              styles.error,
              { color: theme.colors.error },
            ]}>
            {displayedError}
          </Text>
        ) : null}

        {legacyServer ? null : !device ? (
          <Notice text={t('portMappings.readOnlyNoDevice')} />
        ) : blocker === 'offline' ? (
          <Notice text={td('portMappings.offline')} />
        ) : blocker === 'unsupported' ? (
          <Notice text={td('portMappings.unsupported')} />
        ) : blocker === 'tunnel' ? (
          <Notice text={td('portMappings.tunnelUnavailable')} />
        ) : (
          <View>
            <SectionHeader label={t('portMappings.createSection')} />
            <GlassPanel style={styles.formPanel}>
              <View style={styles.hostRow}>
                <FieldLabel text={td('portMappings.hostLabel')} />
                <Text
                  style={[
                    theme.typography.codeMd,
                    { color: theme.colors.onSurface },
                  ]}>
                  {TARGET_HOST}
                </Text>
              </View>

              <FieldLabel text={td('portMappings.portLabel')} />
              <TextInput
                testID="port-input"
                value={targetPort}
                onChangeText={value => setTargetPort(value.replace(/\D/g, ''))}
                keyboardType="number-pad"
                maxLength={5}
                placeholder={td('portMappings.portPlaceholder')}
                placeholderTextColor={theme.colors.onSurfaceVariant}
                style={[
                  theme.typography.codeMd,
                  styles.input,
                  inputColors,
                  { borderRadius: theme.borderRadius.md },
                ]}
              />

              {targetPort.length > 0 && parsedPort == null ? (
                <ValidationText text={td('portMappings.invalidPort')} />
              ) : null}

              {detectedPorts.length > 0 ? (
                <>
                  <FieldLabel text={td('portMappings.detectedPorts')} />
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

              <FieldLabel text={td('portMappings.expiryLabel')} />
              <View style={styles.chipRow}>
                {EXPIRY_OPTIONS.map(option => (
                  <ChoiceChip
                    key={option.seconds}
                    label={td(option.labelKey)}
                    active={expiresInSeconds === option.seconds}
                    onPress={() => setExpiresInSeconds(option.seconds)}
                  />
                ))}
              </View>

              <GlowButton
                testID="project-port-create"
                title={
                  creating
                    ? td('portMappings.creating')
                    : td('portMappings.create')
                }
                onPress={handleCreate}
                loading={creating}
                disabled={!canCreate || creating}
              />
            </GlassPanel>
          </View>
        )}
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const SectionHeader = ({ label }: { label: string }) => {
  const { theme, isDark } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text
        style={[
          theme.typography.labelCaps,
          { color: theme.colors.onSurfaceVariant },
        ]}>
        {label}
      </Text>
      <View
        style={[
          styles.sectionDivider,
          {
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.07)'
              : theme.colors.outlineVariant,
          },
        ]}
      />
    </View>
  );
};

const FieldLabel = ({ text }: { text: string }) => {
  const { theme } = useTheme();
  return (
    <Text
      style={[
        theme.typography.labelCaps,
        { color: theme.colors.onSurfaceVariant },
      ]}>
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
    borderColor: active ? theme.colors.primary : theme.colors.outlineVariant,
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
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 48,
    paddingTop: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    marginBottom: 10,
  },
  sectionDivider: {
    flex: 1,
    height: 1,
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
  error: {
    marginTop: 10,
  },
  notice: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginTop: 10,
  },
  formPanel: {
    padding: 14,
    gap: 12,
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
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
});
