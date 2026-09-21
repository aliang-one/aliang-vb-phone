// Task 16 (TDD red→green): the download confirm / progress / failure sheet.
// The contract under test (jest locale is pinned to zh — assert zh strings):
//   1. confirm (phase idle + pendingFile): filename / path / formatBytes(size)
//      / language / Platform-OS destination copy; sizeBytes > max_bytes →
//      confirm disabled + tooLargeDetail with the formatted limit.
//   2. uploading: Math.round(uploaded/total*100)% + cancel button; totalBytes
//      missing → indeterminate (no percent).
//   3. ready / saving: downloading copy (local save phase).
//   4. failed: failedTitle + reason (known server codes → friendly copy,
//      unknown shown raw) + retry re-invokes startDownload with same params.
//   5. done: doneTitle + close button (resets the store phase).
//   6. confirm press → startDownload(projectId, path, name).
//   7. cancelled: transient — the sheet closes itself (onClose + reset).
// Only the store is mocked (a plain object behind the zustand selector).
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Platform, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FileDownloadSheet } from '../FileDownloadSheet';
import type {
  ActiveDownload,
  FileDownloadPhase,
  ProjectFileEntry,
} from '../../../store/types';

// The mocked store: rebuilt per test, read through the zustand selector.
interface MockStoreState {
  fileDownloadPhase: FileDownloadPhase;
  fileDownloadActive: ActiveDownload | null;
  fileDownloadCapability?: { enabled: boolean; max_bytes: number };
  startDownload: jest.Mock;
  cancelDownload: jest.Mock;
  resetFileDownload: jest.Mock;
}
let mockStoreState: MockStoreState;

jest.mock('../../../store/controlCenterStore', () => ({
  useControlCenterStore: (selector: (state: MockStoreState) => unknown) =>
    selector(mockStoreState),
}));

/** Flatten a Text node's children into its literal string. */
const flattenText = (node: TestRenderer.ReactTestInstance): string =>
  React.Children.toArray(node.props.children)
    .map(child =>
      typeof child === 'string'
        ? child
        : typeof child === 'number'
        ? String(child)
        : '',
    )
    .join('');

const labelsOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map(flattenText).filter(Boolean);

const findButton = (
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
) =>
  renderer.root.findAllByType(TouchableOpacity).find(button =>
    button.findAllByType(Text).map(flattenText).includes(label),
  );

const makeFile = (overrides?: Partial<ProjectFileEntry>): ProjectFileEntry => ({
  id: 'file-1',
  projectId: 'proj-1',
  path: '/work/docs/notes.md',
  name: 'notes.md',
  kind: 'file',
  status: 'clean',
  language: 'Markdown',
  size: '2 KB',
  sizeBytes: 2048,
  lastTouched: '2026-09-20T00:00:00Z',
  summary: '',
  ...overrides,
});

const baseStore = (
  overrides?: Partial<MockStoreState>,
): MockStoreState => ({
  fileDownloadPhase: 'idle',
  fileDownloadActive: null,
  fileDownloadCapability: { enabled: true, max_bytes: 104857600 },
  startDownload: jest.fn(),
  cancelDownload: jest.fn(),
  resetFileDownload: jest.fn(),
  ...overrides,
});

const ORIGINAL_OS = Platform.OS;

const renderSheet = (props?: {
  pendingFile?: ProjectFileEntry | null;
  projectId?: string;
  onClose?: () => void;
}) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      // initialMetrics is required under the test renderer: without it the
      // provider waits for a native onInsetsChange that never fires, so it
      // renders children = null (and useSafeAreaInsets throws without a
      // provider at all).
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 320, height: 640 },
          insets: { top: 0, bottom: 0, left: 0, right: 0 },
        }}>
        <FileDownloadSheet
          pendingFile={props?.pendingFile === undefined ? makeFile() : props.pendingFile}
          projectId={props?.projectId ?? 'proj-1'}
          onClose={props?.onClose ?? jest.fn()}
        />
      </SafeAreaProvider>,
    );
  });
  return renderer;
};

describe('FileDownloadSheet', () => {
  beforeEach(() => {
    mockStoreState = baseStore();
  });

  afterEach(() => {
    (Platform as { OS: string }).OS = ORIGINAL_OS;
  });

  it('confirm view shows file name, path, formatted size, language and the iOS destination copy', () => {
    const renderer = renderSheet();

    const labels = labelsOf(renderer);
    expect(labels).toContain('notes.md');
    expect(labels).toContain('/work/docs/notes.md');
    expect(labels).toContain('2.00 KB');
    expect(labels).toContain('Markdown');
    // jest platform default is ios
    expect(labels).toContain('将在分享面板中选择「存储到文件」');

    const confirm = findButton(renderer, '确认下载');
    expect(confirm).toBeDefined();
    expect(confirm!.props.disabled).toBeFalsy();

    renderer.unmount();
  });

  it('confirm view shows the Android destination copy on android', () => {
    (Platform as { OS: string }).OS = 'android';
    const renderer = renderSheet();

    expect(labelsOf(renderer)).toContain('将保存到系统下载目录');

    renderer.unmount();
  });

  it('disables the confirm button and explains when the file exceeds the server size limit', () => {
    mockStoreState = baseStore({
      fileDownloadCapability: { enabled: true, max_bytes: 1024 },
    });
    const renderer = renderSheet();

    const labels = labelsOf(renderer);
    expect(labels).toContain('文件超过 1.00 KB 的下载上限');
    const confirm = findButton(renderer, '确认下载');
    expect(confirm).toBeDefined();
    expect(confirm!.props.disabled).toBe(true);

    renderer.unmount();
  });

  it('confirm press starts the download with projectId, path and file name', () => {
    const renderer = renderSheet();

    const confirm = findButton(renderer, '确认下载');
    act(() => {
      confirm!.props.onPress();
    });
    expect(mockStoreState.startDownload).toHaveBeenCalledTimes(1);
    expect(mockStoreState.startDownload).toHaveBeenCalledWith(
      'proj-1',
      '/work/docs/notes.md',
      'notes.md',
    );

    renderer.unmount();
  });

  it('uploading view shows the rounded percent progress and a cancel button that cancels and closes', () => {
    mockStoreState = baseStore({
      fileDownloadPhase: 'uploading',
      fileDownloadActive: {
        projectId: 'proj-1',
        requestId: 'req-1',
        path: '/work/docs/notes.md',
        filename: 'notes.md',
        totalBytes: 2048,
        uploadedBytes: 512,
      },
    });
    const onClose = jest.fn();
    // pendingFile cleared by the caller — the non-idle phase alone keeps the sheet open.
    const renderer = renderSheet({ pendingFile: null, onClose });

    const labels = labelsOf(renderer);
    expect(labels).toContain('正在从设备上传…');
    expect(labels).toContain('25%');

    const cancel = findButton(renderer, '取消');
    expect(cancel).toBeDefined();
    act(() => {
      cancel!.props.onPress();
    });
    expect(mockStoreState.cancelDownload).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it('uploading view is indeterminate (no percent) when totalBytes is unknown', () => {
    mockStoreState = baseStore({
      fileDownloadPhase: 'uploading',
      fileDownloadActive: {
        projectId: 'proj-1',
        requestId: 'req-1',
        path: '/work/docs/notes.md',
        filename: 'notes.md',
        totalBytes: 0,
        uploadedBytes: 0,
      },
    });
    const renderer = renderSheet({ pendingFile: null });

    const labels = labelsOf(renderer);
    expect(labels).toContain('正在从设备上传…');
    expect(labels.some(label => label.includes('%'))).toBe(false);

    renderer.unmount();
  });

  it.each(['ready', 'saving'] as FileDownloadPhase[])(
    'phase %s shows the local downloading copy',
    phase => {
      mockStoreState = baseStore({
        fileDownloadPhase: phase,
        fileDownloadActive: {
          projectId: 'proj-1',
          requestId: 'req-1',
          path: '/work/docs/notes.md',
          filename: 'notes.md',
          totalBytes: 2048,
          uploadedBytes: 2048,
        },
      });
      const renderer = renderSheet({ pendingFile: null });

      expect(labelsOf(renderer)).toContain('正在下载…');

      renderer.unmount();
    },
  );

  it('failed view maps the known download_in_progress code to friendly copy and retries with the same parameters', () => {
    mockStoreState = baseStore({
      fileDownloadPhase: 'failed',
      fileDownloadActive: {
        projectId: 'proj-1',
        requestId: 'req-1',
        path: '/work/docs/notes.md',
        filename: 'notes.md',
        totalBytes: 2048,
        uploadedBytes: 0,
        reason: 'server said: download_in_progress',
      },
    });
    const renderer = renderSheet({ pendingFile: null });

    const labels = labelsOf(renderer);
    expect(labels).toContain('下载失败');
    expect(labels).toContain('已有下载任务进行中');
    // the raw server code is replaced, not duplicated
    expect(labels.some(label => label.includes('download_in_progress'))).toBe(false);

    const retry = findButton(renderer, '重试');
    expect(retry).toBeDefined();
    act(() => {
      retry!.props.onPress();
    });
    expect(mockStoreState.startDownload).toHaveBeenCalledTimes(1);
    expect(mockStoreState.startDownload).toHaveBeenCalledWith(
      'proj-1',
      '/work/docs/notes.md',
      'notes.md',
    );

    renderer.unmount();
  });

  it('failed view shows an unknown reason verbatim', () => {
    mockStoreState = baseStore({
      fileDownloadPhase: 'failed',
      fileDownloadActive: {
        projectId: 'proj-1',
        requestId: 'req-1',
        path: '/work/docs/notes.md',
        filename: 'notes.md',
        totalBytes: 0,
        uploadedBytes: 0,
        reason: 'upstream 502 bad gateway',
      },
    });
    const renderer = renderSheet({ pendingFile: null });

    expect(labelsOf(renderer)).toContain('upstream 502 bad gateway');

    renderer.unmount();
  });

  it('done view shows the saved copy and its close button resets the store phase', () => {
    mockStoreState = baseStore({
      fileDownloadPhase: 'done',
      fileDownloadActive: {
        projectId: 'proj-1',
        requestId: 'req-1',
        path: '/work/docs/notes.md',
        filename: 'notes.md',
        totalBytes: 2048,
        uploadedBytes: 2048,
      },
    });
    const onClose = jest.fn();
    const renderer = renderSheet({ pendingFile: null, onClose });

    expect(labelsOf(renderer)).toContain('已保存');

    const close = findButton(renderer, '关闭');
    expect(close).toBeDefined();
    act(() => {
      close!.props.onPress();
    });
    expect(mockStoreState.resetFileDownload).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it('cancelled is transient: the sheet resets the store and closes itself', () => {
    mockStoreState = baseStore({
      fileDownloadPhase: 'cancelled',
      fileDownloadActive: null,
    });
    const onClose = jest.fn();
    const renderer = renderSheet({ pendingFile: null, onClose });

    expect(mockStoreState.resetFileDownload).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });
});
