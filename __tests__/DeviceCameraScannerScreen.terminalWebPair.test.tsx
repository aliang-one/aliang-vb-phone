import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceCameraScannerScreen } from '../src/screens/devices/DeviceCameraScannerScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { ApiResponseError } from '../src/api/client';
import { scanLoginScan, scanLoginConfirm } from '../src/api/scanLogin';
import { approveTerminalWebPair } from '../src/api/terminalWebPair';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { Device } from '../src/data/platformModels';
import enDevices from '../src/i18n/locales/devices/en.json';
import zhDevices from '../src/i18n/locales/devices/zh.json';

const mockGoBack = jest.fn();
const mockIsFocused = jest.fn(() => true);

// 扫码屏 route 参数;undefined = 既有 scanLogin 缺省行为。
let mockRouteParams:
  | {
      mode?: 'scanLogin' | 'terminalWebPair';
      deviceId?: string;
      terminalId?: string;
      directory?: string;
    }
  | undefined = undefined;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => true,
    goBack: mockGoBack,
    navigate: jest.fn(),
  }),
  useIsFocused: () => mockIsFocused(),
  useRoute: () => ({ params: mockRouteParams }),
}));

// Capture the frame-processor callback so tests can emulate the scanner firing.
const mockScanner: {
  onCodeScanned?: (value?: string) => void;
} = {};

jest.mock('../src/screens/devices/DeviceCodeScanner', () => ({
  DeviceCodeScanner: (props: { onCodeScanned?: (value?: string) => void }) => {
    mockScanner.onCodeScanned = props.onCodeScanned;
    return null;
  },
}));

jest.mock('../src/api/scanLogin', () => ({
  ...jest.requireActual('../src/api/scanLogin'),
  scanLoginScan: jest.fn(),
  scanLoginConfirm: jest.fn(),
  scanLoginDeny: jest.fn(),
}));

// extractTerminalWebPair / TERMINAL_WEB_PAIR_HOST 走真实现(解析逻辑由 Task 10
// 的测试覆盖);只 mock 批准网络调用。
jest.mock('../src/api/terminalWebPair', () => ({
  ...jest.requireActual('../src/api/terminalWebPair'),
  approveTerminalWebPair: jest.fn(),
}));

// Render sheet children directly — the unit under test is the pair-mode flow,
// not the BottomSheet's Modal + reanimated chrome(与 ApprovalQuickPolicySheet
// 测试同款 mock;title 按真实组件语义渲染出来)。
jest.mock('../src/components/shared/BottomSheet', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    BottomSheet: (props: { open: boolean; title?: string; children: React.ReactNode }) =>
      props.open
        ? React.createElement(
            React.Fragment,
            null,
            props.title ? React.createElement(Text, null, props.title) : null,
            props.children,
          )
        : null,
  };
});

const mockedScan = scanLoginScan as jest.Mock;
const mockedConfirm = scanLoginConfirm as jest.Mock;
const mockedApprove = approveTerminalWebPair as jest.Mock;

const PAIR_QR = 'https://terminal.aliang.one/pair#pid=P1&s=S1';
const CONFIRM_TITLE = '允许网页访问此终端?';
const UNRECOGNIZED = '二维码无法识别,请扫描网页上的配对码';

function renderScreen() {
  // create 包进 act(仓内已知 workaround):挂载期的状态更新不再泄漏成
  // 「not wrapped in act」警告;异步收敛仍由调用方既有的 await act 完成。
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{
          theme: utilityMinimalist,
          isDark: false,
          mode: 'light',
          setMode: () => {},
        }}>
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 0, right: 0, bottom: 0, left: 0 },
          }}>
          <DeviceCameraScannerScreen />
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
  });
  return renderer;
}

function findAllText(
  root: ReactTestRenderer.ReactTestInstance,
  text: string,
): ReactTestRenderer.ReactTestInstance[] {
  return root.findAll(
    node => typeof node.props?.children === 'string' && node.props.children === text,
  );
}

const hasText = (root: ReactTestRenderer.ReactTestInstance, text: string) =>
  findAllText(root, text).length > 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findButton(root: ReactTestRenderer.ReactTestInstance, title: string): any {
  return root.findAll(
    node => node.props && node.props.title === title && node.props.onPress,
  )[0];
}

// 相机区浮层「重新扫描」是 TouchableOpacity+Text,没有 title prop——按文字
// 内容找可点击祖先(与既有 DeviceCameraScannerScreen.test 同法)。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findPressableByText(
  root: ReactTestRenderer.ReactTestInstance,
  text: string,
): any {
  const textNode = findAllText(root, text)[0];
  let node = textNode?.parent;
  while (node && !node.props?.onPress) {
    node = node.parent;
  }
  return node;
}

describe('DeviceCameraScannerScreen terminalWebPair 模式', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockScanner.onCodeScanned = undefined;
    mockRouteParams = undefined;
    mockedScan.mockResolvedValue({ status: 'scanned' });
    mockedConfirm.mockResolvedValue({ status: 'authorized' });
    mockedApprove.mockResolvedValue({ ok: true, terminal: { status: 'creating' } });
    useControlCenterStore.setState({
      refreshFromServer: jest.fn().mockResolvedValue(undefined),
      devices: [{ id: 'dev-1', name: 'MacBook Pro' } as unknown as Device],
    });
  });

  afterEach(() => {
    // 与相邻测试一致:unmount 包 act,消除卸载期状态更新警告。
    act(() => {
      screen?.unmount();
    });
    screen = undefined;
  });

  it('合法配对码:不调 scanLoginScan,进入确认弹窗并展示设备/目录/域名', async () => {
    mockRouteParams = {
      mode: 'terminalWebPair',
      deviceId: 'dev-1',
      terminalId: 't-9',
      directory: '~/work',
    };
    screen = renderScreen();
    await act(async () => {});

    await act(async () => {
      mockScanner.onCodeScanned?.(PAIR_QR);
      mockScanner.onCodeScanned?.(PAIR_QR); // 同码重复帧仍被在途守卫丢弃
    });

    expect(mockedScan).not.toHaveBeenCalled();
    expect(mockedApprove).not.toHaveBeenCalled();
    expect(hasText(screen.root, CONFIRM_TITLE)).toBe(true);
    expect(hasText(screen.root, 'MacBook Pro')).toBe(true);
    expect(hasText(screen.root, '~/work')).toBe(true);
    expect(hasText(screen.root, 'terminal.aliang.one')).toBe(true);
  });

  it('仿冒码/垃圾码:unrecognized 文案,停留 idle,零 API 调用', async () => {
    mockRouteParams = {
      mode: 'terminalWebPair',
      deviceId: 'dev-1',
      terminalId: 't-9',
      directory: '~/work',
    };
    screen = renderScreen();
    await act(async () => {});

    // hostname 仿冒(严格相等白名单拒绝)+ 非码垃圾串。
    await act(async () => {
      mockScanner.onCodeScanned?.('https://evil.example.com/pair#pid=X&s=Y');
    });
    await act(async () => {
      mockScanner.onCodeScanned?.('not-a-pair-qr');
    });

    expect(mockedScan).not.toHaveBeenCalled();
    expect(mockedApprove).not.toHaveBeenCalled();
    expect(hasText(screen.root, UNRECOGNIZED)).toBe(true);
    expect(hasText(screen.root, CONFIRM_TITLE)).toBe(false);

    // 仍处 idle(守卫未卡死):紧接着扫合法码可直接进入确认。
    await act(async () => {
      mockScanner.onCodeScanned?.(PAIR_QR);
    });
    expect(hasText(screen.root, CONFIRM_TITLE)).toBe(true);
  });

  it('terminalId 缺失:合法码也按 unrecognized 处理,不进确认态', async () => {
    // 调用方漏传 terminalId 时无法构成合法批准,前置拦截而非等服务端 400。
    mockRouteParams = {
      mode: 'terminalWebPair',
      deviceId: 'dev-1',
      directory: '~/work',
    };
    screen = renderScreen();
    await act(async () => {});

    await act(async () => {
      mockScanner.onCodeScanned?.(PAIR_QR);
    });

    expect(mockedApprove).not.toHaveBeenCalled();
    expect(hasText(screen.root, UNRECOGNIZED)).toBe(true);
    expect(hasText(screen.root, CONFIRM_TITLE)).toBe(false);
  });

  it('确认成功:approve 以正确参数调用一次,success 文案,1.6s 后 goBack', async () => {
    jest.useFakeTimers();
    try {
      mockRouteParams = {
        mode: 'terminalWebPair',
        deviceId: 'dev-1',
        terminalId: 't-9',
        directory: '~/work',
      };
      screen = renderScreen();
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        mockScanner.onCodeScanned?.(PAIR_QR);
      });

      const allow = findButton(screen.root, '允许');
      expect(allow).toBeDefined();
      await act(async () => {
        allow.props.onPress();
        await Promise.resolve();
      });

      expect(mockedApprove).toHaveBeenCalledTimes(1);
      expect(mockedApprove).toHaveBeenCalledWith({
        pairingId: 'P1',
        secret: 'S1',
        terminalId: 't-9',
      });
      expect(hasText(screen.root, '已授权网页访问当前终端')).toBe(true);
      expect(mockGoBack).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(1600);
      });
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('确认 404(pairing_not_found):webPair.expired 文案', async () => {
    mockedApprove.mockRejectedValueOnce(
      new ApiResponseError('pairing_not_found', 404, 'pairing_not_found'),
    );
    mockRouteParams = {
      mode: 'terminalWebPair',
      deviceId: 'dev-1',
      terminalId: 't-9',
      directory: '~/work',
    };
    screen = renderScreen();
    await act(async () => {});

    await act(async () => {
      mockScanner.onCodeScanned?.(PAIR_QR);
    });
    const allow = findButton(screen.root, '允许');
    await act(async () => {
      allow.props.onPress();
    });

    expect(hasText(screen.root, '二维码已过期,请刷新网页后重试')).toBe(true);
    // 失败后守卫放开:浮层「重新扫描」可用。
    expect(findPressableByText(screen.root, '重新扫描')).toBeDefined();
  });

  it('确认 409(pairing_disconnected):webPair.pageDisconnected 文案', async () => {
    // 现实最高频失败:网页在 approve 前被关闭,server 推送通道已断。
    mockedApprove.mockRejectedValueOnce(
      new ApiResponseError('pairing_disconnected', 409, 'pairing_disconnected'),
    );
    mockRouteParams = {
      mode: 'terminalWebPair',
      deviceId: 'dev-1',
      terminalId: 't-9',
      directory: '~/work',
    };
    screen = renderScreen();
    await act(async () => {});

    await act(async () => {
      mockScanner.onCodeScanned?.(PAIR_QR);
    });
    const allow = findButton(screen.root, '允许');
    await act(async () => {
      allow.props.onPress();
    });

    expect(hasText(screen.root, '网页已断开,请刷新后重新扫码')).toBe(true);
  });

  it('拒绝:reset 回 idle,零 approve 调用', async () => {
    mockRouteParams = {
      mode: 'terminalWebPair',
      deviceId: 'dev-1',
      terminalId: 't-9',
      directory: '~/work',
    };
    screen = renderScreen();
    await act(async () => {});

    await act(async () => {
      mockScanner.onCodeScanned?.(PAIR_QR);
    });
    const deny = findButton(screen.root, '拒绝');
    expect(deny).toBeDefined();
    await act(async () => {
      deny.props.onPress();
    });

    expect(mockedApprove).not.toHaveBeenCalled();
    expect(hasText(screen.root, CONFIRM_TITLE)).toBe(false);

    // reset 清空在途守卫:同码可再次进入确认。
    await act(async () => {
      mockScanner.onCodeScanned?.(PAIR_QR);
    });
    expect(hasText(screen.root, CONFIRM_TITLE)).toBe(true);
  });
});

describe('devices.webPair i18n 奇偶', () => {
  it('en 与 zh 的 webPair key 集合一致', () => {
    const enKeys = Object.keys(
      (enDevices as { webPair: Record<string, string> }).webPair ?? {},
    ).sort();
    const zhKeys = Object.keys(
      (zhDevices as { webPair: Record<string, string> }).webPair ?? {},
    ).sort();
    expect(zhKeys).toEqual([
      'allow',
      'confirmTitle',
      'deny',
      'device',
      'directory',
      'domain',
      'expired',
      'pageDisconnected',
      'scanEntryLabel',
      'scanEntryShort',
      'success',
      'unrecognized',
    ]);
    expect(enKeys).toEqual(zhKeys);
  });
});
