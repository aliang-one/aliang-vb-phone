/**
 * 字符画页导出契约（Task 23 Step 1）。
 *
 * 保存链路：crop 去掉四周空白 → toText 导出 → addAsset(kind:'ascii') 入库
 * → editorHandoff → 返回会话页。字符画不走图片通道，所以这里断言的是
 * text/cols/rows 三个字段，而不是截图路径。
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';

// 画布手势已是 RN 原生 PanResponder（iOS 26 真机上 RNGH 回调不触发），
// 测试直接驱动 ascii-canvas 节点上的 responder 回调，无需 mock 手势库。

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

import { AsciiScreen } from '../src/screens/AsciiScreen';
import {
  clearEditorHandoff,
  takeEditorHandoff,
} from '../src/services/editorHandoff';

const fakeAsset = {
  id: 'asset-ascii-1',
  kind: 'ascii',
  text: '·',
  cols: 1,
  rows: 1,
  createdAt: 1,
  lastUsedAt: 1,
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
        <AsciiScreen />
      </Providers>,
    );
    await Promise.resolve();
  });
  return renderer!;
};

const byTestID = (
  renderer: ReactTestRenderer.ReactTestRenderer,
  testID: string,
) => renderer.root.findAll(node => node.props?.testID === testID)[0];

/**
 * 固定容器可用区域：默认 60×30 网格、容器 360×405 →
 * fontSize = min(352/60/0.6, 397/30/1.35) = 9.8 → 每格 5.88×13。
 * 触摸层显式定尺寸（iOS 测量全空格 Text 会把行尾空白剥掉、宽度塌 0）。
 */
const layoutCanvas = (renderer: ReactTestRenderer.ReactTestRenderer) => {
  const frame = byTestID(renderer, 'ascii-canvas-frame');
  act(() => {
    frame.props.onLayout({
      nativeEvent: { layout: { width: 360, height: 405 } },
    });
  });
};

/**
 * 默认工具是「自动」：按方向选字。点一格（同格起落）→ 圆点 → 非空格子。
 * touchHistory 按 RN 约定 1-indexed；PanResponder 的 move 有时间戳去重。
 */
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

const tapCell = async (
  renderer: ReactTestRenderer.ReactTestRenderer,
  x: number,
  y: number,
) => {
  const point = { x: x * 5.88 + 2.94, y: y * 13 + 6.5 };
  const responder = byTestID(renderer, 'ascii-canvas').props;
  await act(async () => {
    responder.onResponderGrant?.(touchEvent(point));
    responder.onResponderRelease?.(touchEvent(point));
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
  mockAddAsset.mockReset();
  mockAddAsset.mockResolvedValue(fakeAsset);
  mockGoBack.mockReset();
  clearEditorHandoff();
});

describe('AsciiScreen 保存', () => {
  it('保存：裁剪后以 ascii 素材入库 → handoff(autoSend=false) → 返回', async () => {
    const renderer = await renderScreen();
    layoutCanvas(renderer);
    await tapCell(renderer, 5, 7);

    await press(renderer, 'ascii-save');

    expect(mockAddAsset).toHaveBeenCalledWith({
      kind: 'ascii',
      // 单格内容裁完就是 1×1，四周空白不跟着发。
      text: '·',
      cols: 1,
      rows: 1,
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(takeEditorHandoff()).toEqual({ asset: fakeAsset, autoSend: false });

    act(() => renderer.unmount());
  });

  it('保存并发送：handoff(autoSend=true)', async () => {
    const renderer = await renderScreen();
    layoutCanvas(renderer);
    await tapCell(renderer, 0, 0);

    await press(renderer, 'ascii-save-send');

    expect(mockAddAsset).toHaveBeenCalledTimes(1);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(takeEditorHandoff()).toEqual({ asset: fakeAsset, autoSend: true });

    act(() => renderer.unmount());
  });

  it('空画布：不入库、不返回', async () => {
    const renderer = await renderScreen();

    await press(renderer, 'ascii-save');

    expect(mockAddAsset).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(takeEditorHandoff()).toBeNull();

    act(() => renderer.unmount());
  });
});
