import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { IconBadge } from '../../components/visual/IconBadge';
import { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import {
  ProjectFileEntry,
  useControlCenterStore,
} from '../../store/controlCenterStore';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type FileRoute = RouteProp<RootStackParamList, 'FileBrowser'>;
type FileFilter = 'all' | ProjectFileEntry['status'];

const filters: Array<{ label: string; value: FileFilter }> = [
  { label: 'ALL', value: 'all' },
  { label: 'MODIFIED', value: 'modified' },
  { label: 'ADDED', value: 'added' },
  { label: 'CLEAN', value: 'clean' },
];

const statusType: Record<
  ProjectFileEntry['status'],
  'success' | 'warning' | 'error' | 'neutral' | 'info'
> = {
  clean: 'neutral',
  modified: 'warning',
  added: 'success',
  deleted: 'error',
};

export const FileBrowserScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<FileRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const files = useControlCenterStore(state => state.projectFiles);
  const scanResults = useControlCenterStore(state => state.scanResults);
  const [filter, setFilter] = useState<FileFilter>('all');
  const project = projects.find(item => item.id === route.params.projectId);
  const device =
    devices.find(item => item.id === route.params.deviceId) ??
    devices.find(item => item.projectIds.includes(route.params.projectId));
  const scanResult = scanResults.find(
    item =>
      item.projectId === route.params.projectId &&
      (!device || item.deviceId === device.id),
  );
  const projectFiles = useMemo(
    () =>
      files.filter(item => {
        const matchesProject = item.projectId === route.params.projectId;
        const matchesFilter = filter === 'all' || item.status === filter;
        return matchesProject && matchesFilter;
      }),
    [files, filter, route.params.projectId],
  );

  if (!project) {
    return (
      <SafeAreaWrapper>
        <TopAppBar
          title="Files"
          subtitle="PROJECT NOT FOUND"
          onBack={navigation.goBack}
        />
      </SafeAreaWrapper>
    );
  }

  const terminalDirectory =
    scanResult?.path ?? device?.authorizedDirectories[0] ?? project.name;

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Files"
        subtitle={project.name}
        onBack={navigation.goBack}
        rightAction={<StatusChip label={`${projectFiles.length} FILES`} type="info" />}
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <GlassPanel style={styles.hero}>
          <View style={styles.heroTop}>
            <IconBadge name="project" tone="primary" size={50} iconSize={25} filled />
            <View style={styles.heroCopy}>
              <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]}>
                {project.name}
              </Text>
              <Text
                numberOfLines={1}
                style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                {terminalDirectory}
              </Text>
            </View>
            <StatusChip label={project.branch} type="info" />
          </View>
          <View style={styles.actionRow}>
            <GlowButton
              title="OPEN TERMINAL"
              onPress={() =>
                device &&
                navigation.navigate('DeviceTerminal', {
                  deviceId: device.id,
                  directory: terminalDirectory,
                })
              }
              disabled={!device}
              variant="primary"
              style={styles.primaryAction}
            />
            <GlowButton
              title="AGENT"
              onPress={() =>
                navigation.navigate('AgentSessions', {
                  deviceId: device?.id,
                  projectId: project.id,
                })
              }
              variant="outline"
              style={styles.secondaryAction}
            />
          </View>
        </GlassPanel>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}>
          {filters.map(item => {
            const active = item.value === filter;
            return (
              <TouchableOpacity
                key={item.value}
                activeOpacity={0.75}
                onPress={() => setFilter(item.value)}
                style={[
                  styles.filterChip,
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
                <Text
                  style={[
                    theme.typography.labelSm,
                    {
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                    },
                  ]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {projectFiles.map(file => (
          <GlassPanel key={file.id} style={styles.fileCard}>
            <View style={styles.fileTop}>
              <IconBadge
                name={file.status === 'deleted' ? 'warning' : 'code'}
                tone={
                  file.status === 'modified'
                    ? 'tertiary'
                    : file.status === 'added'
                    ? 'secondary'
                    : file.status === 'deleted'
                    ? 'error'
                    : 'neutral'
                }
                size={40}
                iconSize={20}
              />
              <View style={styles.fileCopy}>
                <Text
                  numberOfLines={1}
                  style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                  {file.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                  {file.path}
                </Text>
              </View>
              <StatusChip label={file.status.toUpperCase()} type={statusType[file.status]} />
            </View>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              {file.summary}
            </Text>
            <View style={styles.fileFacts}>
              <Fact label="LANG" value={file.language} />
              <Fact label="SIZE" value={file.size} />
              <Fact label="TOUCHED" value={file.lastTouched} />
            </View>
          </GlassPanel>
        ))}
      </ScrollView>
    </SafeAreaWrapper>
  );
};

interface FactProps {
  label: string;
  value: string;
}

const Fact: React.FC<FactProps> = ({ label, value }) => {
  const { theme } = useTheme();

  return (
    <View style={styles.fact}>
      <Text style={[theme.typography.labelCaps, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={[theme.typography.codeSm, { color: theme.colors.onSurface }]}>
        {value}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  hero: {
    padding: 14,
    gap: 12,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroCopy: {
    flex: 1,
    gap: 3,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryAction: {
    flex: 1,
  },
  secondaryAction: {
    minWidth: 94,
  },
  filters: {
    gap: 8,
    paddingTop: 12,
    paddingBottom: 10,
  },
  filterChip: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  fileCard: {
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  fileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fileCopy: {
    flex: 1,
    gap: 3,
  },
  fileFacts: {
    flexDirection: 'row',
    gap: 8,
  },
  fact: {
    flex: 1,
    gap: 3,
  },
});
