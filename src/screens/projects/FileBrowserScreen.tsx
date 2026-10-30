import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { DeferredMount } from '../../components/shared/DeferredMount';
import { GlassPanel } from '../../components/shared/GlassPanel';
import { GlowButton } from '../../components/shared/GlowButton';
import { StatusChip } from '../../components/shared/StatusChip';
import { IconBadge, IconName } from '../../components/visual/IconBadge';
import { RootStackParamList } from '../../app/navigation/types';
import { useTheme } from '../../theme/useTheme';
import {
  ProjectFileEntry,
  useControlCenterStore,
  useRecentActiveTerminalSessionId,
} from '../../store/controlCenterStore';
import type {
  ActiveDownload,
  FileDownloadPhase,
} from '../../store/types';
import { useToastStore } from '../../store/toastStore';
import { completeProjectFileDownload } from '../../api/projects';
import { saveDownloadedFile } from '../../services/fileDownloadSave';
import { LoadMoreRow } from '../../components/shared/LoadMoreRow';
import { BottomSheet } from '../../components/shared/BottomSheet';
import { FileLongPressMenu } from '../../components/projects/FileLongPressMenu';
import { FileDownloadSheet } from '../../components/projects/FileDownloadSheet';
import { FileTransferSheet } from '../../components/projects/FileTransferSheet';
import { CodeHighlight } from '../../components/shared/CodeHighlight';
import { useIncrementalList } from '../../hooks/useIncrementalList';
import { describeDeviceError } from '../../utils/deviceError';
import { peekVideoVerdict, probeProjectVideo } from '../../services/videoProbe';
import { subscribeVideoPreview, type VideoPreviewHandle } from '../../services/videoPreviewManager';
import { RemoteVideoPlayer } from '../../components/video/RemoteVideoPlayer';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type FileRoute = RouteProp<RootStackParamList, 'FileBrowser'>;
type FileFilter = 'all' | ProjectFileEntry['status'];

const filters: Array<{ labelKey: 'all' | 'modified' | 'added' | 'clean'; value: FileFilter }> = [
  { labelKey: 'all', value: 'all' },
  { labelKey: 'modified', value: 'modified' },
  { labelKey: 'added', value: 'added' },
  { labelKey: 'clean', value: 'clean' },
];

const parentPathOf = (pathValue: string) => {
  const normalized = pathValue.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return normalized;
  const prefix = normalized.startsWith('/') ? '/' : '';
  return `${prefix}${parts.slice(0, -1).join('/')}`;
};

/** Focus-reconcile cooldown for the download status (matches the session screen's silent auto-refresh cadence). */
const DOWNLOAD_RECONCILE_COOLDOWN_MS = 30_000;

/** 回屏静默刷新当前目录的冷却(审计 #4)。 */
const FOCUS_REFRESH_COOLDOWN_MS = 30_000;

/** 「加载完整目录」时向 agent 请求的最大条数(agent 端硬上限 1000)。 */
const FULL_LIST_MAX_ENTRIES = 1000;

/** Everything the ready→save wiring needs from the active download record. */
export interface AutoSaveTarget {
  projectId: string;
  requestId: string;
  filename: string;
  url: string;
}

/**
 * Phase gate + re-entrancy latch for the local-save wiring (Task 18).
 * Auto-save fires only when ALL hold:
 *   - phase === 'ready' — the server pushed a COS presigned GET url;
 *   - active carries BOTH requestId (needed for the /complete ack) and url
 *     (needed for the fetch) — requestId is '' while the start POST is in
 *     flight, and url is absent until ready, so both gates are load-bearing;
 *   - handledRequestId !== this requestId — the once-only latch. The store
 *     already freezes saving/done against WS replays (slice holding logic),
 *     but a React strict-mode double effect invocation re-runs with the SAME
 *     render closure that still holds 'ready'; the ref is the authoritative
 *     guard. Keyed by requestId (not a boolean) so a retry — new POST, new
 *     request_id — auto-saves again.
 */
export function resolveAutoSaveTarget(
  phase: FileDownloadPhase,
  active: ActiveDownload | null,
  handledRequestId: string | null,
): AutoSaveTarget | null {
  if (phase !== 'ready' || !active) return null;
  const { projectId, requestId, filename, url } = active;
  if (!requestId || !url) return null;
  if (handledRequestId === requestId) return null;
  return { projectId, requestId, filename, url };
}

interface FileErrorMessage {
  title: string;
  detail: string;
  offline: boolean;
}

const humanizeFileError = (error: unknown, t: TFunction): FileErrorMessage => {
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
      title: t('fileBrowser.error.pathMissingTitle'),
      detail: t('fileBrowser.error.pathMissingDetail'),
      offline: false,
    };
  }
  if (matches('project_path_not_authorized')) {
    return {
      title: t('fileBrowser.error.pathNotAuthorizedTitle'),
      detail: t('fileBrowser.error.pathNotAuthorizedDetail'),
      offline: false,
    };
  }
  if (matches('project_not_found')) {
    return {
      title: t('fileBrowser.error.projectNotFoundTitle'),
      detail: t('fileBrowser.error.projectNotFoundDetail'),
      offline: false,
    };
  }
  return {
    title: t('fileBrowser.error.genericTitle'),
    detail: message || t('fileBrowser.error.genericDetail'),
    offline: false,
  };
};

export const FileBrowserScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('projects');
  const navigation = useNavigation<Navigation>();
  const route = useRoute<FileRoute>();
  const devices = useControlCenterStore(state => state.devices);
  const projects = useControlCenterStore(state => state.projects);
  const files = useControlCenterStore(state => state.projectFiles);
  const scanResults = useControlCenterStore(state => state.scanResults);
  const loadProjectFiles = useControlCenterStore(state => state.loadProjectFiles);
  const loadProjectFileContent = useControlCenterStore(state => state.loadProjectFileContent);
  const projectFileListTruncated = useControlCenterStore(
    state => state.projectFileListTruncated,
  );
  // Server capability gate (Task 13): the long-press download menu only
  // exists when the server reports file download as configured.
  const downloadEnabled = useControlCenterStore(
    state => state.fileDownloadCapability?.enabled === true,
  );
  // Download save wiring (Task 18): the screen owns the ready→save transition
  // so it survives independent of the sheet's visibility lifecycle.
  const fileDownloadPhase = useControlCenterStore(state => state.fileDownloadPhase);
  const fileDownloadActive = useControlCenterStore(state => state.fileDownloadActive);
  const markSaving = useControlCenterStore(state => state.markSaving);
  const markDone = useControlCenterStore(state => state.markDone);
  const markFailed = useControlCenterStore(state => state.markFailed);
  const show = useToastStore(s => s.show);
  const [filter, setFilter] = useState<FileFilter>('all');
  const [currentPath, setCurrentPath] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [readingPath, setReadingPath] = useState('');
  // 只属于「主目录列表加载」的错误。展开子目录/读取文件内容的失败各自就地
  // 呈现(toast / sheet 内错误卡)——2026-10-28 审计 #2:此前任何一处失败都会
  // 把整棵文件树替换成错误卡,预览 sheet 则只剩空白。
  const [error, setError] = useState('');
  const [sheetError, setSheetError] = useState<{ path: string; message: string } | null>(
    null,
  );
  // 当前目录是否已按最大条数(1000)拉过:决定截断提示行是「加载」还是「到顶了」。
  const [requestedFullList, setRequestedFullList] = useState(false);
  // requestedFullList 的 ref 镜像:回屏静默刷新跑在 useFocusEffect 的闭包里,
  // 不加依赖重挂——刷新必须沿用已请求的条数,否则完整列表被静默打回 200 条。
  const requestedFullListRef = useRef(false);
  // Inline folder expansion (tree-style unfold). A folder row still navigates
  // into the folder when tapped; its right-side chevron toggles expansion so
  // the folder's children render indented beneath it without leaving the page.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  // expandedPaths 的 ref 镜像:回屏静默刷新的 useFocusEffect 闭包不随 state
  // 重挂,用它读取当前展开集,刷新时联动重拉已展开子目录。
  const expandedPathsRef = useRef<Set<string>>(expandedPaths);
  useEffect(() => {
    expandedPathsRef.current = expandedPaths;
  }, [expandedPaths]);
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [loadedDirs, setLoadedDirs] = useState<Set<string>>(new Set());
  // Long-press menu on file rows → download flow. `downloadFile` is the
  // hand-off slot the download sheet (Task 16) consumes to start the download.
  const [menuFile, setMenuFile] = useState<ProjectFileEntry | null>(null);
  const [downloadFile, setDownloadFile] = useState<ProjectFileEntry | null>(null);
  // 正在做 64KB 视频头探针的文件路径('' = 空闲);结论存 videoProbe 模块缓存。
  const [videoProbePath, setVideoProbePath] = useState('');
  // 在线播放会话:正在准备(probe 后 COS 推送)的文件与进度文案。
  const [previewPreparing, setPreviewPreparing] = useState<{ path: string; label: string } | null>(null);
  // 已就绪、正在播放 COS 直链的文件路径与直链本体('' = 未在播放)。
  const [previewPlayingPath, setPreviewPlayingPath] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const previewHandleRef = useRef<VideoPreviewHandle | null>(null);

  /**
   * 在线播放:经模块级 preview 管理器拿 COS 直链,交给 RemoteVideoPlayer。
   * 管理器按 (project,path) 复用会话——返回重进同一视频直接回放最新进度或
   * 秒附已就绪直链;屏幕卸载/关 sheet 只 detach,绝不撤在飞上传。
   */
  const handlePlayVideo = async (file: ProjectFileEntry) => {
    if (!project || previewPreparing || previewPlayingPath) return;
    previewHandleRef.current?.detach(); // 换文件重订阅前摘掉旧监听
    setPreviewPreparing({ path: file.path, label: t('fileBrowser.video.starting') });
    previewHandleRef.current = subscribeVideoPreview(project.id, file.path, {
      onPhase: next => {
        if (next.kind === 'ready') {
          setPreviewPreparing(null);
          setPreviewUrl(next.url);
          setPreviewPlayingPath(file.path);
          return;
        }
        setPreviewPreparing({
          path: file.path,
          label:
            next.kind === 'uploading'
              ? t('fileBrowser.video.uploadProgress', { percent: next.percent })
              : t('fileBrowser.video.starting'),
        });
      },
      onError: () => {
        setPreviewPreparing(null);
        show(t('fileBrowser.video.playFailedToast'));
        // 停在视频卡:保留「下载观看」兜底
      },
    });
  };

  const cancelPreviewSession = () => {
    previewHandleRef.current?.cancel();
    previewHandleRef.current = null;
    setPreviewPreparing(null);
  };

  // 卸载只 detach:在飞上传后台继续,返回重进由管理器秒附(server 幂等兜底)。
  // 旧版此处 cancel(撤上传删对象)是「二次下载」体验的一半病灶,已删。
  useEffect(
    () => () => {
      previewHandleRef.current?.detach();
      previewHandleRef.current = null;
    },
    [],
  );
  // Device-transfer sheet hand-off (long-press → 同步到别的设备). Same shape
  // as downloadFile: the sheet is mounted while a run is live regardless.
  const [transferFile, setTransferFile] = useState<ProjectFileEntry | null>(null);
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
  // attach 优先：带上设备当前 active 终端，进屏即恢复而非另开新会话。
  const activeTerminalId = useRecentActiveTerminalSessionId(device?.id);
  const effectivePath = currentPath || terminalDirectory;
  const deviceOnline = device?.status === 'online';
  const openChangeReview = useCallback(() => {
    navigation.navigate('ChangeReview', {
      projectId: route.params.projectId,
      deviceId: device?.id,
    });
  }, [navigation, route.params.projectId, device?.id]);
  const fileError = useMemo(() => (error ? humanizeFileError(error, t) : null), [error, t]);
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
  // 列表级截断(agent max_entries 上限):尾部提示行据此出现(审计 #1)。
  const listTruncated =
    projectFileListTruncated[`${route.params.projectId}:${effectivePath}`] === true;
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
    setRequestedFullList(false);
    requestedFullListRef.current = false;
    setSheetError(null);
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
              : t('fileBrowser.error.loadFailed'),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canReadDevice, effectivePath, loadProjectFiles, project, t]);

  // --- Download save wiring (Task 18): ready → local save → done/failed ---
  // The store phase is the primary gate (markSaving flips it off 'ready'
  // synchronously, so a WS replay re-rendering this effect no-ops); the
  // handled-request ref is the strict-mode double-invoke defense, where the
  // effect closure still holds the stale 'ready' from the same render.
  const handledSaveRequestRef = useRef<string | null>(null);
  useEffect(() => {
    const target = resolveAutoSaveTarget(
      fileDownloadPhase,
      fileDownloadActive,
      handledSaveRequestRef.current,
    );
    if (!target) return;
    handledSaveRequestRef.current = target.requestId;
    const { projectId, requestId, filename, url } = target;
    markSaving();
    saveDownloadedFile({ url, filename })
      .then(() => {
        if (useControlCenterStore.getState().fileDownloadActive?.requestId !== requestId) return; // 取消/重置后不再惊扰 UI
        markDone();
        // Fire-and-forget ack: /complete frees the server slot (the server
        // best-effort deletes the COS object). Its response is deliberately
        // NOT routed into the store — completed→idle would snap the sheet
        // shut before the user sees the saved body.
        completeProjectFileDownload(projectId, requestId).catch(() => {});
        show(t('fileBrowser.download.doneTitle'));
      })
      .catch((error: unknown) => {
        if (useControlCenterStore.getState().fileDownloadActive?.requestId !== requestId) return; // 取消/重置后不再惊扰 UI
        handledSaveRequestRef.current = null; // 允许对账翻回 ready 后重试落盘（save 失败≠下载失败，COS url 仍有效）
        markFailed(
          error instanceof Error && error.message
            ? error.message
            : t('fileBrowser.download.failedTitle'),
        );
        show(t('fileBrowser.download.failedTitle'), 'error');
      });
  }, [
    fileDownloadPhase,
    fileDownloadActive,
    markSaving,
    markDone,
    markFailed,
    show,
    t,
  ]);

  // Focus reconcile (30s cooldown, the session screen's silent auto-refresh
  // shape): a WS gap while this screen sat in the background could have
  // hidden the ready push — pull the authoritative status on re-focus while a
  // download record exists. refreshStatus swallows its own errors and no-ops
  // without a requestId, so a bare fire is safe.
  const lastDownloadReconcileAtRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const { fileDownloadActive: active, refreshStatus } =
        useControlCenterStore.getState();
      if (!active?.requestId) return;
      const now = Date.now();
      if (now - lastDownloadReconcileAtRef.current < DOWNLOAD_RECONCILE_COOLDOWN_MS) {
        return;
      }
      lastDownloadReconcileAtRef.current = now;
      void refreshStatus();
    }, []),
  );

  // Focus refresh (审计 #4):回屏时静默强制刷新当前目录——停在页面期间
  // agent 可能已改动文件,而主加载 effect 只在 effectivePath 变化时触发。
  // 30s 冷却防连切页打爆 agent;错误吞掉(屏上已有数据,静默失败可接受)。
  // 沿用已请求条数(完整列表不被静默打回 200)+联动重拉已展开子目录
  // (子目录此前永不刷新——展开集里删掉的文件一直是幽灵)。
  const lastFocusRefreshAtRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const state = useControlCenterStore.getState();
      const focusProject = state.projects.find(item => item.id === route.params.projectId);
      const focusDeviceOnline =
        (focusProject?.deviceId
          ? state.devices.find(item => item.id === focusProject.deviceId)?.status
          : undefined) === 'online';
      const focusPath = currentPath || focusProject?.path || '';
      if (!focusDeviceOnline || !focusPath || focusPath === '~') return;
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < FOCUS_REFRESH_COOLDOWN_MS) return;
      lastFocusRefreshAtRef.current = now;
      const maxEntries = requestedFullListRef.current ? FULL_LIST_MAX_ENTRIES : undefined;
      const expanded = [...expandedPathsRef.current];
      void (async () => {
        try {
          await state.loadProjectFiles(focusProject!.id, focusPath, { force: true, maxEntries });
          await Promise.allSettled(
            expanded.map(dirPath =>
              state.loadProjectFiles(focusProject!.id, dirPath, { force: true }),
            ),
          );
        } catch {
          // 静默失败:屏上已有数据。
        }
      })();
      // currentPath/projectId 变化本身就会触发主加载 effect,依赖里带上即可。
    }, [currentPath, route.params.projectId]),
  );

  if (!project) {
    return (
      <SafeAreaWrapper>
        <TopAppBar
          title={t('fileBrowser.title')}
          subtitle={t('fileBrowser.notFoundSubtitle')}
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
      // 沿用已请求条数:完整目录加载后,普通刷新不得静默打回 200 条。
      await loadProjectFiles(project.id, effectivePath, {
        force: true,
        maxEntries: requestedFullListRef.current ? FULL_LIST_MAX_ENTRIES : undefined,
      });
      // 已展开子目录联动重拉(allSettled:子目录失败静默,不顶掉主列表)。
      await Promise.allSettled(
        [...expandedPaths].map(dirPath =>
          loadProjectFiles(project.id, dirPath, { force: true }),
        ),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t('fileBrowser.error.loadFailed'),
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
      // 视频:先 64KB 头探针判真假——假视频就地拦截,不发起 COS 全量下载。
      // 判真/降级不清 store 拦截位,视频卡按 peekVideoVerdict 决策。
      if (file.previewBlocked.reason === 'video' && videoProbePath !== file.path) {
        setVideoProbePath(file.path);
        try {
          await probeProjectVideo(project.id, file.path);
        } finally {
          setVideoProbePath('');
        }
      }
      return;
    }
    setSelectedPath(file.path);
    setSheetError(null);
    if (file.content !== undefined) return;
    setReadingPath(file.path);
    try {
      await loadProjectFileContent(project.id, file.path);
    } catch (nextError) {
      // 就地呈现在 sheet 里(带重试),不再顶掉背后的整棵文件树。
      setSheetError({
        path: file.path,
        message:
          nextError instanceof Error
            ? nextError.message
            : t('fileBrowser.error.readFailed'),
      });
    } finally {
      setReadingPath('');
    }
  };

  const retrySheetRead = async (file: ProjectFileEntry) => {
    setSheetError(null);
    setReadingPath(file.path);
    try {
      await loadProjectFileContent(project.id, file.path, { force: true });
    } catch (nextError) {
      setSheetError({
        path: file.path,
        message:
          nextError instanceof Error
            ? nextError.message
            : t('fileBrowser.error.readFailed'),
      });
    } finally {
      setReadingPath('');
    }
  };

  const handleLoadFullList = async () => {
    if (!device || !effectivePath || effectivePath === '~') return;
    setLoading(true);
    setError('');
    try {
      await loadProjectFiles(project.id, effectivePath, {
        force: true,
        maxEntries: FULL_LIST_MAX_ENTRIES,
      });
      setRequestedFullList(true);
      requestedFullListRef.current = true;
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t('fileBrowser.error.loadFailed'),
      );
    } finally {
      setLoading(false);
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
      // 展开失败就地提示(toast)+ 回滚箭头,不再把全局错误卡顶到整棵树上。
      const failure = nextError instanceof Error ? nextError : new Error(t('fileBrowser.error.folderFailed'));
      show(humanizeFileError(failure, t).title, 'error');
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
            {t('fileBrowser.readingFile')}
          </Text>
        </View>
      );
    }
    // 视频扩展名(mp4/mov/m4v):64KB 头探针状态机,先于通用拦截卡。
    // probing → spinner;not_video → 假视频拦截卡(省下 COS 全量上传);
    // video/unknown → 视频卡 + 下载 CTA(unknown = 探针故障,降级放行)。
    if (file.previewBlocked?.reason === 'video') {
      const verdict = peekVideoVerdict(project.id, file.path);
      if (!verdict || videoProbePath === file.path) {
        return (
          <View style={styles.sheetLoading}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text
              style={[
                theme.typography.bodySm,
                { color: theme.colors.onSurfaceVariant, marginTop: 10 },
              ]}>
              {t('fileBrowser.video.probing')}
            </Text>
          </View>
        );
      }
      if (verdict.kind === 'not_video') {
        return (
          <View style={styles.sheetBlocked}>
            <IconBadge name="warning" tone="error" size={40} iconSize={20} />
            <Text
              style={[
                theme.typography.titleMd,
                { color: theme.colors.onSurface, textAlign: 'center', marginTop: 10 },
              ]}>
              {t('fileBrowser.video.fakeTitle')}
            </Text>
            <Text
              style={[
                theme.typography.bodySm,
                { color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 6 },
              ]}>
              {t('fileBrowser.video.fakeDetail')}
            </Text>
            <GlowButton
              title={t('fileBrowser.openInTerminal')}
              onPress={() =>
                device &&
                navigation.navigate('DeviceTerminal', {
                  deviceId: device.id,
                  directory: parentPathOf(file.path),
                  terminalId: activeTerminalId,
                })
              }
              disabled={!device}
              variant="primary"
              style={styles.sheetBlockedAction}
            />
          </View>
        );
      }
      // 已就绪:COS 直链交给播放器(内嵌 sheet,Range 按需拉流)。
      if (previewPlayingPath === file.path && previewUrl) {
        return (
          <View style={styles.sheetBlocked}>
            <View style={styles.videoPlayerBox}>
              <RemoteVideoPlayer
                uri={previewUrl}
                onError={() => {
                  show(t('fileBrowser.video.playFailedToast'));
                  setPreviewPlayingPath('');
                  setPreviewUrl('');
                }}
              />
            </View>
            <GlowButton
              title={t('fileBrowser.video.closePlayer')}
              onPress={() => {
                setPreviewPlayingPath('');
                setPreviewUrl('');
              }}
              variant="outline"
              style={styles.sheetBlockedAction}
            />
          </View>
        );
      }
      // 准备中:COS 推送进度(取消 = 撤 agent 上传 + 删对象)。
      if (previewPreparing?.path === file.path) {
        return (
          <View style={styles.sheetLoading}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text
              style={[
                theme.typography.bodySm,
                { color: theme.colors.onSurfaceVariant, marginTop: 10 },
              ]}>
              {previewPreparing.label}
            </Text>
            <GlowButton
              title={t('fileBrowser.video.cancelPrepare')}
              onPress={cancelPreviewSession}
              variant="outline"
              style={styles.sheetBlockedAction}
            />
          </View>
        );
      }
      return (
        <View style={styles.sheetBlocked}>
          <IconBadge
            name="play"
            tone={verdict.kind === 'unknown' ? 'tertiary' : 'primary'}
            size={40}
            iconSize={20}
          />
          <Text
            style={[
              theme.typography.titleMd,
              { color: theme.colors.onSurface, textAlign: 'center', marginTop: 10 },
            ]}>
            {t('fileBrowser.video.cardTitle')}
          </Text>
          <Text
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 6 },
            ]}>
            {verdict.kind === 'unknown'
              ? t('fileBrowser.video.unknownDetail')
              : t('fileBrowser.video.cardDetail', { size: file.size })}
          </Text>
          {downloadEnabled ? (
            <GlowButton
              title={t('fileBrowser.video.playCta')}
              onPress={() => handlePlayVideo(file)}
              variant="primary"
              style={styles.sheetBlockedAction}
            />
          ) : null}
          {downloadEnabled ? (
            <GlowButton
              title={t('fileBrowser.video.downloadCta')}
              onPress={() => setDownloadFile(file)}
              variant="secondary"
              style={styles.sheetBlockedAction}
            />
          ) : null}
          <GlowButton
            title={t('fileBrowser.openInTerminal')}
            onPress={() =>
              device &&
              navigation.navigate('DeviceTerminal', {
                deviceId: device.id,
                directory: parentPathOf(file.path),
                terminalId: activeTerminalId,
              })
            }
            disabled={!device}
            variant="outline"
            style={styles.sheetBlockedAction}
          />
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
              ? t('fileBrowser.binaryBlockedTitle')
              : t('fileBrowser.tooLargeBlockedTitle')}
          </Text>
          <Text
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 6 },
            ]}>
            {file.previewBlocked.reason === 'binary'
              ? t('fileBrowser.binaryBlockedDetail')
              : t('fileBrowser.tooLargeBlockedDetail')}
          </Text>
          <GlowButton
            title={t('fileBrowser.openInTerminal')}
            onPress={() =>
              device &&
              navigation.navigate('DeviceTerminal', {
                deviceId: device.id,
                directory: parentPathOf(file.path),
                terminalId: activeTerminalId,
              })
            }
            disabled={!device}
            variant="primary"
            style={styles.sheetBlockedAction}
          />
        </View>
      );
    }
    if (sheetError?.path === file.path) {
      const humanized = humanizeFileError(
        new Error(sheetError.message),
        t,
      );
      return (
        <View style={styles.sheetBlocked}>
          <IconBadge name="warning" tone="error" size={40} iconSize={20} />
          <Text
            style={[
              theme.typography.titleMd,
              { color: theme.colors.onSurface, textAlign: 'center', marginTop: 10 },
            ]}>
            {humanized.title}
          </Text>
          <Text
            style={[
              theme.typography.bodySm,
              { color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 6 },
            ]}>
            {humanized.detail || sheetError.message}
          </Text>
          <GlowButton
            title={t('fileBrowser.retryRead')}
            onPress={() => retrySheetRead(file)}
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
        title={t('fileBrowser.title')}
        subtitle={project.name}
        onBack={navigation.goBack}
        rightAction={
          <StatusChip
            label={loading ? t('fileBrowser.loading') : deviceOnline ? 'ONLINE' : 'OFFLINE'}
            type={loading ? 'info' : deviceOnline ? 'success' : 'neutral'}
          />
        }
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <DeferredMount>
        <TouchableOpacity
          testID="file-browser-change-review"
            activeOpacity={0.7}
            onPress={openChangeReview}
            style={[
              {
                flexDirection: 'row',
                alignItems: 'center',
                padding: 12,
                borderRadius: 12,
                borderWidth: 1,
                marginBottom: 12,
              },
              {
                borderColor: theme.colors.primary,
                backgroundColor: isDark
                  ? 'rgba(86,156,214,0.12)'
                  : 'rgba(0,81,174,0.06)',
              },
            ]}>
          <View style={{ flex: 1 }}>
            <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
              {t('fileBrowser.changeReviewTitle')}
            </Text>
            <Text
              style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
              {t('fileBrowser.changeReviewSubtitle')}
            </Text>
          </View>
          <Text style={[theme.typography.titleLg, { color: theme.colors.primary }]}>
            {'›'}
          </Text>
        </TouchableOpacity>
        {/* Status filters — 顶部（原在文件列表底部） */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ paddingHorizontal: 4, marginBottom: 8 }}>
          {filters.map(item => {
            const active = item.value === filter;
            return (
              <TouchableOpacity
                key={item.value}
                activeOpacity={0.7}
                onPress={() => setFilter(item.value)}
                style={[
                  styles.filterChip,
                  { marginRight: 6 },
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
                  {t(`fileBrowser.filter.${item.labelKey}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
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
              {device ? `${device.name} · ${device.os}` : t('fileBrowser.deviceUnbound')}
            </Text>
            <StatusChip
              label={deviceOnline ? t('fileBrowser.agentOnline') : device ? t('fileBrowser.agentOffline') : t('fileBrowser.noDevice')}
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
                  terminalId: activeTerminalId,
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
                    title={loading ? t('fileBrowser.reload') : t('fileBrowser.reloadAction')}
                    onPress={handleRefresh}
                    disabled={!device || !deviceOnline || loading}
                    variant="primary"
                    style={styles.stateAction}
                  />
                  {device ? (
                    <GlowButton
                      title={t('fileBrowser.scanDevice')}
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
                    ? t('fileBrowser.loadingFromAgent')
                    : !device
                    ? t('fileBrowser.taskNoDevice')
                    : !deviceOnline
                    ? t('fileBrowser.agentOfflineTitle')
                    : t('fileBrowser.noFiles')}
                </Text>
                <Text
                  style={[
                    theme.typography.bodySm,
                    { color: theme.colors.onSurfaceVariant, textAlign: 'center' },
                  ]}>
                  {!device
                    ? t('fileBrowser.taskNoDeviceHint')
                    : !deviceOnline
                    ? t('fileBrowser.agentOfflineHint')
                    : t('fileBrowser.noFilesHint')}
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
                        {t('fileBrowser.emptyFolder')}
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
                      onLongPress={
                        row.file.kind === 'file'
                          ? () => setMenuFile(row.file)
                          : undefined
                      }
                      isLast={index === flatRows.length - 1}
                    />
                  ),
                )}
                <LoadMoreRow
                  visibleCount={fileList.visibleCount}
                  totalCount={fileList.totalCount}
                  onPress={fileList.showMore}
                  label={t('fileBrowser.loadMoreFiles')}
                />
                {listTruncated && !requestedFullList ? (
                  <View style={styles.truncatedRow}>
                    <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                      {t('fileBrowser.truncatedNotice', {
                        count: projectFiles.length,
                      })}
                    </Text>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={handleLoadFullList}
                      disabled={loading}
                      style={styles.truncatedButton}>
                      <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                        {t('fileBrowser.truncatedLoadAll')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : listTruncated && requestedFullList ? (
                  <View style={styles.truncatedRow}>
                    <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                      {t('fileBrowser.truncatedStill', {
                        count: projectFiles.length,
                      })}
                    </Text>
                  </View>
                ) : null}
              </>
            )}
          </View>
        </GlassPanel>

        {/* File content — opens in a bottom sheet that slides up from below */}
        <BottomSheet
          open={Boolean(selectedFile)}
          onClose={() => {
            // 只 detach 不取消:在飞上传后台继续(server 幂等),返回重进秒附。
            previewHandleRef.current?.detach();
            previewHandleRef.current = null;
            setPreviewPlayingPath('');
            setPreviewUrl('');
            setPreviewPreparing(null);
            setSelectedPath('');
            setSheetError(null);
          }}
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

        {/* File-row long-press menu + the download / device-transfer sheets.
            The menu exists when either surface is available: downloads need
            the server capability flag; transfers need the source device
            online (capability mismatches surface as a 409 via the sheet's
            failure body). A close attempt mid-run is a dead gesture (the
            sheet stays mounted while a run is live); Cancel is the only way
            out of a running task. */}
        {(downloadEnabled || (deviceOnline && !!device)) && (
          <>
            <FileLongPressMenu
              visible={!!menuFile}
              fileName={menuFile?.name ?? ''}
              onClose={() => setMenuFile(null)}
              actions={[
                ...(downloadEnabled
                  ? [
                      {
                        label: t('fileBrowser.download.menuItem'),
                        tone: 'primary' as const,
                        onPress: () => {
                          const file = menuFile;
                          setMenuFile(null);
                          if (file) setDownloadFile(file);
                        },
                      },
                    ]
                  : []),
                ...(deviceOnline && device
                  ? [
                      {
                        label: t('fileBrowser.transfer.menuItem'),
                        tone: 'default' as const,
                        onPress: () => {
                          const file = menuFile;
                          setMenuFile(null);
                          if (file) setTransferFile(file);
                        },
                      },
                    ]
                  : []),
              ]}
            />
            <FileDownloadSheet
              pendingFile={downloadFile}
              projectId={route.params.projectId}
              onClose={() => setDownloadFile(null)}
            />
            {device ? (
              <FileTransferSheet
                pendingFile={transferFile}
                sourceDevice={device}
                devices={devices}
                onClose={() => setTransferFile(null)}
              />
            ) : null}
          </>
        )}
        </DeferredMount>
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
  /**
   * Long-press on the row's name area (files only at the call sites). Wired to
   * the name-area pressable in BOTH branches — the folder row's name and
   * chevron are sibling pressables, and the long-press belongs to the name
   * one, never the chevron. Undefined for folders today.
   */
  onLongPress?: () => void;
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
  onLongPress,
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
          onLongPress={onLongPress}
          delayLongPress={350}
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
          testID={`file-row-chevron-${file.id}`}
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
    <TouchableOpacity
      activeOpacity={0.65}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      testID={`file-row-${file.id}`}
      style={baseStyle}>
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
  truncatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  truncatedButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(86,156,214,0.5)',
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  sheetLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  videoPlayerBox: {
    width: '100%',
    height: 260,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.35)',
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
