/**
 * useSessionRescan — 触发+轮询确认。锁四件事:变化即停、409 短路不轮询、
 * 进行中去重、超时上限。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ApiResponseError } from '../../api/client';
import { useSessionRescan, type RescanOutcome } from '../useSessionRescan';
import {
  fetchProjectAiSessions,
  refreshProjectAiSessions,
} from '../../api/projects';

jest.mock('../../api/projects');

const mockedFetch =
  fetchProjectAiSessions as jest.MockedFunction<typeof fetchProjectAiSessions>;
const mockedRefresh =
  refreshProjectAiSessions as jest.MockedFunction<typeof refreshProjectAiSessions>;

// fixture 用真实线字段名(session_id / last_active_at),钉住 server 下发形状。
const list = (count: number, latest = '2026-10-25T00:00:00Z') => ({
  sessions: Array.from({ length: count }, (_, i) => ({
    session_id: `s${i + 1}`,
    last_active_at: latest,
  })),
  total_count: count,
});

type Api = { rescanning: boolean; rescan: () => Promise<RescanOutcome> };

const mount = (projectId: string | undefined, onPoll?: () => void) => {
  let api!: Api;
  const Harness: React.FC = () => {
    api = useSessionRescan(projectId, onPoll);
    return null;
  };
  act(() => {
    TestRenderer.create(<Harness />);
  });
  return api;
};

describe('useSessionRescan', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedFetch.mockClear();
    mockedRefresh.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('无 projectId:短路 error,不发任何请求', async () => {
    const api = mount(undefined);
    let outcome!: RescanOutcome;
    await act(async () => {
      outcome = await api.rescan();
    });
    expect(outcome).toBe('error');
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('检测到新会话:updated 停表,onPoll 每拍被调', async () => {
    mockedFetch
      .mockResolvedValueOnce(list(3) as never)
      .mockResolvedValue(list(4) as never);
    mockedRefresh.mockResolvedValue({ status: 'requested' });
    let polls = 0;
    const api = mount('p1', () => {
      polls += 1;
    });
    let outcome!: RescanOutcome;
    await act(async () => {
      const pending = api.rescan();
      await jest.advanceTimersByTimeAsync(1200);
      outcome = await pending;
    });
    expect(outcome).toBe('updated');
    expect(polls).toBe(1);
  });

  it('409 device_offline:不轮询,返回 agent-offline', async () => {
    mockedFetch.mockResolvedValue(list(3) as never);
    mockedRefresh.mockRejectedValue(
      new ApiResponseError('device_offline', 409, 'device_offline'),
    );
    const api = mount('p1');
    let outcome!: RescanOutcome;
    await act(async () => {
      outcome = await api.rescan();
    });
    expect(outcome).toBe('agent-offline');
    expect(mockedFetch).toHaveBeenCalledTimes(1); // 仅基线一拍
  });

  it('六拍无变化:timeout,fetch 共 7 次(基线+6)', async () => {
    mockedFetch.mockResolvedValue(list(3) as never);
    mockedRefresh.mockResolvedValue({ status: 'requested' });
    const api = mount('p1');
    let outcome!: RescanOutcome;
    await act(async () => {
      const pending = api.rescan();
      for (let i = 0; i < 6; i += 1) {
        await jest.advanceTimersByTimeAsync(1200);
      }
      outcome = await pending;
    });
    expect(outcome).toBe('timeout');
    expect(mockedFetch).toHaveBeenCalledTimes(7);
  });

  it('进行中去重:第二轮询直接短路', async () => {
    // 只有基线 fetch 慢(500ms):第一轮 rescan 停在基线等待中时第二轮触发。
    // 轮询拍立即返回,advance(8000) 覆盖 500+6×1200=7700 的完整时间线。
    mockedFetch
      .mockImplementationOnce(
        () =>
          new Promise(resolve =>
            setTimeout(() => resolve(list(3) as never), 500),
          ),
      )
      .mockResolvedValue(list(3) as never);
    mockedRefresh.mockResolvedValue({ status: 'requested' });
    const api = mount('p1');
    let first!: RescanOutcome;
    let second!: RescanOutcome;
    await act(async () => {
      const p1 = api.rescan();
      second = await api.rescan();
      // 第二次触发零新增 fetch(短路发生在任何请求之前)。
      expect(mockedFetch).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(8000);
      first = await p1;
    });
    expect(second).toBe('error');
    void first;
  });
});
