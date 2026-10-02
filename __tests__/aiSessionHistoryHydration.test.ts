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
});
