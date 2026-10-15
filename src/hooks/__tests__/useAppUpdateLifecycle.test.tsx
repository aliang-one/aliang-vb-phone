/**
 * useAppUpdateLifecycle — 检查更新的唯一自动触发面(2026-10-15 审计:此前
 * 零测试,App.tsx 挂载或 AppState 分支写坏不会有任何套件变红)。
 * 锁:①冷启延迟 4s 后自动检查一次 ②前台恢复走 maybeCheckOnForeground
 * (store 内 30 分钟节流)③卸载后订阅移除、延迟计时不再触发。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { useAppUpdateLifecycle } from '../useAppUpdateLifecycle';
import { useAppUpdateStore } from '../../store/appUpdateStore';

type AppStateChangeHandler = (state: string) => void;
let handlers: AppStateChangeHandler[] = [];

const checkNow = jest.fn(() => Promise.resolve());
const maybeCheckOnForeground = jest.fn();

const Probe: React.FC = () => {
  useAppUpdateLifecycle();
  return null;
};

describe('useAppUpdateLifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    handlers = [];
    checkNow.mockClear();
    maybeCheckOnForeground.mockClear();
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(
        (((event: string, handler: AppStateChangeHandler) => {
          if (event === 'change') handlers.push(handler);
          return {
            // remove 必须真摘除:卸载后 fire 不能再打到死监听上。
            remove: () => {
              handlers = handlers.filter(h => h !== handler);
            },
          };
        }) as unknown) as typeof AppState.addEventListener,
      );
    useAppUpdateStore.setState({
      checkNow: checkNow as never,
      maybeCheckOnForeground,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    useAppUpdateStore.setState({
      checkNow: (() => Promise.resolve()) as never,
      maybeCheckOnForeground: () => undefined,
    });
  });

  it('冷启延迟 4s 触发一次自动检查;前台恢复走节流入口;卸载后不再触发', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Probe />);
    });
    expect(checkNow).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_999);
    });
    expect(checkNow).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(checkNow).toHaveBeenCalledTimes(1);

    // 前台恢复:必须走 maybeCheckOnForeground(节流在 store 内)。
    expect(maybeCheckOnForeground).not.toHaveBeenCalled();
    await act(async () => {
      for (const h of handlers) h('active');
    });
    expect(maybeCheckOnForeground).toHaveBeenCalledTimes(1);
    // 前台恢复不再直接打 checkNow(节流会被绕过)。
    expect(checkNow).toHaveBeenCalledTimes(1);

    // 卸载:订阅移除,后台→前台不再触发;未触发的启动计时也必须被清理。
    act(() => {
      renderer.unmount();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
      for (const h of handlers) h('active');
    });
    expect(checkNow).toHaveBeenCalledTimes(1);
    expect(maybeCheckOnForeground).toHaveBeenCalledTimes(1);
  });
});
