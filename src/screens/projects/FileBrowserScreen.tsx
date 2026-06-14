import React, { useEffect, useMemo, useState } from 'react';
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

const parentPathOf = (pathValue: string) => {
  const normalized = pathValue.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return normalized;
  const prefix = normalized.startsWith('/') ? '/' : '';
  return `${prefix}${parts.slice(0, -1).join('/')}`;
};

interface FileErrorMessage {
  title: string;
  detail: string;
  offline: boolean;
}

const humanizeFileError = (error: unknown): FileErrorMessage => {
  const err = error as { code?: string; message?: string } | null;
  const code = err?.code;
  const message = error instanceof Error ? error.message : String(err?.message ?? error ?? '');
  const matches = (value?: string) => Boolean(value && (code === value || message.includes(value as string)));

  if (matches('device_offline')) {
    return {
      title: '桌面 Agent 未连接',
      detail: '电脑端 Agent 当前不在线。请确认 Agent 正在运行并已连接到同一台服务，然后重试。',
      offline: true,
    };
  }
  if (matches('agent_request_timeout')) {
    return {
      title: 'Agent 响应超时',
      detail: '桌面 Agent 未能及时返回文件内容，请稍后重试，或确认 Agent 没有被其他任务占用。',
      offline: true,
    };
  }
  if (matches('project_path_missing')) {
    return {
      title: '项目路径缺失',
      detail: '该项目尚未上报路径。请在设备页执行「扫描项目」，或返回后重新选择项目。',
      offline: false,
    };
  }
  if (matches('project_path_not_authorized')) {
    return {
      title: '路径未授权',
      detail: '请求的目录不在 Agent 授权范围内，请回到项目根目录，或重新扫描设备。',
      offline: false,
    };
  }
  if (matches('project_not_found')) {
    return {
      title: '项目不存在',
      detail: '该项目数据已失效，请返回后重新选择项目。',
      offline: false,
    };
  }
  return {
    title: '无法读取项目文件',
    detail: message || '发生未知错误，请稍后重试。',
    offline: false,
  };
};

export const FileBrowserScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<FileRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const files = useControlCenterStore(state => state.projectFiles);
  const scanResults = useControlCenterStore(state => state.scanResults);
  const loadProjectFiles = useControlCenterStore(state => state.loadProjectFiles);
  const loadProjectFileContent = useControlCenterStore(state => state.loadProjectFileContent);
  const [filter, setFilter] = useState<FileFilter>('all');
  const [currentPath, setCurrentPath] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [readingPath, setReadingPath] = useState('');
  const [error, setError] = useState('');
  const project = projects.find(item => item.id === route.params.projectId);
  const device =
    (project?.deviceId ? devices.find(item => item.id === project.deviceId) : undefined) ??
    devices.find(item => item.id === route.params.deviceId) ??
    devices.find(item => item.projectIds.includes(route.params.projectId));
  const scanResult = scanResults.find(
    item =>
      item.projectId === route.params.projectId &&
      (!device || item.deviceId === device.id),
  );
  const terminalDirectory =
    scanResult?.path ?? project?.path ?? device?.authorizedDirectories[0] ?? '~';
  const effectivePath = currentPath || terminalDirectory;
  const deviceOnline = device?.status === 'online';
  const fileError = useMemo(() => (error ? humanizeFileError(error) : null), [error]);
  const projectFiles = useMemo(
    () =>
      files.filter(item => {
        const matchesProject = item.projectId === route.params.projectId;
        const matchesDirectory = (item.directoryPath ?? terminalDirectory) === effectivePath;
        const matchesFilter = filter === 'all' || item.status === filter;
        return matchesProject && matchesDirectory && matchesFilter;
      }),
    [effectivePath, files, filter, route.params.projectId, terminalDirectory],
  );
  const selectedFile = files.find(
    item => item.projectId === route.params.projectId && item.path === selectedPath,
  );
  const canReadDevice = Boolean(device && device.status === 'online');

  useEffect(() => {
    if (!currentPath && terminalDirectory !== '~') {
      setCurrentPath(terminalDirectory);
    }
  }, [currentPath, terminalDirectory]);

  useEffect(() => {
    if (!project || !canReadDevice || !effectivePath || effectivePath === '~') return;
    let cancelled = false;
    setLoading(true);
    setError('');
    loadProjectFiles(project.id, effectivePath)
      .catch(nextError => {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : 'Unable to load project files.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canReadDevice, effectivePath, loadProjectFiles, project]);

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

  const handleRefresh = async () => {
    if (!device || !effectivePath || effectivePath === '~') return;
    setLoading(true);
    setError('');
    try {
      await loadProjectFiles(project.id, effectivePath);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to load project files.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleOpenFile = async (file: ProjectFileEntry) => {
    if (file.kind === 'folder') {
      setSelectedPath('');
      setCurrentPath(file.path);
      return;
    }

    setSelectedPath(file.path);
    if (file.content !== undefined) return;
    setReadingPath(file.path);
    setError('');
    try {
      await loadProjectFileContent(project.id, file.path);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to read project file.',
      );
    } finally {
      setReadingPath('');
    }
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Files"
        subtitle={project.name}
        onBack={navigation.goBack}
        rightAction={<StatusChip label={loading ? 'LOADING' : `${projectFiles.length} FILES`} type="info" />}
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
          <View
            style={[
              styles.deviceStatusRow,
              {
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.04)'
                  : theme.colors.surfaceContainerLow,
              },
            ]}>
            <IconBadge
              name="device"
              tone={deviceOnline ? 'secondary' : 'neutral'}
              size={28}
              iconSize={15}
            />
            <Text
              numberOfLines={1}
              style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant, flex: 1 }]}>
              {device ? `${device.name} · ${device.os}` : '未绑定设备'}
            </Text>
            <StatusChip
              label={deviceOnline ? 'AGENT 在线' : device ? 'AGENT 离线' : '无设备'}
              type={deviceOnline ? 'success' : 'neutral'}
            />
          </View>
          <View style={styles.pathRow}>
            <Text
              numberOfLines={1}
              style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
              {effectivePath}
            </Text>
            {effectivePath !== terminalDirectory ? (
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => {
                  setSelectedPath('');
                  setCurrentPath(parentPathOf(effectivePath));
                }}
                style={[
                  styles.upButton,
                  {
                    borderColor: theme.colors.outlineVariant,
                    borderRadius: theme.borderRadius.full,
                  },
                ]}>
                <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
                  UP
                </Text>
              </TouchableOpacity>
            ) : null}
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
              title={loading ? 'LOADING' : 'REFRESH'}
              onPress={handleRefresh}
              disabled={!device || !canReadDevice || loading}
              variant="outline"
              style={styles.secondaryAction}
            />
            {device ? (
              <GlowButton
                title="SCAN"
                onPress={() => navigation.navigate('ProjectScan', { deviceId: device.id })}
                variant="outline"
                style={styles.secondaryAction}
              />
            ) : null}
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

        {fileError ? (
          <GlassPanel style={styles.errorPanel}>
            <Text
              style={[
                theme.typography.titleMd,
                { color: fileError.offline ? theme.colors.tertiary : theme.colors.error },
              ]}>
              {fileError.title}
            </Text>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              {fileError.detail}
            </Text>
            <View style={styles.errorActions}>
              <GlowButton
                title={loading ? '加载中' : '重新加载'}
                onPress={handleRefresh}
                disabled={!device || !deviceOnline || loading}
                variant="primary"
                style={styles.emptyAction}
              />
              {device ? (
                <GlowButton
                  title="扫描设备"
                  onPress={() => navigation.navigate('ProjectScan', { deviceId: device.id })}
                  variant="outline"
                  style={styles.emptyAction}
                />
              ) : null}
            </View>
          </GlassPanel>
        ) : null}

        {projectFiles.map(file => (
          <TouchableOpacity
            key={file.id}
            activeOpacity={0.78}
            onPress={() => handleOpenFile(file)}>
            <GlassPanel style={styles.fileCard}>
            <View style={styles.fileTop}>
              <IconBadge
                name={file.kind === 'folder' ? 'project' : file.status === 'deleted' ? 'warning' : 'code'}
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
                  {file.kind === 'folder' ? `${file.name}/` : file.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                  {file.path}
                </Text>
              </View>
              <StatusChip
                label={
                  readingPath === file.path
                    ? 'READING'
                    : file.kind === 'folder'
                    ? 'DIR'
                    : file.status.toUpperCase()
                }
                type={file.kind === 'folder' ? 'info' : statusType[file.status]}
              />
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
          </TouchableOpacity>
        ))}
        {selectedFile?.content !== undefined ? (
          <GlassPanel style={styles.previewPanel}>
            <View style={styles.previewHeader}>
              <View style={styles.previewTitle}>
                <Text
                  numberOfLines={1}
                  style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                  {selectedFile.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                  {selectedFile.path}
                </Text>
              </View>
              <StatusChip
                label={selectedFile.truncated ? 'TRUNCATED' : selectedFile.encoding ?? 'utf8'}
                type={selectedFile.truncated ? 'warning' : 'neutral'}
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={[theme.typography.codeSm, styles.fileContent, { color: theme.colors.onSurface }]}>
                {selectedFile.encoding === 'base64'
                  ? '[base64 content returned by Agent]'
                  : selectedFile.content}
              </Text>
            </ScrollView>
          </GlassPanel>
        ) : null}
        {!projectFiles.length ? (
          <GlassPanel style={styles.emptyPanel}>
            <IconBadge
              name="device"
              tone={deviceOnline ? 'neutral' : 'error'}
              size={42}
              iconSize={21}
            />
            <View style={styles.emptyCopy}>
              <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                {loading
                  ? '正在从桌面 Agent 加载文件…'
                  : !device
                  ? '该任务尚未绑定设备'
                  : !deviceOnline
                  ? '桌面 Agent 当前离线'
                  : '暂无文件，点击下方刷新从 Agent 获取'}
              </Text>
              <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                {!device
                  ? '请返回设备页，先绑定设备并为该项目选择设备。'
                  : !deviceOnline
                  ? '平台已知该项目路径，但电脑端 Agent 未保持连接。请确认 Agent 正在运行并在线后重试，或在此打开终端 / 扫描设备。'
                  : '平台已知该项目路径。点击刷新可向桌面 Agent 请求文件列表，也可以在此打开终端或运行扫描以刷新项目元数据。'}
              </Text>
              <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                {effectivePath}
              </Text>
            </View>
            <View style={styles.emptyActions}>
              <GlowButton
                title={loading ? 'LOADING' : 'REFRESH FILES'}
                onPress={handleRefresh}
                disabled={!device || !canReadDevice || loading}
                variant="primary"
                style={styles.emptyAction}
              />
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
                variant="outline"
                style={styles.emptyAction}
              />
              {device ? (
                <GlowButton
                  title="SCAN DEVICE"
                  onPress={() => navigation.navigate('ProjectScan', { deviceId: device.id })}
                  variant="outline"
                  style={styles.emptyAction}
                />
              ) : null}
            </View>
          </GlassPanel>
        ) : null}
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
  deviceStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  pathRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  upButton: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  primaryAction: {
    flex: 1,
    minWidth: 136,
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
  errorPanel: {
    padding: 12,
    marginBottom: 10,
    gap: 6,
  },
  previewPanel: {
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previewTitle: {
    flex: 1,
    gap: 3,
  },
  fileContent: {
    minWidth: 280,
  },
  fact: {
    flex: 1,
    gap: 3,
  },
  emptyPanel: {
    padding: 14,
    gap: 12,
  },
  emptyCopy: {
    gap: 6,
  },
  emptyActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  emptyAction: {
    flex: 1,
    minWidth: 132,
    paddingHorizontal: 12,
  },
});
