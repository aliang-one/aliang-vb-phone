/**
 * hydrateSessionHistory：设备就绪后连续按 cursor 拉页，直到历史摘要数达到
 * 预取目标(minItems)或服务端 has_more 结束；设备未就绪时不消费 cursor。
 */
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { platformTransport } from '../src/services/platformTransport';
import type { Device } from '../src/data/platformModels';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
    loadAiSessionsPage: jest.fn(),
  },
}));

const device = (): Device =>
  ({ id: 'd1', name: 'Mac', status: 'online' }) as unknown as Device;

const makeSession = (index: number, lastActive: string) => ({
  session_id: `ai_import_h${String(index).padStart(3, '0')}`,
  device_id: 'd1',
  status: 'closed',
  title: `session ${index}`,
  project_path: '/projects/foo',
  created_at: lastActive,
  last_active_at: lastActive,
});

const pageOf = (offset: number, hasMore: boolean) => ({
  items: Array.from({ length: 30 }, (_, i) =>
    makeSession(offset + i, '2026-09-30T00:00:00Z'),
  ),
  page: {
    limit: 30,
    count: 30,
    total_count: 100,
    has_more: hasMore,
    next_before_cursor: hasMore ? `cursor_${offset}` : undefined,
  },
});

describe('hydrateSessionHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useControlCenterStore.setState({
      serverMode: true,
      devices: [device()],
      aiSessionHistory: [],
      aiSessionHistoryPage: { initialized: false, loading: false, hasMore: true },
    });
  });

  it('loops cursor pages until the prefetch target is met', async () => {
    (platformTransport.loadAiSessionsPage as jest.Mock)
      .mockImplementationOnce((_options?: { before?: string }) =>
        Promise.resolve(pageOf(0, true)),
      )
      .mockImplementationOnce((options?: { before?: string }) => {
        expect(options?.before).toBe('cursor_0');
        return Promise.resolve(pageOf(30, true));
      })
      .mockImplementation(() => Promise.resolve(pageOf(60, false)));

    await useControlCenterStore
      .getState()
      .hydrateSessionHistory({ minItems: 40 });

    // 30+30=60 ≥ 40 即停（第三次页不应发起）
    expect(platformTransport.loadAiSessionsPage).toHaveBeenCalledTimes(2);
    expect(useControlCenterStore.getState().aiSessionHistory.length).toBe(60);
    expect(
      useControlCenterStore.getState().aiSessionHistoryPage.initialized,
    ).toBe(true);
  });

  it('stops cleanly when the server reports no more pages', async () => {
    (platformTransport.loadAiSessionsPage as jest.Mock)
      .mockImplementationOnce(() => Promise.resolve(pageOf(0, false)));

    await useControlCenterStore
      .getState()
      .hydrateSessionHistory({ minItems: 150 });

    expect(platformTransport.loadAiSessionsPage).toHaveBeenCalledTimes(1);
    expect(useControlCenterStore.getState().aiSessionHistory.length).toBe(30);
    expect(useControlCenterStore.getState().aiSessionHistoryPage.hasMore).toBe(
      false,
    );
  });

  it('passes deviceId to the transport and stamps the page', async () => {
    (platformTransport.loadAiSessionsPage as jest.Mock)
      .mockImplementation(options => {
        expect(options?.deviceId).toBe('dev-b');
        return Promise.resolve(pageOf(0, false));
      });

    await useControlCenterStore
      .getState()
      .hydrateSessionHistory({ minItems: 10, deviceId: 'dev-b' });

    expect(platformTransport.loadAiSessionsPage).toHaveBeenCalledTimes(1);
    expect(
      useControlCenterStore.getState().aiSessionHistoryPage.deviceId,
    ).toBe('dev-b');
  });

  it('switching device implicitly resets history and cursor', async () => {
    // 第一轮:dev-b 的历史已水合
    (platformTransport.loadAiSessionsPage as jest.Mock)
      .mockImplementationOnce(() => Promise.resolve(pageOf(0, false)));
    await useControlCenterStore
      .getState()
      .hydrateSessionHistory({ minItems: 10, deviceId: 'dev-b' });
    expect(useControlCenterStore.getState().aiSessionHistory.length).toBe(30);

    // 第二轮:切到 dev-a → 隐式重置(历史清空+首屏无 before)
    const calls: Array<{ before?: string; deviceId?: string }> = [];
    (platformTransport.loadAiSessionsPage as jest.Mock)
      .mockImplementationOnce(options => {
        calls.push(options ?? {});
        return Promise.resolve({
          items: [makeSession(900, '2026-10-02T00:00:00Z')],
          page: {
            limit: 30,
            count: 1,
            total_count: 1,
            has_more: false,
            next_before_cursor: undefined,
          },
        });
      });
    await useControlCenterStore
      .getState()
      .hydrateSessionHistory({ minItems: 10, deviceId: 'dev-a' });

    expect(calls.length).toBe(1);
    expect(calls[0].before).toBeUndefined();
    expect(calls[0].deviceId).toBe('dev-a');
    expect(useControlCenterStore.getState().aiSessionHistory.length).toBe(1);
    expect(useControlCenterStore.getState().aiSessionHistory[0].deviceId).toBe(
      'd1',
    );
  });

  it('does not consume the cursor while devices are empty', async () => {
    useControlCenterStore.setState({ devices: [] });

    await useControlCenterStore
      .getState()
      .hydrateSessionHistory({ minItems: 150 });

    expect(platformTransport.loadAiSessionsPage).not.toHaveBeenCalled();
    expect(
      useControlCenterStore.getState().aiSessionHistoryPage.initialized,
    ).toBe(false);
  });

  it('reset waits for an in-flight hydration then refetches page 1', async () => {
    let release1!: () => void;
    const gate = new Promise<void>(resolve => {
      release1 = resolve;
    });
    const calls: Array<{ before?: string }> = [];
    (platformTransport.loadAiSessionsPage as jest.Mock)
      .mockImplementationOnce(options => {
        calls.push(options ?? {});
        return gate.then(() => pageOf(0, true));
      })
      .mockImplementationOnce(options => {
        calls.push(options ?? {});
        return Promise.resolve(pageOf(30, false));
      });

    // p1=后台水合(在途);p2=下拉刷新的 reset——必须等待 p1 落地后重拉首屏,
    // 而不是被 loading 早退悄悄吞掉。
    const first = useControlCenterStore.getState().loadAiSessionHistory();
    const second = useControlCenterStore
      .getState()
      .loadAiSessionHistory({ reset: true });
    release1();
    await Promise.all([first, second]);

    expect(calls.length).toBe(2);
    expect(calls[0].before).toBeUndefined();
    expect(calls[1].before).toBeUndefined();
  });
});
