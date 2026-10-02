import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceTerminalScreen } from '../src/screens/devices/DeviceTerminalScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useControlCenterStore } from '../src/store/controlCenterStore';

// The AI-suggest hook is stubbed (与 DeviceTerminalScreen.test 同款): 这里只测
// 快捷键栏入口的渲染与导航接线,不测 STT/commandGen 机制。
const mockAi = {
  phase: 'idle' as 'idle' | 'recording' | 'generating' | 'error',
  chips: [] as Array<{ command: string; dangerous: boolean }>,
  liveCaption: '',
  liveStatus: '',
  errorText: '',
  textMode: false,
  voiceStatus: 'idle',
  startVoice: jest.fn(),
  stopVoice: jest.fn(),
  submitText: jest.fn(),
  retry: jest.fn(),
  clearChips: jest.fn(),
  dismissError: jest.fn(),
  openTextInput: jest.fn(),
  closeTextInput: jest.fn(),
  reset: jest.fn(),
};
jest.mock('../src/hooks/useAiCommandSuggestions', () => ({
  useAiCommandSuggestions: () => mockAi,
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockSetParams = jest.fn();

// 终端屏 route 参数:terminalId 缺省/存在两态都要测(入口守卫)。
let mockRouteParams: {
  deviceId: string;
  directory?: string;
  terminalId?: string;
} = {
  deviceId: 'device-1',
  directory: '~/route-dir',
  terminalId: 'term-1',
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => false,
    navigate: mockNavigate,
    goBack: mockGoBack,
    setParams: mockSetParams,
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

// 模拟器 mock:mockAutoRenderTerminal=false 时 onRendered 不触发 →
// terminalRendered 停 false → terminalInputEnabled=false(disabled 场景用)。
// bridge 必须带 fit:屏内 40ms 延迟 fit 定时器会直呼 terminalBridgeRef。
const mockTerminalSendText = jest.fn();
const mockTerminalFocus = jest.fn();
const mockTerminalFit = jest.fn();
let mockAutoRenderTerminal = true;
jest.mock('../src/components/terminal/TerminalEmulator', () => ({
  TerminalEmulator: ({
    terminalRef,
    onRendered,
  }: {
    terminalRef?: React.MutableRefObject<unknown>;
    onRendered?: () => void;
  }) => {
    const MockReact = require('react');
    const { View } = require('react-native');
    MockReact.useEffect(() => {
      if (mockAutoRenderTerminal) onRendered?.();
    }, []);
    if (terminalRef) {
      terminalRef.current = {
        sendText: mockTerminalSendText,
        focus: mockTerminalFocus,
        fit: mockTerminalFit,
      };
    }
    return MockReact.createElement(View, { testID: 'terminal-emulator' });
  },
}));

const seedStore = () => {
  useControlCenterStore.setState({
    serverMode: true,
    devices: [
      {
        id: 'device-1',
        name: 'MacBook',
        status: 'online',
        location: 'Desk',
        os: 'darwin',
        host: 'localhost',
        cpuLoad: 0,
        memLoad: 0,
        authorizedDirectories: ['~/project'],
        activePorts: [],
        projectIds: [],
        activeSessionIds: [],
        lastSeen: 'now',
        remoteTerminalEnabled: true,
        aiControlEnabled: true,
        capabilities: ['terminal'],
        tools: [],
        history: [],
      },
    ],
    terminalSessions: [
      {
        id: 'term-1',
        deviceId: 'device-1',
        // 与 route directory(~/route-dir)刻意不同:navigate 参数必须取
        // 终端会话自己的 directory,而非路由兜底值。
        directory: '~/project',
        shell: 'zsh',
        status: 'running',
        lines: [],
        createdAt: '2026-06-17T10:00:00.000Z',
        updatedAt: '2026-06-17T10:00:00.000Z',
      },
    ],
    terminalCommandHistory: {},
    // 带 terminalId 进屏会 attach:resolved no-op 即可。
    attachTerminalSession: jest.fn().mockResolvedValue('term-1'),
    loadTerminalCommandHistory: jest.fn().mockResolvedValue(undefined),
  });
};

// jest 锁 zh(jest.setup)。可见标签用短 key(34px 固定宽插槽放不下全句,
// 会被压成多行);读屏 accessibilityLabel 用完整句 scanEntryLabel。
const SCAN_ENTRY_SHORT = '扫码';
const SCAN_ENTRY_LABEL = '扫码投屏';

describe('DeviceTerminalScreen 快捷键栏网页扫码入口', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | null;

  beforeEach(() => {
    screen = null;
    mockAutoRenderTerminal = true;
    mockRouteParams = {
      deviceId: 'device-1',
      directory: '~/route-dir',
      terminalId: 'term-1',
    };
    seedStore();
    jest.clearAllMocks();
    mockAi.phase = 'idle';
    mockAi.chips = [];
    mockAi.liveCaption = '';
    mockAi.liveStatus = '';
    mockAi.errorText = '';
    mockAi.textMode = false;
    mockAi.voiceStatus = 'idle';
  });

  afterEach(() => {
    act(() => {
      screen?.unmount();
    });
    screen = null;
  });

  const renderScreen = async () => {
    await act(async () => {
      screen = ReactTestRenderer.create(
        <ThemeContext.Provider
          value={{
            theme: utilityMinimalist,
            mode: 'light',
            setMode: jest.fn(),
            isDark: false,
          }}
        >
          <SafeAreaProvider
            initialMetrics={{
              frame: { x: 0, y: 0, width: 390, height: 844 },
              insets: { top: 0, right: 0, bottom: 0, left: 0 },
            }}
          >
            <DeviceTerminalScreen />
          </SafeAreaProvider>
        </ThemeContext.Provider>,
      );
    });
    return screen!;
  };

  const root = () => screen!.root;
  const hasNode = (testID: string) => {
    try {
      return Boolean(root().findByProps({ testID }));
    } catch {
      return false;
    }
  };

  it('渲染入口按钮:存在、带 i18n 标签与无障碍语义', async () => {
    await renderScreen();

    expect(hasNode('terminal-key-webqr')).toBe(true);
    const entry = root().findByProps({ testID: 'terminal-key-webqr' });
    expect(entry.props.accessibilityRole).toBe('button');
    // 读屏用完整句 scanEntryLabel。
    expect(entry.props.accessibilityLabel).toBe(SCAN_ENTRY_LABEL);
    expect(entry.props.disabled).toBe(false);
    // 可见分组标签用短 key scanEntryShort(34px 插槽防换行)。
    expect(
      root()
        .findAllByType(Text)
        .some(node => node.props.children === SCAN_ENTRY_SHORT),
    ).toBe(true);
    // 短标签之外不得再出现全句(防标签误用回长文案换行)。
    expect(
      root()
        .findAllByType(Text)
        .some(node => node.props.children === SCAN_ENTRY_LABEL),
    ).toBe(false);
  });

  it('terminalInputEnabled=false 时入口禁用', async () => {
    // 模拟器不回报 onRendered → terminalRendered=false → 输入不可用。
    mockAutoRenderTerminal = false;
    await renderScreen();

    const entry = root().findByProps({ testID: 'terminal-key-webqr' });
    expect(entry.props.disabled).toBe(true);
    expect(entry.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });

  it('按下入口:以 terminalWebPair 模式精确导航到扫码屏一次', async () => {
    await renderScreen();

    const entry = root().findByProps({ testID: 'terminal-key-webqr' });
    act(() => {
      entry.props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('DeviceCameraScanner', {
      mode: 'terminalWebPair',
      deviceId: 'device-1',
      terminalId: 'term-1',
      directory: '~/project',
    });
  });

  it('守卫:device 缺失时无入口、零导航', async () => {
    // 路由指向不在 store 的设备:屏内 `if (!device)` 早退 NOT FOUND,入口
    // 不存在;press 守卫(`if (!device || !terminalId) return`)与之双保险。
    mockRouteParams = {
      deviceId: 'device-unknown',
      directory: '~/route-dir',
      terminalId: 'term-1',
    };
    await renderScreen();

    expect(hasNode('terminal-key-webqr')).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('守卫:terminalId 缺失(无终端会话)时无入口、零导航', async () => {
    // terminalId 缺失 → terminal=undefined → 整条浮动快捷键栏(含入口)
    // 不渲染;入口语义绑定「当前屏上这个终端会话」,无会话即无入口。
    mockRouteParams = {
      deviceId: 'device-1',
      directory: '~/route-dir',
    };
    // 空 terminalSessions:避免 resolve 路径复用 store 里的既有会话。
    useControlCenterStore.setState({
      terminalSessions: [],
      createTerminalSession: jest.fn().mockResolvedValue('term-new'),
    });
    await renderScreen();

    expect(hasNode('terminal-key-webqr')).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
