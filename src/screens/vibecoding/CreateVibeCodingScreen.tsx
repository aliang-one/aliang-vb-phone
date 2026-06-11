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

export const CreateVibeCodingScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<CreateRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const startAgentSession = useControlCenterStore(state => state.startAgentSession);
  const initialDeviceId = route.params?.deviceId ?? devices[0].id;
  const initialProjectId =
    route.params?.projectId ??
    devices.find(device => device.id === initialDeviceId)?.projectIds[0] ??
    projects[0].id;

  const [deviceId, setDeviceId] = useState(initialDeviceId);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [provider, setProvider] = useState<AgentProvider>('codex');
  const device = devices.find(item => item.id === deviceId) ?? devices[0];
  const project = projects.find(item => item.id === projectId) ?? projects[0];
  const [directory, setDirectory] = useState(device.authorizedDirectories[0]);
  const [objective, setObjective] = useState(
    'Polish the mobile command center UI and make active VibeCoding sessions easier to control.',
  );
  const [minutes, setMinutes] = useState(60);
  const [selectedPermissions, setSelectedPermissions] = useState(permissions);

  const availableProjects = useMemo(
    () => projects.filter(item => device.projectIds.includes(item.id)),
    [device.projectIds, projects],
  );

  const togglePermission = (permission: string) => {
    setSelectedPermissions(current =>
      current.includes(permission)
        ? current.filter(item => item !== permission)
        : [...current, permission],
    );
  };

  const handleCreate = () => {
    const sessionId = startAgentSession({
      deviceId: device.id,
      projectId: project.id,
      directory,
      provider,
      objective: objective.trim(),
      timeLimitMinutes: minutes,
    });
    navigation.replace('VibeCodingSession', { sessionId });
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Create VibeCoding"
        subtitle="DEVICE / DIRECTORY / RUNTIME"
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
          {devices.map(item => {
            const active = item.id === deviceId;
            return (
              <TouchableOpacity
                key={item.id}
                onPress={() => {
                  setDeviceId(item.id);
                  setProjectId(item.projectIds[0] ?? projectId);
                  setDirectory(item.authorizedDirectories[0]);
                }}
                style={[
                  styles.selectCard,
                  {
                    borderRadius: theme.borderRadius.md,
                    borderColor: active ? theme.colors.primary : theme.colors.outlineVariant,
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(0, 209, 255, 0.1)'
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

        <Text
          style={[
            theme.typography.labelCaps,
            { color: theme.colors.onSurfaceVariant },
            styles.sectionTitle,
          ]}>
          2. PROJECT
        </Text>
        <GlassPanel style={styles.optionPanel}>
          {availableProjects.map((item, index) => (
            <TouchableOpacity key={item.id} onPress={() => setProjectId(item.id)}>
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
                  label={item.id === project.id ? 'SELECTED' : item.status.toUpperCase()}
                  type={item.id === project.id ? 'info' : 'neutral'}
                />
              </View>
              {index < availableProjects.length - 1 && <View style={styles.divider} />}
            </TouchableOpacity>
          ))}
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
          {device.authorizedDirectories.map((item, index) => (
            <TouchableOpacity key={item} onPress={() => setDirectory(item)}>
              <View style={styles.optionRow}>
                <Text style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
                  {item}
                </Text>
                {directory === item && <StatusChip label="SELECTED" type="info" />}
              </View>
              {index < device.authorizedDirectories.length - 1 && (
                <View style={styles.divider} />
              )}
            </TouchableOpacity>
          ))}
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
                        ? 'rgba(0, 209, 255, 0.12)'
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
          5. OBJECTIVE
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
          6. RUNTIME
        </Text>
        <LimitStepper
          label="Runtime"
          value={`${minutes}m`}
          onMinus={() => setMinutes(Math.max(15, minutes - 15))}
          onPlus={() => setMinutes(minutes + 15)}
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
            {providerLabels[provider]} will run {project.name} on {device.name} inside {directory}.
          </Text>
        </GlassPanel>

        <GlowButton
          title="START VIBECODING"
          onPress={handleCreate}
          disabled={!objective.trim() || selectedPermissions.length === 0}
          style={styles.createButton}
        />
      </ScrollView>
    </SafeAreaWrapper>
  );
};

interface LimitStepperProps {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
}

const LimitStepper: React.FC<LimitStepperProps> = ({
  label,
  value,
  onMinus,
  onPlus,
}) => {
  const { theme } = useTheme();

  return (
    <GlassPanel style={styles.limitCard}>
      <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
        {label.toUpperCase()}
      </Text>
      <View style={styles.stepperRow}>
        <TouchableOpacity onPress={onMinus} style={styles.stepperButton}>
          <Text style={[theme.typography.titleMd, { color: theme.colors.primary }]}>-</Text>
        </TouchableOpacity>
        <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
          {value}
        </Text>
        <TouchableOpacity onPress={onPlus} style={styles.stepperButton}>
          <Text style={[theme.typography.titleMd, { color: theme.colors.primary }]}>+</Text>
        </TouchableOpacity>
      </View>
    </GlassPanel>
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
  limitCard: {
    padding: 12,
    gap: 12,
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepperButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewCard: {
    marginTop: 18,
    padding: 12,
    gap: 8,
  },
  createButton: {
    marginTop: 12,
  },
});
