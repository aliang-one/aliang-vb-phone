import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { IconBadge, IconName } from '../../components/visual/IconBadge';
import { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import {
  ProjectFileEntry,
  useControlCenterStore,
} from '../../store/controlCenterStore';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { BottomSheet } from '../../components/shared/BottomSheet';
import { CodeHighlight } from '../../components/shared/CodeHighlight';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { describeDeviceError } from '../../utils/deviceError';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type FileRoute = RouteProp<RootStackParamList, 'FileBrowser'>;
type FileFilter = 'all' | ProjectFileEntry['status'];

const filters: Array<{ label: string; value: FileFilter }> = [
  { label: 'ALL', value: 'all' },
  { label: 'MODIFIED', value: 'modified' },
  { label: 'ADDED', value: 'added' },
  { label: 'CLEAN', value: 'clean' },
];

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
  // device_offline / agent_request_timeout 等「Agent 不可达」错误走公共翻译，
  // 与终端页、扫描页口径一致。
  const deviceMessage = describeDeviceError(error);
  if (deviceMessage) {
    return deviceMessage;
  }
  const err = error as { code?: string; message?: string } | null;
  const code = err?.code;
  const message = error instanceof Error ? error.message : String(err?.message ?? error ?? '');
  const matches = (value?: string) => Boolean(value && (code === value || message.includes(value as string)));

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
  // Inline folder expansion (tree-style unfold). A folder row still navigates
  // into the folder when tapped; its right-side chevron toggles expansion so
  // the folder's children render indented beneath it without leaving the page.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [loadedDirs, setLoadedDirs] = useState<Set<string>>(new Set());
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
      }).sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
        return left.name.localeCompare(right.name);
      }),
    [effectivePath, files, filter, route.params.projectId, terminalDirectory],
  );
  const fileList = useIncrementalList(projectFiles, {
    initialCount: 40,
    step: 60,
    resetKey: `${route.params.projectId}:${effectivePath}:${filter}`,
  });
  // Flatten the visible directory into a depth-tagged row list, interleaving
  // inline-expanded children beneath their folder. Top-level pagination
  // (fileList) is preserved; an expanded folder's children render fully.
  const flatRows = useMemo(() => {
    const projectId = route.params.projectId;
    const matchesFilter = (item: ProjectFileEntry) =>
      filter === 'all' || item.status === filter;
    const sortEntries = (items: ProjectFileEntry[]) =>
      items
        .slice()
        .sort((left, right) =>
          left.kind !== right.kind
            ? left.kind === 'folder'
              ? -1
              : 1
            : left.name.localeCompare(right.name),
        );
    const childrenOf = (dirPath: string) =>
      files.filter(
        item => item.projectId === projectId && item.directoryPath === dirPath,
      );
    type FlatRow =
      | { kind: 'entry'; file: ProjectFileEntry; depth: number }
      | { kind: 'empty'; depth: number; key: string };
    const rows: FlatRow[] = [];
    const walk = (dirPath: string, depth: number) => {
      const kids = childrenOf(dirPath);
      if (!kids.length && loadedDirs.has(dirPath)) {
        rows.push({ kind: 'empty', depth, key: `empty:${dirPath}` });
        return;
      }
      sortEntries(kids)
        .filter(matchesFilter)
        .forEach(child => {
          rows.push({ kind: 'entry', file: child, depth });
          if (child.kind === 'folder' && expandedPaths.has(child.path)) {
            walk(child.path, depth + 1);
          }
        });
    };
    sortEntries(fileList.visibleItems).forEach(top => {
      rows.push({ kind: 'entry', file: top, depth: 0 });
      if (top.kind === 'folder' && expandedPaths.has(top.path)) {
        walk(top.path, 1);
      }
    });
    return rows;
  }, [fileList.visibleItems, files, filter, expandedPaths, loadedDirs, route.params.projectId]);
  const selectedFile = files.find(
    item => item.projectId === route.params.projectId && item.path === selectedPath,
  );
  // The file content sheet reads from the most recently opened file so its
  // body stays visible while the dismiss animation runs — selectedPath clears
  // the instant the user closes, which would otherwise blank the sheet before
  // it finishes sliding down.
  const lastFileRef = useRef<ProjectFileEntry | undefined>(undefined);
  if (selectedFile) {
    lastFileRef.current = selectedFile;
  }
  const sheetFile = selectedFile ?? lastFileRef.current;
  const canReadDevice = Boolean(device && device.status === 'online');
  const inSubfolder = effectivePath !== terminalDirectory;

  useEffect(() => {
    if (!currentPath && terminalDirectory !== '~') {
      setCurrentPath(terminalDirectory);
    }
  }, [currentPath, terminalDirectory]);

  // Navigating into/out of a directory starts from a collapsed tree — stale
  // expanded paths would reference folders no longer in the current view.
  useEffect(() => {
    setExpandedPaths(new Set());
    setLoadingDirs(new Set());
    setLoadedDirs(new Set());
  }, [effectivePath]);

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
      await loadProjectFiles(project.id, effectivePath, { force: true });
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

    if (file.previewBlocked) {
      setSelectedPath(file.path);
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

  const toggleExpand = async (folder: ProjectFileEntry) => {
    const dirPath = folder.path;
    if (expandedPaths.has(dirPath)) {
      setExpandedPaths(prev => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
      return;
    }
    setExpandedPaths(prev => {
      const next = new Set(prev);
      next.add(dirPath);
      return next;
    });
    // Skip the network round-trip when offline or when this folder's children
    // are already resident in the store (cache hit from a prior navigation).
    if (!canReadDevice || loadedDirs.has(dirPath)) return;
    setLoadingDirs(prev => {
      const next = new Set(prev);
      next.add(dirPath);
      return next;
    });
    try {
      await loadProjectFiles(project.id, dirPath);
      setLoadedDirs(prev => {
        const next = new Set(prev);
        next.add(dirPath);
        return next;
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to load folder contents.',
      );
      // Roll back the expansion so a failed fetch doesn't leave a stuck-open
      // empty branch.
      setExpandedPaths(prev => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    } finally {
      setLoadingDirs(prev => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    }
  };

  const goUp = () => {
    setSelectedPath('');
    setCurrentPath(parentPathOf(effectivePath));
  };

  // Body of the file-content bottom sheet: loading spinner, blocked-file
  // notice, or the scrollable text. Reads from sheetFile so the content
  // persists during the close animation.
  const renderSheetBody = () => {
    const file = sheetFile;
    if (!file) {
      return null;
    }
    if (readingPath === file.path) {
      return (
        <View style={styles.sheetLoading}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant, marginTop: 10 },
            ]}>
            正在读取文件…
          </Text>
        </View>
      );
    }
    if (file.previewBlocked) {
      return (
        <View style={styles.sheetBlocked}>
          <IconBadge
            name="warning"
            tone={file.previewBlocked.reason === 'binary' ? 'tertiary' : 'error'}
            size={40}
            iconSize={20}
          />
          <Text
            style={[
              theme.typography.titleMd,
              { color: theme.colors.onSurface, textAlign: 'center', marginTop: 10 },
            ]}>
            {file.previewBlocked.reason === 'binary'
              ? '二进制文件，无法预览'
              : '文件过大，未自动打开'}
          </Text>
          <Text
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 6 },
            ]}>
            {file.previewBlocked.reason === 'binary'
              ? '该文件是二进制内容，不适合在手机端预览。'
              : '该文件超过 1 MB，预览会截断且占用大量内存。'}
          </Text>
          <GlowButton
            title="在终端打开"
            onPress={() =>
              device &&
              navigation.navigate('DeviceTerminal', {
                deviceId: device.id,
                directory: parentPathOf(file.path),
              })
            }
            disabled={!device}
            variant="primary"
            style={styles.sheetBlockedAction}
          />
        </View>
      );
    }
    if (file.content !== undefined) {
      return (
        <ScrollView
          style={styles.sheetContentScroll}
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <CodeHighlight
              style={theme.typography.codeSm}
              code={
                file.encoding === 'base64'
                  ? '[base64 content returned by Agent]'
                  : file.content
              }
              language={file.encoding === 'base64' ? undefined : file.language}
              filename={file.encoding === 'base64' ? undefined : file.name}
            />
          </ScrollView>
        </ScrollView>
      );
    }
    return null;
  };

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title="Files"
        subtitle={project.name}
        onBack={navigation.goBack}
        rightAction={
          <StatusChip
            label={loading ? 'LOADING' : deviceOnline ? 'ONLINE' : 'OFFLINE'}
            type={loading ? 'info' : deviceOnline ? 'success' : 'neutral'}
          />
        }
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Project identity + device status + action toolbar */}
        <GlassPanel style={styles.hero}>
          <View style={styles.heroTop}>
            <IconBadge name="project" tone="primary" size={48} iconSize={24} filled />
            <View style={styles.heroCopy}>
              <Text style={[theme.typography.titleLg, { color: theme.colors.onSurface }]} numberOfLines={1}>
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
              size={26}
              iconSize={14}
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

          <View
            style={[
              styles.toolbar,
              {
                borderColor: isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant,
              },
            ]}>
            <ToolCell
              icon="terminal"
              label="TERMINAL"
              tone="primary"
              filled
              highlight
              disabled={!device}
              onPress={() =>
                device &&
                navigation.navigate('DeviceTerminal', {
                  deviceId: device.id,
                  directory: terminalDirectory,
                })
              }
            />
            <ToolCell
              icon="refresh"
              label="REFRESH"
              tone="primary"
              divider
              loading={loading}
              disabled={!device || !canReadDevice || loading}
              onPress={handleRefresh}
            />
            {device ? (
              <ToolCell
                icon="scan"
                label="SCAN"
                tone="primary"
                divider
                onPress={() => navigation.navigate('ProjectScan', { deviceId: device.id })}
              />
            ) : null}
            <ToolCell
              icon="agent"
              label="AGENT"
              tone="primary"
              divider
              onPress={() =>
                navigation.navigate('AgentSessions', {
                  deviceId: device?.id,
                  projectId: project.id,
                })
              }
            />
          </View>
        </GlassPanel>

        {/* File browser window */}
        <GlassPanel style={styles.browserWindow}>
          {/* Title bar: up navigation + breadcrumb path + item count */}
          <View
            style={[
              styles.windowTitlebar,
              {
                borderBottomColor: isDark
                  ? 'rgba(255,255,255,0.08)'
                  : theme.colors.outlineVariant,
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.03)'
                  : theme.colors.surfaceContainerHigh,
              },
            ]}>
            {inSubfolder ? (
              <TouchableOpacity
                activeOpacity={0.6}
                onPress={goUp}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.upButton}>
                <IconBadge
                  name="chevron"
                  tone="primary"
                  size={24}
                  iconSize={15}
                  style={{ transform: [{ rotate: '90deg' }] }}
                />
              </TouchableOpacity>
            ) : null}
            <IconBadge name="project" tone="primary" size={24} iconSize={13} />
            <Text
              numberOfLines={1}
              style={[theme.typography.codeSm, { color: theme.colors.primary, flex: 1 }]}>
              {effectivePath}
            </Text>
            <View
              style={[
                styles.countPill,
                {
                  backgroundColor: isDark
                    ? 'rgba(86,156,214,0.14)'
                    : 'rgba(0,81,174,0.08)',
                },
              ]}>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                {projectFiles.length}
              </Text>
            </View>
          </View>

          {/* Body: error / empty / list */}
          <View style={styles.windowBody}>
            {fileError ? (
              <View style={styles.bodyState}>
                <IconBadge
                  name="warning"
                  tone={fileError.offline ? 'neutral' : 'error'}
                  size={36}
                  iconSize={18}
                />
                <Text
                  style={[
                    theme.typography.titleMd,
                    {
                      color: fileError.offline ? theme.colors.tertiary : theme.colors.error,
                      textAlign: 'center',
                    },
                  ]}>
                  {fileError.title}
                </Text>
                <Text
                  style={[
                    theme.typography.bodySm,
                    { color: theme.colors.onSurfaceVariant, textAlign: 'center' },
                  ]}>
                  {fileError.detail}
                </Text>
                <View style={styles.stateActions}>
                  <GlowButton
                    title={loading ? '加载中' : '重新加载'}
                    onPress={handleRefresh}
                    disabled={!device || !deviceOnline || loading}
                    variant="primary"
                    style={styles.stateAction}
                  />
                  {device ? (
                    <GlowButton
                      title="扫描设备"
                      onPress={() => navigation.navigate('ProjectScan', { deviceId: device.id })}
                      variant="outline"
                      style={styles.stateAction}
                    />
                  ) : null}
                </View>
              </View>
            ) : !projectFiles.length ? (
              <View style={styles.bodyState}>
                <IconBadge
                  name="device"
                  tone={deviceOnline ? 'neutral' : 'error'}
                  size={36}
                  iconSize={18}
                />
                <Text
                  style={[
                    theme.typography.titleMd,
                    { color: theme.colors.onSurface, textAlign: 'center' },
                  ]}>
                  {loading
                    ? '正在从桌面 Agent 加载文件…'
                    : !device
                    ? '该任务尚未绑定设备'
                    : !deviceOnline
                    ? '桌面 Agent 当前离线'
                    : '暂无文件'}
                </Text>
                <Text
                  style={[
                    theme.typography.bodySm,
                    { color: theme.colors.onSurfaceVariant, textAlign: 'center' },
                  ]}>
                  {!device
                    ? '请返回设备页，先绑定设备并为该项目选择设备。'
                    : !deviceOnline
                    ? 'Agent 未保持连接，请确认 Agent 在线后用上方工具条刷新，或打开终端 / 扫描设备。'
                    : '点击上方工具条的 REFRESH 可向桌面 Agent 请求文件列表。'}
                </Text>
              </View>
            ) : (
              <>
                {flatRows.map((row, index) =>
                  row.kind === 'empty' ? (
                    <View
                      key={row.key}
                      style={[styles.emptyChildRow, { paddingLeft: 48 + row.depth * 18 }]}>
                      <Text
                        style={[
                          theme.typography.codeSm,
                          { color: theme.colors.onSurfaceVariant },
                        ]}>
                        空文件夹
                      </Text>
                    </View>
                  ) : (
                    <FileRow
                      key={`entry:${row.depth}:${row.file.id}`}
                      file={row.file}
                      depth={row.depth}
                      reading={readingPath === row.file.path}
                      expanded={expandedPaths.has(row.file.path)}
                      expanding={loadingDirs.has(row.file.path)}
                      onPress={() => handleOpenFile(row.file)}
                      onToggleExpand={() => toggleExpand(row.file)}
                      isLast={index === flatRows.length - 1}
                    />
                  ),
                )}
                <LoadMoreRow
                  visibleCount={fileList.visibleCount}
                  totalCount={fileList.totalCount}
                  onPress={fileList.showMore}
                  label="LOAD MORE FILES"
                />
              </>
            )}
          </View>

          {/* Footer: status filters */}
          <View
            style={[
              styles.windowFooter,
              {
                borderTopColor: isDark
                  ? 'rgba(255,255,255,0.08)'
                  : theme.colors.outlineVariant,
              },
            ]}>
            {filters.map(item => {
              const active = item.value === filter;
              return (
                <TouchableOpacity
                  key={item.value}
                  activeOpacity={0.7}
                  onPress={() => setFilter(item.value)}
                  style={[
                    styles.filterChip,
                    {
                      borderColor: active
                        ? theme.colors.primary
                        : isDark
                        ? 'rgba(255,255,255,0.12)'
                        : theme.colors.outlineVariant,
                      backgroundColor: active
                        ? isDark
                          ? 'rgba(86,156,214,0.14)'
                          : 'rgba(0,81,174,0.08)'
                        : 'transparent',
                    },
                  ]}>
                  <Text
                    style={[
                      theme.typography.labelCaps,
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
          </View>
        </GlassPanel>

        {/* File content — opens in a bottom sheet that slides up from below */}
        <BottomSheet
          open={Boolean(selectedFile)}
          onClose={() => setSelectedPath('')}
          title={sheetFile?.name}
          subtitle={sheetFile?.path}
          badge={
            sheetFile && sheetFile.content !== undefined
              ? {
                  label: sheetFile.truncated ? 'TRUNCATED' : sheetFile.encoding ?? 'utf8',
                  tone: sheetFile.truncated ? 'warning' : 'neutral',
                }
              : undefined
          }>
          {renderSheetBody()}
        </BottomSheet>
      </ScrollView>
    </SafeAreaWrapper>
  );
};

/** Single cell in the hero action toolbar. */
interface ToolCellProps {
  icon: IconName;
  label: string;
  tone: 'primary' | 'neutral';
  filled?: boolean;
  highlight?: boolean;
  divider?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

const ToolCell: React.FC<ToolCellProps> = ({
  icon,
  label,
  tone,
  filled,
  highlight,
  divider,
  loading,
  disabled,
  onPress,
}) => {
  const { theme, isDark } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.6}
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.toolCell,
        {
          borderLeftWidth: divider ? StyleSheet.hairlineWidth : 0,
          borderLeftColor: isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant,
          backgroundColor: highlight
            ? isDark
              ? 'rgba(86,156,214,0.12)'
              : 'rgba(0,81,174,0.06)'
            : 'transparent',
        },
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={theme.colors.primary} />
      ) : (
        <IconBadge
          name={icon}
          tone={disabled ? 'neutral' : tone}
          size={32}
          iconSize={16}
          filled={filled && !disabled}
        />
      )}
      <Text
        numberOfLines={1}
        style={[
          theme.typography.labelCaps,
          {
            marginTop: 6,
            color: disabled
              ? theme.colors.onSurfaceVariant
              : highlight
              ? theme.colors.primary
              : theme.colors.onSurface,
          },
        ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

/** One compact Finder-style row. */
interface FileRowProps {
  file: ProjectFileEntry;
  reading: boolean;
  isLast?: boolean;
  onPress: () => void;
  /** Nesting depth for inline-expanded children (0 = top level). */
  depth?: number;
  /** Inline-expansion affordance for folders: chevron toggles unfold. */
  expanded?: boolean;
  expanding?: boolean;
  onToggleExpand?: () => void;
}

const FileRow: React.FC<FileRowProps> = ({
  file,
  reading,
  isLast,
  onPress,
  depth = 0,
  expanded = false,
  expanding = false,
  onToggleExpand,
}) => {
  const { theme, isDark } = useTheme();
  const isFolder = file.kind === 'folder';
  const tone: 'primary' | 'secondary' | 'tertiary' | 'error' | 'neutral' = isFolder
    ? 'secondary'
    : file.status === 'modified'
    ? 'tertiary'
    : file.status === 'added'
    ? 'secondary'
    : file.status === 'deleted'
    ? 'error'
    : 'neutral';
  const statusColor = isFolder
    ? theme.colors.secondary
    : file.status === 'modified'
    ? theme.colors.tertiary
    : file.status === 'added'
    ? theme.colors.secondary
    : file.status === 'deleted'
    ? theme.colors.error
    : theme.colors.onSurfaceVariant;
  const statusLetter =
    file.status === 'modified' ? 'M' : file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : '';
  const meta = [file.size, file.lastTouched, file.language].filter(Boolean).join(' · ');

  // Shared row chrome: horizontal layout, depth indent for inline-expanded
  // descendants, and the bottom hairline divider between siblings.
  const baseStyle = [
    styles.fileRow,
    { paddingLeft: 10 + depth * 18 },
    !isLast && {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : theme.colors.outlineVariant,
    },
  ];

  if (isFolder) {
    // Folder: the name area and the chevron are SIBLING pressables, not nested.
    // Nesting a TouchableOpacity inside the row's TouchableOpacity can silently
    // swallow the parent's press in some React Native setups, so the folder
    // stops responding to taps. Siblings give each gesture a clean owner:
    // tapping the name navigates into the folder; tapping the chevron unfolds
    // its children inline.
    return (
      <View style={baseStyle}>
        <TouchableOpacity
          activeOpacity={0.65}
          onPress={onPress}
          style={styles.rowMain}>
          <IconBadge name="project" tone={tone} size={30} iconSize={15} />
          <View style={styles.fileRowCopy}>
            <Text
              numberOfLines={1}
              style={[
                theme.typography.labelMd,
                { color: theme.colors.onSurface, fontWeight: '700' },
              ]}>
              {`${file.name}/`}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.5}
          onPress={onToggleExpand}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 6 }}
          style={styles.chevronButton}>
          {expanding ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <IconBadge
              name="chevron"
              tone="neutral"
              size={22}
              iconSize={14}
              // Base chevron points down (v) = expanded; rotate -90deg to a
              // right-pointing caret (>) for the collapsed resting state.
              style={{ transform: [{ rotate: expanded ? '0deg' : '-90deg' }] }}
            />
          )}
        </TouchableOpacity>
      </View>
    );
  }

  // File: the whole row is a single pressable that opens the file preview.
  return (
    <TouchableOpacity activeOpacity={0.65} onPress={onPress} style={baseStyle}>
      <IconBadge name="code" tone={tone} size={28} iconSize={14} />
      <View style={styles.fileRowCopy}>
        <Text
          numberOfLines={1}
          style={[
            theme.typography.labelMd,
            { color: theme.colors.onSurface, fontWeight: '500' },
          ]}>
          {file.name}
        </Text>
        {meta ? (
          <Text numberOfLines={1} style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
            {meta}
          </Text>
        ) : null}
      </View>
      {reading ? (
        <ActivityIndicator size="small" color={theme.colors.primary} />
      ) : (
        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          {statusLetter ? (
            <Text style={[theme.typography.labelCaps, { color: statusColor, fontSize: 10 }]}>
              {statusLetter}
            </Text>
          ) : null}
        </View>
      )}
    </TouchableOpacity>
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
  toolbar: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  toolCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  browserWindow: {
    padding: 0,
    borderRadius: 14,
    overflow: 'hidden',
  },
  windowTitlebar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  upButton: {
    padding: 2,
    marginRight: 2,
  },
  countPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  windowBody: {
    paddingHorizontal: 4,
    paddingVertical: 6,
    minHeight: 120,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  fileRowCopy: {
    flex: 1,
    gap: 2,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chevronButton: {
    padding: 4,
    marginRight: -2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyChildRow: {
    paddingVertical: 8,
  },
  windowFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  filterChip: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9999,
  },
  bodyState: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 28,
  },
  stateActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 6,
    alignSelf: 'stretch',
  },
  stateAction: {
    flex: 1,
    minWidth: 120,
    paddingHorizontal: 12,
  },
  sheetLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheetBlocked: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  sheetBlockedAction: {
    marginTop: 18,
    alignSelf: 'stretch',
  },
  sheetContentScroll: {
    flex: 1,
  },
  sheetContent: {
    padding: 14,
    paddingBottom: 28,
  },
});
