/**
 * 文件浏览器审计修复回归钉(2026-10-28 审计 #1/#2/#4):
 *   #1 目录级截断不再静默——尾部提示行 + 「加载完整目录」(maxEntries=1000);
 *   #2 错误局部化——展开子目录失败只弹 toast(全局错误卡不再顶掉整棵树),
 *      读文件失败就地呈现在预览 sheet 里(带重试),背后列表原样;
 *   #4 回屏静默强制刷新当前目录(30s 冷却)。
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FileBrowserScreen } from '../src/screens/projects/FileBrowserScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { useToastStore } from '../src/store/toastStore';
import { fileCache } from '../src/services/fileCache';
import { platformTransport } from '../src/services/platformTransport';
import type { ServerProjectFileList } from '../src/api/projects';
import type { Device, Project } from '../src/data/platformModels';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    loadProjectFiles: jest.fn(),
    loadProjectFileContent: jest.fn(),
  },
}));

// useFocusEffect:记录全部回调,测试手动触发(不自动执行)。
const focusEffects: Array<() => void> = [];
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
  useRoute: () => ({ params: { projectId: 'project-1', deviceId: 'device-1' } }),
  useFocusEffect: (cb: () => void) => {
    focusEffects.push(cb);
  },
}));

const mockedLoad = platformTransport.loadProjectFiles as jest.MockedFunction<
  typeof platformTransport.loadProjectFiles
>;
const mockedRead = platformTransport.loadProjectFileContent as jest.MockedFunction<
  typeof platformTransport.loadProjectFileContent
>;

const listSnapshot = (
  overrides?: Partial<ServerProjectFileList>,
): ServerProjectFileList => ({
  project_id: 'project-1',
  device_id: 'device-1',
  path: '/work/p',
  entries: [],
  truncated: false,
  generated_at: '2026-10-28T00:00:00Z',
  ...overrides,
});

const entry = (
  id: string,
  name: string,
  kind: 'file' | 'directory',
  path: string,
) => ({
  project_id: 'project-1',
  device_id: 'device-1',
  id,
  path,
  name,
  kind,
  directoryPath: '/work/p',
  status: 'clean' as const,
  sizeBytes: kind === 'file' ? 64 : undefined,
  size: kind === 'file' ? '64 B' : undefined,
});

const project = (): Project => ({
  id: 'project-1',
  name: 'Vibe Phone',
  status: 'active',
  branch: 'main',
  lastDeploy: '刚刚',
  language: 'TypeScript',
  description: 'x',
  path: '/work/p',
  deviceId: 'device-1',
  detectedPorts: [],
  approvalScheme: 'custom',
});

const device = (): Device => ({
  id: 'device-1',
  name: 'MacBook',
  status: 'online',
  location: 'Desk',
  os: 'darwin',
  host: 'localhost',
  cpuLoad: 0,
  memLoad: 0,
  authorizedDirectories: ['/work/p'],
  activePorts: [],
  projectIds: ['project-1'],
  activeSessionIds: [],
  lastSeen: 'now',
  remoteTerminalEnabled: true,
  aiControlEnabled: true,
    peerExecEnabled: false,
  peerFetchEnabled: false,  capabilities: ['terminal'],
  tools: [],
  history: [],
});

let screen: ReactTestRenderer.ReactTestRenderer | undefined;

const texts = () =>
  screen!.root
    .findAllByType(Text)
    .map(node =>
      Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children ?? ''),
    );

beforeEach(() => {
  focusEffects.length = 0;
  jest.clearAllMocks();
  fileCache.clear();
  mockedLoad.mockResolvedValue(
    listSnapshot({ entries: [entry('f1', 'app.ts', 'file', '/work/p/app.ts')] }),
  );
  mockedRead.mockResolvedValue({
    project_id: 'project-1',
    device_id: 'device-1',
    path: '/work/p/app.ts',
    content: 'const a = 1;',
    encoding: 'utf8',
    size_bytes: 64,
    truncated: false,
  });
  useControlCenterStore.setState({
    serverMode: true,
    devices: [device()],
    projects: [project()],
    scanResults: [],
    projectFiles: [],
    projectFileListTruncated: {},
    events: [],
  });
});

afterEach(() => {
  act(() => {
    screen?.unmount();
  });
  screen = undefined;
});

const renderScreen = () =>
  ReactTestRenderer.create(
    <ThemeContext.Provider
      value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
        }}>
        <FileBrowserScreen />
      </SafeAreaProvider>
    </ThemeContext.Provider>,
  );

const settle = async () => {
  await act(async () => {});
};

describe('FileBrowserScreen 审计修复', () => {
  test('#1 截断:提示行出现,「加载完整目录」按 1000 条重拉,到顶后换成常驻提示', async () => {
    mockedLoad.mockResolvedValue(
      listSnapshot({ truncated: true, entries: [entry('f1', 'app.ts', 'file', '/work/p/app.ts')] }),
    );
    act(() => {
      screen = renderScreen();
    });
    await settle();

    expect(texts().some(t => t.startsWith('目录较大'))).toBe(true);

    await act(async () => {
      screen!.root
        .findAll(node => typeof node.props.onPress === 'function')
        .find(node => {
          const label = node.findAllByType(Text).map(t => String(t.props.children)).join('');
          return label === '加载完整目录';
        })!
        .props.onPress();
    });
    await settle();

    expect(mockedLoad).toHaveBeenLastCalledWith('project-1', '/work/p', 1000);
    expect(texts().some(t => t.startsWith('已显示前'))).toBe(true);
  });

  test('#2 展开子目录失败:只弹 toast,整棵列表不被错误卡替换', async () => {
    mockedLoad.mockImplementation((_pid, path) =>
      path === '/work/p/sub'
        ? Promise.reject(new Error('permission denied'))
        : Promise.resolve(
            listSnapshot({
              entries: [
                entry('d1', 'sub', 'directory', '/work/p/sub'),
                entry('f1', 'app.ts', 'file', '/work/p/app.ts'),
              ],
            }),
          ),
    );
    const toastSpy = jest.spyOn(useToastStore.getState(), 'show');

    act(() => {
      screen = renderScreen();
    });
    await settle();

    await act(async () => {
      screen!.root.findByProps({ testID: 'file-row-chevron-project-1:/work/p/sub' }).props.onPress();
    });
    await settle();

    expect(toastSpy).toHaveBeenCalledWith(expect.anything(), 'error');
    // 全局错误卡没出现,列表两行都还在。
    expect(texts().some(t => t.startsWith('加载失败'))).toBe(false);
    expect(texts()).toContain('sub/');
    expect(texts()).toContain('app.ts');
    toastSpy.mockRestore();
  });

  test('#2 读文件失败:错误卡出现在 sheet 内且带重试,背后列表原样', async () => {
    mockedRead.mockRejectedValue(new Error('disk on fire'));

    act(() => {
      screen = renderScreen();
    });
    await settle();

    await act(async () => {
      screen!.root.findByProps({ testID: 'file-row-project-1:/work/p/app.ts' }).props.onPress();
    });
    await settle();

    expect(mockedRead).toHaveBeenCalledTimes(1);
    expect(texts().some(t => t.includes('disk on fire'))).toBe(true);
    expect(texts()).toContain('重试读取');
    // 背后的列表没有被全局错误卡顶掉。
    expect(texts()).toContain('app.ts');

    mockedRead.mockResolvedValue({
      project_id: 'project-1',
      device_id: 'device-1',
      path: '/work/p/app.ts',
      content: 'ok',
      encoding: 'utf8',
      size_bytes: 2,
      truncated: false,
    });
    await act(async () => {
      screen!.root
        .findAll(node => typeof node.props.onPress === 'function')
        .find(node => {
          const label = node.findAllByType(Text).map(t => String(t.props.children)).join('');
          return label === '重试读取';
        })!
        .props.onPress();
    });
    await settle();

    expect(mockedRead).toHaveBeenCalledTimes(2);
    expect(texts().some(t => t.includes('disk on fire'))).toBe(false);
    expect(texts().some(t => t.includes('ok'))).toBe(true);
  });

  test('#4 回屏静默强制刷新当前目录(force:true)', async () => {
    act(() => {
      screen = renderScreen();
    });
    await settle();
    const callsAfterMount = mockedLoad.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    focusEffects.forEach(cb => cb());
    await settle();

    // force 消耗在 fileCache 内;transport 只收 maxEntries(undefined=默认 200)。
    expect(mockedLoad.mock.calls.length).toBeGreaterThan(callsAfterMount);
    const last = mockedLoad.mock.calls[mockedLoad.mock.calls.length - 1];
    expect(last).toEqual(['project-1', '/work/p', undefined]);
  });
});
