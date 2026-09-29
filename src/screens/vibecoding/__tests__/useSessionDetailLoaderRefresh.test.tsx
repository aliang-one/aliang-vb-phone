/**
 * useSessionDetailLoader.refreshLatest — 徽标刷新按钮的反馈与死线契约。
 *
 * 审计确认的三类缺陷在此钉死回归:
 * 1) 静默失败:服务端对 agent 超时/离线返回 HTTP 200 + 旧缓存页,
 *    detailRefreshStatus=failed/skipped_offline 必须转成 setDetailError 反馈;
 * 2) 死线缺失:apiGet 15s 只覆盖单次尝试(底层超时后会 re-discovery + 整轮
 *    重试,响应体阶段无 JS 超时),refreshLatest 需自有 Promise.race 死线;
 * 3) 陈旧会话写入:刷新中途切换会话,失败文案不得画到新会话上。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { TFunction } from 'i18next';

import {
  useSessionDetailLoader,
  type SessionDetailLoader,
} from '../useSessionDetailLoader';

jest.useFakeTimers();

const t = ((key: string) => key) as unknown as TFunction;

let latest: SessionDetailLoader;
const detailErrors: string[] = [];

const makeLoad = () => jest.fn<Promise<{ detailRefreshStatus?: string }>, [string, { refresh?: boolean }?]>();

const renderLoader = (targetSessionId: string | undefined, load: ReturnType<typeof makeLoad>) =>
  TestRenderer.create(
    React.createElement(() => {
      latest = useSessionDetailLoader({
        targetSessionId,
        detailState: undefined,
        // 非空转录 → hasDetail=true(压掉 mount 自动加载)、recoverable=false,
        // 隔离出被测的 refreshLatest 一条路径。
        transcriptLength: 3,
        wsConnected: true,
        deviceStatus: 'online',
        loadAgentSessionDetail: load,
        t,
        refreshing: false,
        setDetailError: (message: string) => detailErrors.push(message),
        detailError: '',
      });
      return null;
    }),
  );

const drain = async () => {
  // flush microtask queue without real timers (fake timers active)
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

beforeEach(() => {
  detailErrors.length = 0;
});

describe('refreshLatest — failed / skipped_offline feedback', () => {
  test('detail_refresh=failed → 显式失败反馈(旧缓存页静默展示回归)', async () => {
    const load = makeLoad();
    load.mockResolvedValue({ detailRefreshStatus: 'failed' });
    await act(async () => {
      renderLoader('s1', load);
    });
    await act(async () => {
      latest.refreshLatest();
      await drain();
    });
    expect(detailErrors).toContain('session.loading.refreshStaleFailed');
    expect(latest.refreshingLatest).toBe(false);
  });

  test('detail_refresh=skipped_offline → 设备离线反馈', async () => {
    const load = makeLoad();
    load.mockResolvedValue({ detailRefreshStatus: 'skipped_offline' });
    await act(async () => {
      renderLoader('s1', load);
    });
    await act(async () => {
      latest.refreshLatest();
      await drain();
    });
    expect(detailErrors).toContain('session.loading.refreshOffline');
  });

  test('fresh → 不产生错误反馈', async () => {
    const load = makeLoad();
    load.mockResolvedValue({ detailRefreshStatus: 'fresh' });
    await act(async () => {
      renderLoader('s1', load);
    });
    await act(async () => {
      latest.refreshLatest();
      await drain();
    });
    // refreshLatest 起手会 setDetailError('') 清空旧错 — 只看非空反馈。
    expect(detailErrors.filter(Boolean)).toEqual([]);
  });
});

describe('refreshLatest — deadline', () => {
  test('底层请求悬挂 → 20s 死线触发超时反馈并解除 spinner', async () => {
    const load = makeLoad();
    load.mockImplementation(() => new Promise(() => undefined));
    await act(async () => {
      renderLoader('s1', load);
    });
    let promise!: Promise<void>;
    await act(async () => {
      promise = latest.refreshLatest();
    });
    expect(latest.refreshingLatest).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(20000);
      await drain();
      await promise;
    });
    expect(detailErrors).toContain('session.loading.detailTimeout');
    expect(latest.refreshingLatest).toBe(false);
  });
});

describe('refreshLatest — stale session guard', () => {
  test('刷新中途切换会话 → 失败文案不画到新会话', async () => {
    let resolveLoad!: (value: { detailRefreshStatus?: string }) => void;
    const load = makeLoad();
    load.mockImplementation(
      () =>
        new Promise<{ detailRefreshStatus?: string }>(resolve => {
          resolveLoad = resolve;
        }),
    );
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = renderLoader('s1', load);
    });
    let promise!: Promise<void>;
    await act(async () => {
      promise = latest.refreshLatest();
    });
    // 切到 s2(ref 更新 targetSessionIdRef),然后旧请求才返回 failed。
    await act(async () => {
      renderer.update(
        React.createElement(() => {
          latest = useSessionDetailLoader({
            targetSessionId: 's2',
            detailState: undefined,
            transcriptLength: 3,
            wsConnected: true,
            deviceStatus: 'online',
            loadAgentSessionDetail: load,
            t,
            refreshing: false,
            setDetailError: (message: string) => detailErrors.push(message),
            detailError: '',
          });
          return null;
        }),
      );
    });
    await act(async () => {
      resolveLoad({ detailRefreshStatus: 'failed' });
      await drain();
      await promise;
    });
    expect(detailErrors).not.toContain('session.loading.refreshStaleFailed');
  });
});
