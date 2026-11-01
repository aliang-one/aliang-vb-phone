/**
 * useForegroundReconciliation — 前台恢复边沿触发契约。
 *
 * 2026-11-01 RCA(手机会话被 TUI resume 接管后回答零展示):会话屏对账
 * 只挂 navigation focus,锁屏解锁/后台切回不触发,错过内容永不补拉。
 * 锁:①background→active 边沿恰好调一次 ②挂载时已 active 不触发
 * ③active→active(重复事件)不触发 ④卸载后 fire 不再打到死监听。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';

import { useForegroundReconciliation } from '../useForegroundReconciliation';

type AppStateChangeHandler = (state: string) => void;
let handlers: AppStateChangeHandler[] = [];
const originalStateDescriptor = Object.getOwnPropertyDescriptor(
  AppState,
  'currentState',
);

const Probe: React.FC<{ onForeground: () => void }> = ({ onForeground }) => {
  useForegroundReconciliation(onForeground);
  return null;
};

const fireAppState = (state: string): void => {
  for (const handler of handlers) handler(state);
};

describe('useForegroundReconciliation', () => {
  beforeEach(() => {
    handlers = [];
    // 真机冷启/挂载时 AppState.currentState 即 'active'(iOS 前台挂载);
    // jest 的 RN mock 初始值不定,显式钉住保证边沿判定从已知状态起步。
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      get: () => 'active',
    });
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(
        (((event: string, handler: AppStateChangeHandler) => {
          if (event === 'change') handlers.push(handler);
          return {
            remove: () => {
              handlers = handlers.filter(h => h !== handler);
            },
          };
        }) as unknown) as typeof AppState.addEventListener,
      );
  });

  afterEach(() => {
    if (originalStateDescriptor) {
      Object.defineProperty(AppState, 'currentState', originalStateDescriptor);
    }
    jest.restoreAllMocks();
  });

  it('background→active 边沿恰好触发一次', () => {
    const onForeground = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Probe onForeground={onForeground} />);
    });

    fireAppState('background');
    expect(onForeground).not.toHaveBeenCalled();
    fireAppState('active');
    expect(onForeground).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('挂载时已 active(冷启/首次挂载)不触发', () => {
    const onForeground = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Probe onForeground={onForeground} />);
    });

    fireAppState('active');
    expect(onForeground).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('active→active 重复事件不触发;inactive→active(来电/分屏)触发', () => {
    const onForeground = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Probe onForeground={onForeground} />);
    });

    fireAppState('active');
    fireAppState('active');
    expect(onForeground).not.toHaveBeenCalled();

    fireAppState('inactive');
    fireAppState('active');
    expect(onForeground).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('卸载后监听已摘除,fire 不再调用', () => {
    const onForeground = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Probe onForeground={onForeground} />);
    });
    act(() => {
      renderer.unmount();
    });

    fireAppState('background');
    fireAppState('active');
    expect(onForeground).not.toHaveBeenCalled();
    expect(handlers.length).toBe(0);
  });
});
