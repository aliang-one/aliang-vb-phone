/**
 * useSessionCatchUp — 水位对账 hook 的触发与冷却契约。
 *
 * 修"对话未结束就退出、重进停在旧位置":重进(mount)与屏内快照计数推进
 * 时,用服务端权威 transcript_count 做数据比对,落后才触发增量 catch-up;
 * 失败进入 10s 冷却,成功/不落后零额外请求。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { useSessionCatchUp } from '../useSessionCatchUp';
import type { SessionCatchUpResult } from '../../../store/types';

jest.useFakeTimers();

const makeDeps = () => ({
  catchUp: jest
    .fn<Promise<SessionCatchUpResult>, [string, number]>()
    .mockResolvedValue({ mode: 'skipped', reason: 'fresh' }),
  fetchMeta: jest
    .fn<Promise<{ transcript_count?: number } | undefined>, [string]>()
    .mockResolvedValue(undefined),
});

let deps: ReturnType<typeof makeDeps>;

const drain = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const renderHook = (
  props: {
    sessionId: string | undefined;
    transcriptCount: number | undefined;
  },
  hookDeps: ReturnType<typeof makeDeps>,
) =>
  TestRenderer.create(
    React.createElement(() => {
      useSessionCatchUp({
        sessionId: props.sessionId,
        transcriptCount: props.transcriptCount,
        catchUpAgentMessages: hookDeps.catchUp,
        fetchServerSessionMeta: hookDeps.fetchMeta,
      });
      return null;
    }),
  );

beforeEach(() => {
  jest.clearAllTimers();
  deps = makeDeps();
});

describe('useSessionCatchUp', () => {
  it('mount 时拉服务端元数据并把 transcript_count 交给 catch-up', async () => {
    deps.fetchMeta.mockResolvedValue({ transcript_count: 5 });

    const renderer = renderHook(
      { sessionId: 's1', transcriptCount: 2 },
      deps,
    );
    await act(async () => {
      await drain();
    });

    expect(deps.fetchMeta).toHaveBeenCalledWith('s1');
    expect(deps.catchUp).toHaveBeenCalledWith('s1', 5);
    renderer.unmount();
  });

  it('元数据缺 transcript_count 时不触发(旧服务端兼容:两路触发源都无计数)', async () => {
    deps.fetchMeta.mockResolvedValue({});

    const renderer = renderHook(
      { sessionId: 's1', transcriptCount: undefined },
      deps,
    );
    await act(async () => {
      await drain();
    });

    expect(deps.catchUp).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('屏内快照计数推进时触发对账(WS 断档自愈路径)', async () => {
    const renderer = renderHook({ sessionId: 's1', transcriptCount: 2 }, deps);
    await act(async () => {
      await drain();
    });

    deps.fetchMeta.mockResolvedValue({ transcript_count: 7 });
    await act(async () => {
      renderer.update(
        React.createElement(() => {
          useSessionCatchUp({
            sessionId: 's1',
            transcriptCount: 7,
            catchUpAgentMessages: deps.catchUp,
            fetchServerSessionMeta: deps.fetchMeta,
          });
          return null;
        }),
      );
      await drain();
    });

    expect(deps.catchUp).toHaveBeenCalledWith('s1', 7);
    renderer.unmount();
  });

  it('catch-up 失败进入冷却:10s 内的重试不再发请求,冷却后恢复', async () => {
    deps.fetchMeta.mockResolvedValue({ transcript_count: 5 });
    deps.catchUp.mockRejectedValueOnce(new Error('network'));

    // 稳定组件类型 + 可变 props 容器:inline 箭头组件每次 createElement 都是
    // 新类型 → 卸载重挂 → refs 重置,冷却就测不到了。
    const propsHolder: { count: number | undefined } = { count: 2 };
    const Screen = () => {
      useSessionCatchUp({
        sessionId: 's1',
        transcriptCount: propsHolder.count,
        catchUpAgentMessages: deps.catchUp,
        fetchServerSessionMeta: deps.fetchMeta,
      });
      return null;
    };
    const renderer = TestRenderer.create(React.createElement(Screen));
    await act(async () => {
      await drain();
    });
    // mount 双触发:触发 2(store 计数 2,先发、吃掉 rejection)→ 进入冷却;
    // 触发 1(元数据 5)在冷却落盘前通过门 → 共 2 次。
    expect(deps.catchUp).toHaveBeenCalledTimes(2);

    // 冷却期内计数再推进 → 不重试(同一组件实例,refs 存活)
    propsHolder.count = 6;
    await act(async () => {
      renderer.update(React.createElement(Screen));
      await drain();
    });
    expect(deps.catchUp).toHaveBeenCalledTimes(2);

    // 冷却过后恢复
    await act(async () => {
      jest.advanceTimersByTime(10_001);
    });
    propsHolder.count = 7;
    await act(async () => {
      renderer.update(React.createElement(Screen));
      await drain();
    });
    expect(deps.catchUp).toHaveBeenCalledTimes(3);
    renderer.unmount();
  });

  it('无 sessionId(draft 屏)时不做任何事', async () => {
    const renderer = renderHook(
      { sessionId: undefined, transcriptCount: undefined },
      deps,
    );
    await act(async () => {
      await drain();
    });

    expect(deps.fetchMeta).not.toHaveBeenCalled();
    expect(deps.catchUp).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('refreshLatestCount 手动入口:重进 focus 时由会话屏复用已有 useFocusEffect 调用', async () => {
    deps.fetchMeta.mockResolvedValue({ transcript_count: 9 });
    let captured: (() => void) | undefined;
    const renderer = TestRenderer.create(
      React.createElement(() => {
        const { refreshLatestCount } = useSessionCatchUp({
          sessionId: 's1',
          transcriptCount: 2,
          catchUpAgentMessages: deps.catchUp,
          fetchServerSessionMeta: deps.fetchMeta,
        });
        captured = refreshLatestCount;
        return null;
      }),
    );
    await act(async () => {
      await drain();
    });

    deps.catchUp.mockClear();
    deps.fetchMeta.mockClear();
    await act(async () => {
      captured?.();
      await drain();
    });

    expect(deps.fetchMeta).toHaveBeenCalledTimes(1);
    expect(deps.catchUp).toHaveBeenCalledWith('s1', 9);
    renderer.unmount();
  });

  it('控制器对象跨重渲染身份稳定(会话屏把它放进 useFocusEffect 依赖,身份抖动 = 每帧重跑 effect)', async () => {
    const controllers: ReturnType<typeof useSessionCatchUp>[] = [];
    const propsHolder: { count: number | undefined } = { count: 2 };
    const Screen = () => {
      controllers.push(
        useSessionCatchUp({
          sessionId: 's1',
          transcriptCount: propsHolder.count,
          catchUpAgentMessages: deps.catchUp,
          fetchServerSessionMeta: deps.fetchMeta,
        }),
      );
      return null;
    };
    const renderer = TestRenderer.create(React.createElement(Screen));
    await act(async () => {
      await drain();
    });

    propsHolder.count = 3;
    await act(async () => {
      renderer.update(React.createElement(Screen));
      await drain();
    });

    expect(controllers.length).toBeGreaterThanOrEqual(2);
    expect(controllers[0]).toBe(controllers[controllers.length - 1]);
    renderer.unmount();
  });
});
