import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { RootStackParamList } from '../../app/navigation/types';
import {
  AgentProvider,
  useControlCenterStore,
} from '../../store/controlCenterStore';
import { IconBadge } from '../../components/visual/IconBadge';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { catalogEffortOptions, useModelOptions } from '../../hooks/useModelOptions';
import { useRecentModelOptions } from '../../hooks/useRecentModelOptions';
import {
  EFFORT_PROVIDERS,
  availableProviders,
  catalogModelOptions,
  providerLabel,
} from '../../utils/modelIntensity';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type CreateRoute = RouteProp<RootStackParamList, 'CreateVibeCoding'>;

// Per-session approval policy. `inherit` = omit approvalScheme (use project
// default); the other three are explicit overrides forwarded to the server.
type ApprovalChoice = 'inherit' | 'allow_all' | 'ask_all' | 'read_only';
const APPROVAL_OPTIONS: ApprovalChoice[] = ['inherit', 'allow_all', 'ask_all', 'read_only'];

const uniqueStrings = (items: Array<string | undefined>) =>
  Array.from(new Set(items.filter(Boolean))) as string[];

export const CreateVibeCodingScreen: React.FC = () => {
  const { t } = useTranslation('vibecoding');
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<CreateRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  // In-flight guard so a user can't tap "create" repeatedly and fire N parallel
  // navigations. "Create" here only OPENS the chat with the chosen config — no
  // server call. The session + its first message are created when the user sends
  // the first message from the chat (DraftVibeCoding screen).
  const [creating, setCreating] = useState(false);
  const initialDeviceId = route.params?.deviceId ?? devices[0]?.id ?? '';
  const initialProjectId =
    route.params?.projectId ??
    projects.find(project => project.deviceId === initialDeviceId)?.id ??
    devices.find(device => device.id === initialDeviceId)?.projectIds[0] ??
    projects[0]?.id ??
    '';

  const [deviceId, setDeviceId] = useState(initialDeviceId);
  const [projectId, setProjectId] = useState(initialProjectId);
  // When true the user opted out of the project list and is typing a custom
  // path. A project being selected (projectId !== '' && !useCustomPath) means
  // the session runs inside that project's path — no directory picker shown.
  const [useCustomPath, setUseCustomPath] = useState(false);
  const [provider, setProvider] = useState<AgentProvider>('codex');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  // Live catalog drives the EFFORT chips for the selected provider; falls back
  // to the hardcoded ladder before it loads. "默认" =
  // inherit (don't specify), which is the default selection.
  const { providerCatalog, userDefault } = useModelOptions();
  const effortOptions = catalogEffortOptions(provider, providerCatalog);
  const device = devices.find(item => item.id === deviceId) ?? devices[0];
  // Which providers are actually installed on this device (agent reports via
  // device.tools[].available). Empty tool list → all providers available (don't block
  // creation before the agent reports).
  const availability = useMemo(
    () => availableProviders(device?.tools),
    [device?.tools],
  );
  // Per-provider model chips (codex / claude_code / opencode),
  // from the live catalog with a hardcoded fallback. Lead with "默认" (clear).
  const serverModelOptions = useMemo(
    () => catalogModelOptions(provider, providerCatalog),
    [provider, providerCatalog],
  );
  const { modelOptions: recentFirstModelOptions, rememberModel } =
    useRecentModelOptions(provider, serverModelOptions);
  const modelOptions = useMemo(
    () => [
      { label: t('sessionSettings.defaultChip'), value: '' },
      ...recentFirstModelOptions,
    ],
    [recentFirstModelOptions, t],
  );
  // Keep the selected provider valid for this device: if it's unavailable (e.g.
  // defaulted to codex but only claude code is installed), switch to one that is.
  useEffect(() => {
    if (availability[provider]) return;
    if (availability.codex) setProvider('codex');
    else if (availability.claude_code) setProvider('claude_code');
    else if (availability.opencode) setProvider('opencode');
  }, [availability, provider]);
  const noProviderAvailable = !EFFORT_PROVIDERS.some(item => availability[item]);
  const project = useCustomPath
    ? undefined
    : projects.find(item => item.id === projectId);
  const [directory, setDirectory] = useState(
    project?.path ?? device?.authorizedDirectories[0] ?? '~',
  );
  // Per-session permission overrides. Defaults: inherit project approval +
  // all three capabilities enabled. Read-only snaps Modify/Run OFF and locks
  // the toggles; switching away unlocks them without auto-changing values.
  const [approval, setApproval] = useState<ApprovalChoice>('inherit');
  const [canRead, setCanRead] = useState(true);
  const [canModify, setCanModify] = useState(true);
  const [canRun, setCanRun] = useState(true);
  const isReadOnly = approval === 'read_only';

  const availableProjects = useMemo(
    () =>
      projects.filter(
        item => item.deviceId === device?.id || device?.projectIds.includes(item.id),
      ),
    [device?.id, device?.projectIds, projects],
  );
  const directoryOptions = uniqueStrings([
    ...((device?.authorizedDirectories ?? []) as string[]),
  ]);
  const deviceList = useIncrementalList(devices, {
    initialCount: 8,
    step: 10,
    resetKey: devices.length,
  });
  const projectList = useIncrementalList(availableProjects, {
    initialCount: 6,
    step: 8,
    resetKey: device?.id ?? 'none',
  });
  const directoryList = useIncrementalList(directoryOptions, {
    initialCount: 8,
    step: 12,
    resetKey: `${device?.id ?? 'none'}:${project?.id ?? 'none'}`,
  });

  const chooseApproval = (next: ApprovalChoice) => {
    setApproval(next);
    if (next === 'read_only') {
      setCanRead(true);
      setCanModify(false);
      setCanRun(false);
    }
    // 切走只读:能力开关解锁、保持当前值(不做自动升档)
  };
  // 能力开关在只读下直接 disabled,不做"自动升档"
  const toggleRead = () => {
    if (!isReadOnly) setCanRead(v => !v);
  };
  const toggleModify = () => {
    if (!isReadOnly) setCanModify(v => !v);
  };
  const toggleRun = () => {
    if (!isReadOnly) setCanRun(v => !v);
  };

  const handleCreate = () => {
    if (creating || !device) return;
    rememberModel(model);
    // Project selected → run inside its path (no separate directory). Custom
    // path → use the typed value, falling back to the device's first
    // authorized directory.
    const effectiveDirectory =
      project?.path ?? directory?.trim() ?? device.authorizedDirectories[0] ?? '~';
    // "Create" only OPENS the chat with this config — no server interaction.
    // The session + its first message are created when the user sends the first
    // message from the chat (DraftVibeCoding screen). This is why the button is
    // enabled by config alone (device + provider + permissions), not by a
    // required "objective"/first-message field.
    setCreating(true);
    navigation.replace('VibeCodingSession', {
      draftConfig: {
        deviceId: device.id,
        projectId: project?.id || undefined,
        directory: effectiveDirectory,
        provider,
        model: model.trim() || undefined,
        effort: effort.trim() || undefined,
        approvalScheme: approval === 'inherit' ? undefined : approval,
        canRead,
        canModify,
        canRun,
      },
    });
  };

  if (!device) {
    return (
      <SafeAreaWrapper>
        <TopAppBar
          title="Create VibeCoding"
          subtitle="NO DEVICE"
          onBack={navigation.goBack}
        />
        <View style={styles.emptyContainer}>
          <GlassPanel style={styles.emptyPanel}>
            <IconBadge name="device" tone="neutral" size={46} iconSize={23} />
            <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
              {t('createScreen.noDeviceTitle')}
            </Text>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              {t('createScreen.noDeviceDetail')}
            </Text>
            <GlowButton
              title="BIND DEVICE"
              onPress={() => navigation.navigate('DeviceCameraScanner')}
              variant="outline"
              style={styles.emptyAction}
            />
          </GlassPanel>
        </View>
      </SafeAreaWrapper>
    );
  }

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Create VibeCoding"
        subtitle="DEVICE / DIRECTORY / AGENT"
        onBack={navigation.goBack}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          1. DEVICE
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowScroller}>
          {deviceList.visibleItems.map(item => {
            const active = item.id === deviceId;
            return (
              <TouchableOpacity
	                key={item.id}
	                onPress={() => {
	                  setDeviceId(item.id);
	                  const nextProject =
	                    projects.find(projectItem => projectItem.deviceId === item.id) ??
	                    projects.find(projectItem => item.projectIds.includes(projectItem.id));
	                  if (nextProject) {
                    setProjectId(nextProject.id);
                    setUseCustomPath(false);
                    setDirectory(nextProject.path);
                  } else {
                    // No project for this device → drop into custom-path mode
                    // seeded with the device's first authorized directory.
                    setProjectId('');
                    setUseCustomPath(true);
                    setDirectory(item.authorizedDirectories[0] ?? '~');
                  }
	                }}
                style={[
                  styles.selectCard,
                  {
                    borderRadius: theme.borderRadius.md,
                    borderColor: active ? theme.colors.primary : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(86, 156, 214, 0.1)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : 'transparent',
                  },
                ]}>
                <IconBadge
                  name="device"
                  tone={active ? 'primary' : 'neutral'}
                  size={34}
                  iconSize={17}
                  filled={active}
                />
                <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                  {item.name}
                </Text>
                <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                  {item.status.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <LoadMoreRow
          visibleCount={deviceList.visibleCount}
          totalCount={deviceList.totalCount}
          onPress={deviceList.showMore}
        />

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          2. PROJECT
        </Text>
        <GlassPanel style={styles.optionPanel}>
          {/* Always offer "no project / custom path": selecting it hides the
              directory picker and shows a free-text path input below. Picking a
              real project locks the directory to that project's path. */}
          <TouchableOpacity
            onPress={() => {
              setProjectId('');
              setUseCustomPath(true);
            }}>
            <View style={styles.optionRow}>
              <View style={styles.optionText}>
                <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                  {t('createScreen.customPathTitle')}
                </Text>
                <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  {t('createScreen.customPathDetail')}
                </Text>
              </View>
              <StatusChip label={useCustomPath ? 'SELECTED' : 'CUSTOM'} type={useCustomPath ? 'info' : 'neutral'} />
            </View>
            {availableProjects.length > 0 && <View style={styles.divider} />}
          </TouchableOpacity>
          {availableProjects.length ? (
            <>
          {projectList.visibleItems.map((item, index) => {
            const selected = !useCustomPath && item.id === projectId;
            return (
            <TouchableOpacity
              key={item.id}
              onPress={() => {
                setProjectId(item.id);
                setUseCustomPath(false);
                setDirectory(item.path);
              }}>
              <View style={styles.optionRow}>
                <View style={styles.optionText}>
                  <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                    {item.name}
                  </Text>
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    {item.branch} / {item.language}
                  </Text>
                </View>
                <StatusChip
                  label={selected ? 'SELECTED' : item.status.toUpperCase()}
                  type={selected ? 'info' : 'neutral'}
                />
              </View>
              {index < projectList.visibleItems.length - 1 && <View style={styles.divider} />}
            </TouchableOpacity>
            );
          })}
          <LoadMoreRow
            visibleCount={projectList.visibleCount}
            totalCount={projectList.totalCount}
            onPress={projectList.showMore}
          />
          </>
          ) : null}
        </GlassPanel>

        {/* DIRECTORY: hidden when a project is selected (its path is used).
             Shown as a free-text input only in custom-path mode. */}
        {useCustomPath ? (
          <>
        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          3. DIRECTORY
        </Text>
        <TextInput
          value={directory}
          onChangeText={setDirectory}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t('createScreen.directoryPlaceholder')}
          placeholderTextColor={theme.colors.onSurfaceVariant}
          style={[
            theme.typography.bodyMd,
            styles.modelInput,
            {
              color: theme.colors.onSurface,
              borderRadius: theme.borderRadius.md,
              borderColor: isDark
                ? 'rgba(255,255,255,0.08)'
                : theme.colors.outlineVariant,
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.04)'
                : theme.colors.surfaceContainerLow,
            },
          ]}
        />
        {directoryOptions.length > 0 ? (
          <GlassPanel style={[styles.optionPanel, { marginTop: 10 }]}>
            {directoryOptions.slice(0, directoryList.visibleCount).map((item, index) => (
              <TouchableOpacity
                key={item}
                onPress={() => setDirectory(item)}>
                <View style={styles.optionRow}>
                  <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
                    {item}
                  </Text>
                  {directory === item && <StatusChip label="SELECTED" type="info" />}
                </View>
                {index < Math.min(directoryOptions.length, directoryList.visibleCount) - 1 && (
                  <View style={styles.divider} />
                )}
              </TouchableOpacity>
            ))}
            <LoadMoreRow
              visibleCount={directoryList.visibleCount}
              totalCount={directoryList.totalCount}
              onPress={directoryList.showMore}
            />
          </GlassPanel>
        ) : null}
          </>
        ) : null}

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          4. AGENT PROVIDER
        </Text>
        <View style={styles.providerRow}>
          {EFFORT_PROVIDERS.map(item => {
            const active = provider === item;
            const enabled = availability[item];
            return (
              <TouchableOpacity
                key={item}
                activeOpacity={0.75}
                disabled={!enabled}
                onPress={() => {
                  setProvider(item);
                  // Effort levels + model ids differ per provider. Reset both so
                  // we never forward a level/model the newly-selected agent
                  // doesn't support.
                  setEffort('');
                  setModel('');
                }}
                style={[
                  styles.providerButton,
                  {
                    borderRadius: theme.borderRadius.full,
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(86, 156, 214, 0.12)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : 'transparent',
                    opacity: enabled ? 1 : 0.35,
                  },
                ]}>
                <IconBadge
                  name={item === 'codex' ? 'code' : 'agent'}
                  tone={active ? 'primary' : 'neutral'}
                  size={30}
                  iconSize={15}
                  filled={active}
                />
                <Text
                  style={[
                    theme.typography.labelSm,
                    {
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                    },
                  ]}>
                  {providerLabel(item)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {noProviderAvailable ? (
          <Text
            style={[
              theme.typography.labelSm,
              { color: theme.colors.error, marginTop: 4 },
            ]}>
            {t('createScreen.noProvider')}
          </Text>
        ) : null}

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          5. MODEL
        </Text>
        <TextInput
          value={model}
          onChangeText={setModel}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t('createScreen.modelPlaceholder', {
            suffix: userDefault.model
              ? t('createScreen.modelPlaceholderSuffix', { model: userDefault.model })
              : '',
          })}
          placeholderTextColor={theme.colors.onSurfaceVariant}
          style={[
            theme.typography.bodyMd,
            styles.modelInput,
            {
              color: theme.colors.onSurface,
              borderRadius: theme.borderRadius.md,
              borderColor: isDark
                ? 'rgba(255,255,255,0.08)'
                : theme.colors.outlineVariant,
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.04)'
                : theme.colors.surfaceContainerLow,
            },
          ]}
        />
        <View style={styles.chipRow}>
          {modelOptions.map(preset => {
            const active =
              preset.value === ''
                ? model.trim() === ''
                : model.trim() === preset.value;
            return (
              <TouchableOpacity
                key={preset.label}
                activeOpacity={0.75}
                onPress={() => setModel(preset.value)}
                style={[
                  styles.chip,
                  {
                    borderRadius: theme.borderRadius.full,
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(86, 156, 214, 0.12)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : 'transparent',
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.labelSm,
                    {
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                    },
                  ]}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
            styles.modelHint,
          ]}>
          {t('createScreen.modelHint')}
        </Text>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          6. EFFORT
        </Text>
        <View style={styles.chipRow}>
          {effortOptions.map(preset => {
            const active = effort.trim() === preset.value;
            return (
              <TouchableOpacity
                key={preset.label}
                activeOpacity={0.75}
                onPress={() => setEffort(preset.value)}
                style={[
                  styles.chip,
                  {
                    borderRadius: theme.borderRadius.full,
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(86, 156, 214, 0.12)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : 'transparent',
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.labelSm,
                    {
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                    },
                  ]}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
            styles.modelHint,
          ]}>
          {provider === 'codex'
            ? t('createScreen.effortHintCodex')
            : provider === 'opencode'
              ? t('createScreen.effortHintOpencode')
              : t('createScreen.effortHintClaude')}
        </Text>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          7. PERMISSIONS
        </Text>
        <Text
          style={[
            theme.typography.labelSm,
            { color: theme.colors.onSurfaceVariant, marginBottom: 6 },
          ]}>
          {t('createScreen.permissions.approvalLabel')}
        </Text>
        <View style={styles.chipRow}>
          {APPROVAL_OPTIONS.map(choice => {
            const active = approval === choice;
            return (
              <TouchableOpacity
                key={choice}
                testID={`approval-chip-${choice}`}
                activeOpacity={0.75}
                onPress={() => chooseApproval(choice)}
                style={[
                  styles.chip,
                  {
                    borderRadius: theme.borderRadius.full,
                    borderColor: active
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(86, 156, 214, 0.12)'
                        : 'rgba(0, 81, 174, 0.08)'
                      : 'transparent',
                  },
                ]}>
                <Text
                  style={[
                    theme.typography.labelSm,
                    {
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                    },
                  ]}>
                  {t(`createScreen.permissions.approval.${choice}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          style={[
            theme.typography.bodySm,
            { color: theme.colors.onSurfaceVariant },
            styles.modelHint,
          ]}>
          {t(`createScreen.permissions.approval.${approval}Hint`)}
        </Text>

        <Text
          style={[
            theme.typography.labelSm,
            { color: theme.colors.onSurfaceVariant, marginTop: 6, marginBottom: 6 },
          ]}>
          {t('createScreen.permissions.capabilityLabel')}
        </Text>
        <GlassPanel style={styles.optionPanel}>
          {([
            { key: 'read', label: t('createScreen.permissions.capability.read'), value: canRead, onToggle: toggleRead },
            { key: 'modify', label: t('createScreen.permissions.capability.modify'), value: canModify, onToggle: toggleModify },
            { key: 'run', label: t('createScreen.permissions.capability.run'), value: canRun, onToggle: toggleRun },
          ] as const).map((row, index) => {
            return (
              <TouchableOpacity
                key={row.key}
                testID={`cap-${row.key}`}
                disabled={isReadOnly}
                onPress={row.onToggle}>
                <View
                  style={[
                    styles.optionRow,
                    isReadOnly ? { opacity: 0.4 } : null,
                  ]}>
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                    {row.label}
                  </Text>
                  <StatusChip
                    label={row.value ? 'ON' : 'OFF'}
                    type={row.value ? 'success' : 'neutral'}
                  />
                </View>
                {index < 2 && <View style={styles.divider} />}
              </TouchableOpacity>
            );
          })}
        </GlassPanel>

        {/* Port mapping: placeholder, not yet wired. Greyed + non-interactive. */}
        <GlassPanel style={[styles.optionPanel, { marginTop: 10, opacity: 0.4 }]}>
          <View style={styles.optionRow} testID="port-mapping-row">
            <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
              {t('createScreen.permissions.portMapping.title')}
            </Text>
            <StatusChip
              label={t('createScreen.permissions.portMapping.comingSoon')}
              type="neutral"
            />
          </View>
        </GlassPanel>

        <GlassPanel style={styles.reviewCard}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
            READY TO START
          </Text>
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {providerLabel(provider)} will run {project?.name ?? 'device workspace'} on {device.name} inside {directory || '~'}.
          </Text>
        </GlassPanel>

        <GlowButton
          title="START VIBECODING"
          onPress={handleCreate}
          disabled={!device || noProviderAvailable || creating}
          loading={creating}
          style={styles.createButton}
        />
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    marginTop: 18,
    marginBottom: 8,
  },
  rowScroller: {
    gap: 10,
  },
  selectCard: {
    width: 190,
    minHeight: 104,
    borderWidth: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  optionPanel: {
    padding: 0,
  },
  optionRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginHorizontal: 12,
  },
  objectiveInput: {
    minHeight: 110,
    textAlignVertical: 'top',
    borderWidth: 1,
    padding: 12,
  },
  modelInput: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  modelHint: {
    marginTop: 10,
  },
  providerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  providerButton: {
    flex: 1,
    borderWidth: 1,
    minHeight: 42,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  reviewCard: {
    marginTop: 18,
    padding: 12,
    gap: 8,
  },
  createButton: {
    marginTop: 12,
  },
  emptyContainer: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  emptyPanel: {
    padding: 16,
    gap: 10,
  },
  emptyAction: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
  },
});
