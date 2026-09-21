import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceCameraScannerScreen } from '../src/screens/devices/DeviceCameraScannerScreen';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { ApiResponseError } from '../src/api/client';
import {
  scanLoginScan,
  scanLoginConfirm,
} from '../src/api/scanLogin';
import { useControlCenterStore } from '../src/store/controlCenterStore';

const mockGoBack = jest.fn();
const mockIsFocused = jest.fn(() => true);

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => true,
    goBack: mockGoBack,
    navigate: jest.fn(),
  }),
  useIsFocused: () => mockIsFocused(),
}));

// Capture the frame-processor callback so tests can emulate the scanner firing
// repeatedly for a QR that stays in view (VisionCamera emits per frame, ~30fps).
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

const mockedScan = scanLoginScan as jest.Mock;
const mockedConfirm = scanLoginConfirm as jest.Mock;

function renderScreen() {
  return ReactTestRenderer.create(
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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findButton(root: ReactTestRenderer.ReactTestInstance, title: string): any {
  return root.findAll(
    node => node.props && node.props.title === title && node.props.onPress,
  )[0];
}

// 相机区的浮层「重新扫描」是 TouchableOpacity+Text,没有 title prop——按文字内容找可点击祖先。
function findPressableByText(
  root: ReactTestRenderer.ReactTestInstance,
  text: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const textNode = root.findAll(
    node => typeof node.props?.children === 'string' && node.props.children === text,
  )[0];
  let node = textNode?.parent;
  while (node && !node.props?.onPress) {
    node = node.parent;
  }
  return node;
}

describe('DeviceCameraScannerScreen 防双发', () => {
  let screen: ReactTestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockScanner.onCodeScanned = undefined;
    mockedScan.mockResolvedValue({ status: 'scanned' });
    mockedConfirm.mockResolvedValue({ status: 'authorized' });
    useControlCenterStore.setState({ refreshFromServer: jest.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => {
    screen?.unmount();
    screen = undefined;
  });

  it('同一秒内重复的扫码事件只发起一次 scanLoginScan（VisionCamera 逐帧回调）', async () => {
    screen = renderScreen();
    await act(async () => {});

    expect(mockScanner.onCodeScanned).toBeDefined();
    // 两个扫描事件在任意 Promise resolve 之前连续到达 —— 线上 409 复现路径。
    await act(async () => {
      mockScanner.onCodeScanned?.('sc_abc123');
      mockScanner.onCodeScanned?.('sc_abc123');
    });

    expect(mockedScan).toHaveBeenCalledTimes(1);
    expect(mockedScan).toHaveBeenCalledWith('sc_abc123');
  });

  it('确认登录按钮连点两次只发起一次 scanLoginConfirm', async () => {
    screen = renderScreen();
    await act(async () => {});

    await act(async () => {
      mockScanner.onCodeScanned?.('sc_abc123');
    });
    await act(async () => {});

    const confirm = findButton(screen.root, '确认登录');
    expect(confirm).toBeDefined();
    await act(async () => {
      confirm.props.onPress();
      confirm.props.onPress();
    });

    expect(mockedConfirm).toHaveBeenCalledTimes(1);
  });

  it('scan 失败后允许重新扫描（守卫必须被清除）', async () => {
    mockedScan.mockRejectedValueOnce(
      new ApiResponseError('scan code is not in a valid state', 409),
    );
    screen = renderScreen();
    await act(async () => {});

    await act(async () => {
      mockScanner.onCodeScanned?.('sc_dead');
    });
    expect(mockedScan).toHaveBeenCalledTimes(1);

    // 错后面板出现「重新扫描」按钮 → reset → 再扫一次必须放行。
    const rescan = findButton(screen.root, '重新扫描');
    expect(rescan).toBeDefined();
    await act(async () => {
      rescan.props.onPress();
    });
    await act(async () => {});

    await act(async () => {
      mockScanner.onCodeScanned?.('sc_fresh');
    });
    expect(mockedScan).toHaveBeenCalledTimes(2);
    expect(mockedScan).toHaveBeenLastCalledWith('sc_fresh');
  });

  it('reset 后旧请求的迟到失败不得打翻新一轮扫码（代际守卫）', async () => {
    let rejectA!: (e: unknown) => void;
    let resolveB!: (v: { status: string }) => void;
    mockedScan.mockImplementation((code: string) => {
      if (code === 'sc_AAA') {
        return new Promise((_, reject) => {
          rejectA = reject;
        });
      }
      return new Promise(resolve => {
        resolveB = resolve;
      });
    });
    screen = renderScreen();
    await act(async () => {});

    // 扫 A（在途）→ 浮层「重新扫描」reset → 扫 B（在途）
    await act(async () => {
      mockScanner.onCodeScanned?.('sc_AAA');
    });
    const rescanMid = findPressableByText(screen.root, '重新扫描');
    expect(rescanMid).toBeDefined();
    await act(async () => {
      rescanMid.props.onPress();
    });
    await act(async () => {
      mockScanner.onCodeScanned?.('sc_BBB');
    });

    // B 先成功，进入确认面板
    await act(async () => {
      resolveB({ status: 'scanned' });
    });
    expect(findButton(screen.root, '确认登录')).toBeDefined();

    // A 的 409 迟到：不得把 B 的确认面板打成错误面板
    await act(async () => {
      rejectA(new ApiResponseError('scan code is not in a valid state', 409));
    });
    expect(findButton(screen.root, '确认登录')).toBeDefined();
  });

  it('成功后点重新扫描会取消待触发的 goBack（防多弹一层导航栈）', async () => {
    jest.useFakeTimers();
    try {
      screen = renderScreen();
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        mockScanner.onCodeScanned?.('sc_OK');
      });
      await act(async () => {
        await Promise.resolve();
      });
      const confirm = findButton(screen.root, '确认登录');
      expect(confirm).toBeDefined();
      await act(async () => {
        confirm.props.onPress();
        await Promise.resolve();
      });

      // 成功面板的浮层「重新扫描」→ reset 必须连带取消 1600ms 的 goBack
      const rescan = findPressableByText(screen.root, '重新扫描');
      expect(rescan).toBeDefined();
      await act(async () => {
        rescan.props.onPress();
      });
      act(() => {
        jest.advanceTimersByTime(1600);
      });
      expect(mockGoBack).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
