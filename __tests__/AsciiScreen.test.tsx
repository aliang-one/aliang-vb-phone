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

// 本地覆盖全局 gesture-handler mock（理由同 DrawingScreen 测试：全局只导出
// GestureHandlerRootView，画布需要 Gesture.Pan 的链式 API）。
// eslint-disable-next-line @typescript-eslint/ban-types
const mockGestureHandlers: Record<string, Function> = {};

jest.mock('react-native-gesture-handler', () => {
  const ReactInner = require('react');
  const { View } = require('react-native');
  const chain = () => {
    const gesture: Record<string, unknown> = {};
    for (const method of [
      'minDistance',
      'runOnJS',
      'onBegin',
      'onUpdate',
      'onEnd',
      'onFinalize',
    ]) {
      gesture[method] = (arg?: unknown) => {
        if (typeof arg === 'function') {
          mockGestureHandlers[method] = arg;
        }
        return gesture;
      };
    }
    return gesture;
  };
  return {
    GestureHandlerRootView: ReactInner.forwardRef(
      (props: Record<string, unknown>, ref: unknown) =>
        ReactInner.createElement(View, { ...props, ref }),
    ),
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    Gesture: { Pan: chain, Tap: chain, LongPress: chain },
  };
});

// 素材库是文件系统重活；这里只关心调用参数与返回值流转。
const mockAddAsset = jest.fn();
jest.mock('../src/services/attachmentLibrary', () => ({
  addAsset: (...args: unknown[]) => mockAddAsset(...(args as [])),
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
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
  text: '─',
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
 * 固定文本实测尺寸：默认 60×30 网格 → 每格 6×13.5。
 * 格宽/格高来自实测布局，不喂这个回调就只能按字号估算，坐标不好写死。
 */
const layoutCanvas = (renderer: ReactTestRenderer.ReactTestRenderer) => {
  const touchLayer = byTestID(renderer, 'ascii-canvas');
  act(() => {
    touchLayer.props.onLayout({
      nativeEvent: { layout: { width: 360, height: 405 } },
    });
  });
};

/** 默认工具是「文字」、默认字符是「─」：点一格就有一个非空格子。 */
const tapCell = async (x: number, y: number) => {
  const point = { x: x * 6 + 3, y: y * 13.5 + 6 };
  await act(async () => {
    mockGestureHandlers.onBegin?.(point);
    mockGestureHandlers.onEnd?.(point);
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
  for (const key of Object.keys(mockGestureHandlers)) {
    delete mockGestureHandlers[key];
  }
  mockAddAsset.mockReset();
  mockAddAsset.mockResolvedValue(fakeAsset);
  mockGoBack.mockReset();
  clearEditorHandoff();
});

describe('AsciiScreen 保存', () => {
  it('保存：裁剪后以 ascii 素材入库 → handoff(autoSend=false) → 返回', async () => {
    const renderer = await renderScreen();
    layoutCanvas(renderer);
    await tapCell(5, 7);

    await press(renderer, 'ascii-save');

    expect(mockAddAsset).toHaveBeenCalledWith({
      kind: 'ascii',
      // 单格内容裁完就是 1×1，四周空白不跟着发。
      text: '─',
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
    await tapCell(0, 0);

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
