// The device-transfer confirm / progress / failure sheet (长按文件 → 同步到
// 别的设备). The contract under test (jest locale is pinned to zh — assert
// zh strings):
//   1. confirm (phase idle + pendingFile): source path / formatBytes(size) /
//      source device copy; target picker filters out the source device and
//      offline devices; no candidates → confirm disabled + noTargets copy.
//   2. confirm press → startTransfer with source/target/path/filename and
//      is_directory_archive=false.
//   3. transferring: percent from bytesDone/totalBytes + cancel button;
//      totalBytes missing → indeterminate (no percent).
//   4. done: doneTitle + close button (resets the store phase).
//   5. failed: failedTitle + reason (known server codes → friendly copy,
//      unknown shown raw).
//   6. cancelled: transient — the sheet closes itself (onClose + reset).
// Only the store is mocked (a plain object behind the zustand selector).
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FileTransferSheet, transferReasonKey } from '../FileTransferSheet';
import type { Device } from '../../../data/platformModels';
import type {
  ActiveTransfer,
  ProjectFileEntry,
  TransferPhase,
} from '../../../store/types';

// The mocked store: rebuilt per test, read through the zustand selector.
interface MockStoreState {
  transferPhase: TransferPhase;
  transferActive: ActiveTransfer | null;
  startTransfer: jest.Mock;
  cancelTransfer: jest.Mock;
  refreshTransferStatus: jest.Mock;
  resetTransfer: jest.Mock;
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

const makeDevice = (
  id: string,
  name: string,
  status: 'online' | 'offline',
): Device => ({
  id,
  name,
  status,
  location: '',
  os: 'darwin',
  host: '',
  cpuLoad: 0,
  memLoad: 0,
  authorizedDirectories: [],
  activePorts: [],
  projectIds: ['proj-1'],
  activeSessionIds: [],
  lastSeen: '2026-10-25T00:00:00Z',
  remoteTerminalEnabled: true,
  aiControlEnabled: true,
    peerExecEnabled: false,
  peerFetchEnabled: false,  capabilities: ['file_transfer_v1'],
  tools: [],
  history: [],
});

const SOURCE = makeDevice('dev-src', 'MacBook', 'online');

const baseStore = (
  overrides?: Partial<MockStoreState>,
): MockStoreState => ({
  transferPhase: 'idle',
  transferActive: null,
  startTransfer: jest.fn(),
  cancelTransfer: jest.fn(),
  refreshTransferStatus: jest.fn(async () => undefined),
  resetTransfer: jest.fn(),
  ...overrides,
});

const renderSheet = (props?: {
  pendingFile?: ProjectFileEntry | null;
  devices?: Device[];
  onClose?: () => void;
}) => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      // initialMetrics is required under the test renderer: without it the
      // provider waits for a native onInsetsChange that never fires.
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 320, height: 640 },
          insets: { top: 0, bottom: 0, left: 0, right: 0 },
        }}>
        <FileTransferSheet
          pendingFile={props?.pendingFile === undefined ? makeFile() : props.pendingFile}
          sourceDevice={SOURCE}
          devices={props?.devices ?? [SOURCE, makeDevice('dev-dst', 'liang-dev', 'online')]}
          onClose={props?.onClose ?? jest.fn()}
        />
      </SafeAreaProvider>,
    );
  });
  return renderer;
};

describe('FileTransferSheet', () => {
  beforeEach(() => {
    mockStoreState = baseStore();
  });

  test('confirm body shows file facts and filters out the source device', () => {
    const renderer = renderSheet({
      devices: [
        SOURCE,
        makeDevice('dev-dst1', 'liang-dev', 'online'),
        makeDevice('dev-dst2', 'nursor', 'online'),
        makeDevice('dev-off', 'sleeping', 'offline'),
      ],
    });
    const labels = labelsOf(renderer).join('\n');
    // Source path + size + source-device copy…
    expect(labels).toContain('/work/docs/notes.md');
    expect(labels).toContain('2.00 KB');
    expect(labels).toContain('来自 MacBook');
    expect(labels).toContain('同步到');
    // Target picker entries: only the online non-source device is offered.
    // The picker renders collapsed — tap the toggle to expand the list first
    // (looked up by testID props: Pressable type identity is unreliable under
    // the react-native lazy getters in the test renderer).
    const toggle = renderer.root.findByProps({ testID: 'device-picker-toggle' });
    expect(toggle).toBeTruthy();
    act(() => {
      toggle.props.onPress();
    });
    // findAllByProps matches every node carrying the prop (host wrappers
    // included) — dedupe to the distinct picker entries.
    const pickerEntryIds = [
      ...new Set(
        renderer.root
          .findAllByProps({ testID: 'device-picker-entry-dev-dst1' })
          .concat(renderer.root.findAllByProps({ testID: 'device-picker-entry-dev-dst2' }))
          .map(button => button.props.testID as string),
      ),
    ];
    expect(pickerEntryIds).toEqual([
      'device-picker-entry-dev-dst1',
      'device-picker-entry-dev-dst2',
    ]);
    // …the offline device never renders anywhere.
    expect(labels).not.toContain('sleeping');
  });

  test('no online targets disables confirm and shows the hint', () => {
    const renderer = renderSheet({ devices: [SOURCE] });
    expect(labelsOf(renderer)).toContain('没有其他在线设备可接收');
    const confirm = findButton(renderer, '发起同步');
    expect(confirm?.props.disabled).toBe(true);
  });

  test('confirm press starts the transfer with wire-shaped params', () => {
    const renderer = renderSheet();
    const confirm = findButton(renderer, '发起同步');
    expect(confirm).toBeTruthy();
    act(() => {
      confirm?.props.onPress();
    });
    // 组件始终带 targetDir(空串=默认目标);store 里 `trim() || undefined`
    // 会把空串剥掉,wire 上不出现 —— 此处断言的是 action 入参形态。
    expect(mockStoreState.startTransfer).toHaveBeenCalledWith({
      sourceDeviceId: 'dev-src',
      targetDeviceId: 'dev-dst',
      sourcePath: '/work/docs/notes.md',
      filename: 'notes.md',
      isDirectoryArchive: false,
      targetDir: '',
    });
  });

  test('transferring shows percent and bytes with a cancel button', () => {
    mockStoreState = baseStore({
      transferPhase: 'transferring',
      transferActive: {
        sourceDeviceId: 'dev-src',
        targetDeviceId: 'dev-dst',
        transferId: 'tr_1',
        sourcePath: '/work/docs/notes.md',
        filename: 'notes.md',
        isDirectoryArchive: false,
        totalBytes: 2048,
        bytesDone: 1024,
      },
    });
    const renderer = renderSheet({ pendingFile: null });
    const labels = labelsOf(renderer).join('\n');
    expect(labels).toContain('正在跨设备同步…');
    expect(labels).toContain('50%');
    expect(labels).toContain('1.00 KB / 2.00 KB');
    expect(findButton(renderer, '取消')).toBeTruthy();
  });

  test('transferring without totalBytes stays indeterminate (no percent)', () => {
    mockStoreState = baseStore({
      transferPhase: 'transferring',
      transferActive: {
        sourceDeviceId: 'dev-src',
        targetDeviceId: 'dev-dst',
        transferId: 'tr_1',
        sourcePath: '/work/docs/notes.md',
        filename: 'notes.md',
        isDirectoryArchive: false,
        totalBytes: 0,
        bytesDone: 0,
      },
    });
    const renderer = renderSheet({ pendingFile: null });
    const labels = labelsOf(renderer).join('\n');
    expect(labels).not.toContain('%');
    expect(labels).toContain('正在跨设备同步…');
  });

  test('done body shows the terminal copy and close resets the store', () => {
    const onClose = jest.fn();
    mockStoreState = baseStore({
      transferPhase: 'done',
      transferActive: {
        sourceDeviceId: 'dev-src',
        targetDeviceId: 'dev-dst',
        transferId: 'tr_1',
        sourcePath: '/work/docs/notes.md',
        filename: 'notes.md',
        isDirectoryArchive: false,
        totalBytes: 2048,
        bytesDone: 2048,
      },
    });
    const renderer = renderSheet({ pendingFile: null, onClose });
    expect(labelsOf(renderer)).toContain('已同步');
    const close = findButton(renderer, '关闭');
    act(() => {
      close?.props.onPress();
    });
    expect(mockStoreState.resetTransfer).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test('failed body maps known server codes to friendly copy', () => {
    mockStoreState = baseStore({
      transferPhase: 'failed',
      transferActive: {
        sourceDeviceId: 'dev-src',
        targetDeviceId: 'dev-dst',
        transferId: '',
        sourcePath: '/work/docs/notes.md',
        filename: 'notes.md',
        isDirectoryArchive: false,
        totalBytes: 0,
        bytesDone: 0,
        reason: 'device_capability_unsupported',
      },
    });
    const renderer = renderSheet({ pendingFile: null });
    const labels = labelsOf(renderer).join('\n');
    expect(labels).toContain('同步失败');
    expect(labels).toContain('设备版本过旧，暂不支持文件互传');
  });

  test('transferReasonKey passes unknown reasons through as null', () => {
    expect(transferReasonKey('pair_busy')).toBe('fileBrowser.transfer.busyDetail');
    expect(transferReasonKey('something_else')).toBeNull();
    expect(transferReasonKey(undefined)).toBeNull();
  });

  test('cancelled is transient: the sheet closes itself and resets', () => {
    const onClose = jest.fn();
    mockStoreState = baseStore({ transferPhase: 'cancelled' });
    renderSheet({ pendingFile: null, onClose });
    // The cancelled effect fires synchronously on mount: reset + close.
    expect(mockStoreState.resetTransfer).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
