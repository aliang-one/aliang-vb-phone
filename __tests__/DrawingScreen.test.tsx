/**
 * 手绘页导出契约（Task 21 Step 1）。
 *
 * 保存链路：captureRef 截画布 → addAsset(kind:'drawing') 入库 → 交给
 * editorHandoff → 返回会话页。这里验证「截图结果确实以 drawing 素材入库」
 * 与两个出口的 autoSend 标记；真实 PNG 是否非空由真机验证（Step 2）。
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';

// 画布手势已是 RN 原生 PanResponder（iOS 26 真机上 RNGH 回调不触发），
// 测试直接驱动 drawing-canvas 节点上的 responder 回调，无需 mock 手势库。
// 覆盖全局 view-shot mock，拿一个可断言的句柄。
const mockCaptureRef = jest.fn(() => Promise.resolve('file:///tmp/shot.png'));
jest.mock('react-native-view-shot', () => ({
  __esModule: true,
  captureRef: (...args: unknown[]) => mockCaptureRef(...(args as [])),
  releaseCapture: jest.fn(),
}));

// 素材库是文件系统重活；这里只关心调用参数与返回值流转。
const mockAddAsset = jest.fn();
jest.mock('../src/services/attachmentLibrary', () => ({
  addAsset: (...args: unknown[]) => mockAddAsset(...(args as [])),
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    setOptions: jest.fn(),
    goBack: mockGoBack,
    navigate: jest.fn(),
    canGoBack: () => true,
  }),
}));

import { DrawingScreen } from '../src/screens/DrawingScreen';
import {
  clearEditorHandoff,
  takeEditorHandoff,
} from '../src/services/editorHandoff';

const fakeAsset = {
  id: 'asset-drawing-1',
  kind: 'drawing',
  localPath: '/tmp/rnbu/documents/attachments/asset-drawing-1.png',
  createdAt: 1,
  lastUsedAt: 1,
  size: 1024,
};

const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeContext.Provider
    value={{
      theme: utilityMinimalist,
      mode: 'light',
      setMode: jest.fn(),
      isDark: false,
    }}>
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}>
      {children}
    </SafeAreaProvider>
  </ThemeContext.Provider>
);

const renderScreen = async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <Providers>
        <DrawingScreen />
      </Providers>,
    );
    await Promise.resolve();
  });
  return renderer!;
};

// 组合节点优先于 host 节点，Pressable 的 onPress 在组合层上。
const byTestID = (
  renderer: ReactTestRenderer.ReactTestRenderer,
  testID: string,
) => renderer.root.findAll(node => node.props?.testID === testID)[0];

/** 模拟画布布局回调（截图尺寸依赖它）。 */
const layoutCanvas = (
  renderer: ReactTestRenderer.ReactTestRenderer,
  width: number,
  height: number,
) => {
  const frame = renderer.root.findAll(
    node =>
      typeof node.props?.onLayout === 'function' &&
      node.props?.collapsable === false,
  )[0];
  act(() => {
    frame.props.onLayout({ nativeEvent: { layout: { width, height } } });
  });
};

/** 在画布上画一笔（responder 协议直驱），让画布上有内容可保存。
 *  touchHistory 按 RN 约定 1-indexed；PanResponder 的 move 有时间戳去重。 */
let fakeTouchClock = 0;
const touchEvent = (point: { x: number; y: number }) => {
  fakeTouchClock += 1;
  const stamp = fakeTouchClock;
  return {
    nativeEvent: { locationX: point.x, locationY: point.y },
    touchHistory: {
      mostRecentTimeStamp: stamp,
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 1,
      touchBank: [
        null,
        {
          touchActive: true,
          currentTimeStamp: stamp,
          previousTimeStamp: stamp,
          currentPageX: point.x,
          currentPageY: point.y,
          previousPageX: point.x,
          previousPageY: point.y,
        },
      ],
    },
  };
};

const drawOneStroke = async (renderer: ReactTestRenderer.ReactTestRenderer) => {
  const responder = byTestID(renderer, 'drawing-canvas').props;
  await act(async () => {
    responder.onResponderGrant?.(touchEvent({ x: 10, y: 10 }));
    responder.onResponderMove?.(touchEvent({ x: 40, y: 50 }));
    responder.onResponderRelease?.(touchEvent({ x: 80, y: 90 }));
  });
};

const press = async (
  renderer: ReactTestRenderer.ReactTestRenderer,
  testID: string,
) => {
  const target = byTestID(renderer, testID);
  await act(async () => {
    await target.props.onPress();
  });
};

beforeEach(() => {
  mockCaptureRef.mockClear();
  mockAddAsset.mockReset();
  mockAddAsset.mockResolvedValue(fakeAsset);
  mockGoBack.mockReset();
  clearEditorHandoff();
});

describe('DrawingScreen 保存', () => {
  it('保存：截图 → 以 drawing 素材入库 → handoff(autoSend=false) → 返回', async () => {
    const renderer = await renderScreen();
    layoutCanvas(renderer, 320.4, 480.6);
    await drawOneStroke(renderer);

    await press(renderer, 'drawing-save');

    expect(mockCaptureRef).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ format: 'png', result: 'tmpfile' }),
    );
    expect(mockAddAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'drawing',
        // file:// 前缀由 toLocalPath 剥掉，素材库只认本地路径。
        sourcePath: '/tmp/shot.png',
        // 画布尺寸四舍五入后随素材记录，发送时用于比例展示。
        width: 320,
        height: 481,
      }),
    );
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(takeEditorHandoff()).toEqual({ asset: fakeAsset, autoSend: false });

    act(() => renderer.unmount());
  });

  it('保存并发送：handoff(autoSend=true)', async () => {
    const renderer = await renderScreen();
    await drawOneStroke(renderer);

    await press(renderer, 'drawing-save-send');

    expect(mockAddAsset).toHaveBeenCalledTimes(1);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(takeEditorHandoff()).toEqual({ asset: fakeAsset, autoSend: true });

    act(() => renderer.unmount());
  });

  it('空画布：不截图、不入库、不返回', async () => {
    const renderer = await renderScreen();

    await press(renderer, 'drawing-save');

    expect(mockCaptureRef).not.toHaveBeenCalled();
    expect(mockAddAsset).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(takeEditorHandoff()).toBeNull();

    act(() => renderer.unmount());
  });
});
