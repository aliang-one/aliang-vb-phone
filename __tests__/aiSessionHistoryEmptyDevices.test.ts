/**
 * loadAiSessionHistory 的归并按 state.devices 过滤 device_id,而游标无条件推进:
 * 设备列表未加载完(空数组)时消费一页 = 整页被丢 + 游标前进 → 该页会话在本次
 * 分页轮里漏段,直到 reset 重拉才补回(2026-10-02 复现)。修复:空设备时直接
 * 不拉,initialized 保持 false,设备就绪后由 focus/下拉按 reset 语义重试。
 */
import type { Device } from '../src/data/platformModels';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { platformTransport } from '../src/services/platformTransport';

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

const serverSession = () => ({
  session_id: 'ai_import_x',
  device_id: 'd1',
  status: 'closed',
  title: '检查app审核',
  project_path: '/projects/foo',
  created_at: '2026-09-30T14:13:00Z',
  last_active_at: '2026-09-30T14:13:00Z',
});

const page = (has_more = false) => ({
  items: [serverSession()],
  page: { limit: 30, count: 1, total_count: 1, has_more: has_more },
});

describe('loadAiSessionHistory does not consume a page while devices are empty', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('does not fetch and keeps initialized=false when devices list is empty', async () => {
    useControlCenterStore.setState({
      serverMode: true,
      devices: [],
      aiSessionHistory: [],
      aiSessionHistoryPage: { initialized: false, loading: false, hasMore: true },
    });

    await useControlCenterStore.getState().loadAiSessionHistory({ reset: true });

    expect(platformTransport.loadAiSessionsPage).not.toHaveBeenCalled();
    expect(
      useControlCenterStore.getState().aiSessionHistoryPage.initialized,
    ).toBe(false);
    expect(useControlCenterStore.getState().aiSessionHistory).toEqual([]);
  });

  it('fetches and merges normally once devices are loaded', async () => {
    (platformTransport.loadAiSessionsPage as jest.Mock).mockResolvedValue(page());
    useControlCenterStore.setState({
      serverMode: true,
      devices: [device()],
      aiSessionHistory: [],
      aiSessionHistoryPage: { initialized: false, loading: false, hasMore: true },
    });

    await useControlCenterStore.getState().loadAiSessionHistory({ reset: true });

    expect(platformTransport.loadAiSessionsPage).toHaveBeenCalledTimes(1);
    expect(
      useControlCenterStore.getState().aiSessionHistory.map(run => run.id),
    ).toEqual(['ai_import_x']);
    expect(
      useControlCenterStore.getState().aiSessionHistoryPage.initialized,
    ).toBe(true);
  });
});
