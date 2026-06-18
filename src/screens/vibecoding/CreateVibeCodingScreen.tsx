import React, { useMemo, useState } from 'react';
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

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type CreateRoute = RouteProp<RootStackParamList, 'CreateVibeCoding'>;

const permissions = [
  'Read project files',
  'Modify files in selected directory',
  'Run local commands with approval',
  'Expose preview ports as short links',
];

const providerLabels: Record<AgentProvider, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
};

// Optional model presets. "默认" (value '') leaves it to the agent CLI's own
// default; the rest are concrete names forwarded as --model. Free text in the
// input overrides the chips.
const MODEL_PRESETS: Array<{ label: string; value: string }> = [
  { label: '默认', value: '' },
  { label: 'glm-5.2', value: 'glm-5.2' },
  { label: 'gpt-5.2', value: 'gpt-5.2' },
  { label: 'gpt-5.5', value: 'gpt-5.5' },
  { label: 'claude-sonnet-4-6', value: 'claude-sonnet-4-6' },
];

const uniqueStrings = (items: Array<string | undefined>) =>
  Array.from(new Set(items.filter(Boolean))) as string[];

export const CreateVibeCodingScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<CreateRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const startAgentSession = useControlCenterStore(state => state.startAgentSession);
  const initialDeviceId = route.params?.deviceId ?? devices[0]?.id ?? '';
  const initialProjectId =
    route.params?.projectId ??
    projects.find(project => project.deviceId === initialDeviceId)?.id ??
    devices.find(device => device.id === initialDeviceId)?.projectIds[0] ??
    projects[0]?.id ??
    '';

  const [deviceId, setDeviceId] = useState(initialDeviceId);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [provider, setProvider] = useState<AgentProvider>('codex');
  const [model, setModel] = useState('');
  const device = devices.find(item => item.id === deviceId) ?? devices[0];
  const project = projects.find(item => item.id === projectId) ?? projects[0];
  const [directory, setDirectory] = useState(
    project?.path ?? device?.authorizedDirectories[0] ?? '~',
  );
  const [objective, setObjective] = useState(
    'Polish the mobile command center UI and make active VibeCoding sessions easier to control.',
  );
  const [selectedPermissions, setSelectedPermissions] = useState(permissions);

  const availableProjects = useMemo(
    () =>
      projects.filter(
        item => item.deviceId === device?.id || device?.projectIds.includes(item.id),
      ),
    [device?.id, device?.projectIds, projects],
  );
  const directoryOptions = uniqueStrings([
    project?.path,
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

  const togglePermission = (permission: string) => {
    setSelectedPermissions(current =>
      current.includes(permission)
        ? current.filter(item => item !== permission)
        : [...current, permission],
    );
  };

  const handleCreate = async () => {
    if (!device || !objective.trim()) return;

    const sessionId = await startAgentSession({
      deviceId: device.id,
      projectId: project?.id ?? '',
      directory: directory || project?.path || device.authorizedDirectories[0] || '~',
      provider,
      objective: objective.trim(),
      // '' => omit so the agent uses its own default model (never send a label).
      model: model.trim() || undefined,
    });
    navigation.replace('VibeCodingSession', { sessionId });
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
              还没有注册设备
            </Text>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              先在电脑端启动桌面 Agent，或用扫码绑定已有设备。
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
	                  setProjectId(nextProject?.id ?? projectId);
	                  setDirectory(nextProject?.path ?? item.authorizedDirectories[0] ?? '~');
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
          {availableProjects.length ? (
            <>
          {projectList.visibleItems.map((item, index) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => {
                setProjectId(item.id);
                setDirectory(item.path || directory);
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
                  label={item.id === project?.id ? 'SELECTED' : item.status.toUpperCase()}
                  type={item.id === project?.id ? 'info' : 'neutral'}
                />
              </View>
              {index < projectList.visibleItems.length - 1 && <View style={styles.divider} />}
            </TouchableOpacity>
          ))}
          <LoadMoreRow
            visibleCount={projectList.visibleCount}
            totalCount={projectList.totalCount}
            onPress={projectList.showMore}
          />
          </>
          ) : (
            <View style={styles.optionRow}>
              <View style={styles.optionText}>
                <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                  No project reported
                </Text>
                <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  Use a device directory or scan this computer for projects.
                </Text>
              </View>
              <StatusChip label="DEVICE" type="neutral" />
            </View>
          )}
        </GlassPanel>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          3. DIRECTORY
        </Text>
        <GlassPanel style={styles.optionPanel}>
          {directoryList.visibleItems.map((item, index) => (
            <TouchableOpacity key={item} onPress={() => setDirectory(item)}>
              <View style={styles.optionRow}>
                <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
                  {item}
                </Text>
                {directory === item && <StatusChip label="SELECTED" type="info" />}
              </View>
              {index < directoryList.visibleItems.length - 1 && (
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

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          4. AGENT PROVIDER
        </Text>
        <View style={styles.providerRow}>
          {(['codex', 'claude_code'] as AgentProvider[]).map(item => {
            const active = provider === item;
            return (
              <TouchableOpacity
                key={item}
                activeOpacity={0.75}
                onPress={() => setProvider(item)}
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
                  {providerLabels[item]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

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
          placeholder="留空使用 Agent 默认模型"
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
          {MODEL_PRESETS.map(preset => {
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
          指定模型名后会作为 --model 传给 codex / claude;留空则用 CLI 默认模型。
        </Text>

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          6. OBJECTIVE
        </Text>
        <TextInput
          value={objective}
          onChangeText={setObjective}
          multiline
          placeholder="Describe what the agent should accomplish..."
          placeholderTextColor={theme.colors.onSurfaceVariant}
          style={[
            theme.typography.bodyMd,
            styles.objectiveInput,
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

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          7. PERMISSIONS
        </Text>
        <GlassPanel style={styles.optionPanel}>
          {permissions.map((permission, index) => {
            const active = selectedPermissions.includes(permission);
            return (
              <TouchableOpacity
                key={permission}
                onPress={() => togglePermission(permission)}>
                <View style={styles.optionRow}>
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                    {permission}
                  </Text>
                  <StatusChip
                    label={active ? 'ON' : 'OFF'}
                    type={active ? 'success' : 'neutral'}
                  />
                </View>
                {index < permissions.length - 1 && <View style={styles.divider} />}
              </TouchableOpacity>
            );
          })}
        </GlassPanel>

        <GlassPanel style={styles.reviewCard}>
          <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
            READY TO START
          </Text>
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {providerLabels[provider]} will run {project?.name ?? 'device workspace'} on {device.name} inside {directory || '~'}.
          </Text>
        </GlassPanel>

        <GlowButton
          title="START VIBECODING"
          onPress={handleCreate}
          disabled={!device || !objective.trim() || selectedPermissions.length === 0}
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
