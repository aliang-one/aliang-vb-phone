import { useControlCenterStore } from '../src/store/controlCenterStore';
import { platformTransport } from '../src/services/platformTransport';
import type { Device } from '../src/data/platformModels';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(), loadSnapshot: jest.fn(), connect: jest.fn(),
    loadAiSessionsPage: jest.fn(),
  },
}));

const device = (): Device => ({ id: 'd1', name: 'Mac', status: 'online' }) as unknown as Device;
const pageOf = (offset: number, hasMore: boolean) => ({
  items: Array.from({ length: 30 }, (_, i) => ({
    session_id: `ai_import_h${String(offset + i).padStart(3, '0')}`,
    device_id: 'd1', status: 'closed', title: `s${offset + i}`,
    project_path: '/p', created_at: '2026-09-30T00:00:00Z', last_active_at: '2026-09-30T00:00:00Z',
  })),
  page: { limit: 30, count: 30, total_count: 100, has_more: hasMore, next_before_cursor: hasMore ? `c${offset}` : undefined },
});

it('debug', async () => {
  useControlCenterStore.setState({
    serverMode: true,
    devices: [device()],
    aiSessionHistory: [],
    aiSessionHistoryPage: { initialized: false, loading: false, hasMore: true },
  });
  (platformTransport.loadAiSessionsPage as jest.Mock).mockImplementation(options => {
    console.log('CALL options =', JSON.stringify(options), '| state =', JSON.stringify({
      deviceId: useControlCenterStore.getState().aiSessionHistoryPage.deviceId,
      initialized: useControlCenterStore.getState().aiSessionHistoryPage.initialized,
      hasMore: useControlCenterStore.getState().aiSessionHistoryPage.hasMore,
      historyLen: useControlCenterStore.getState().aiSessionHistory.length,
    }));
    return Promise.resolve(pageOf(0, false));
  });
  await useControlCenterStore.getState().hydrateSessionHistory({ minItems: 10, deviceId: 'dev-b' });
  console.log('FINAL', JSON.stringify({
    deviceId: useControlCenterStore.getState().aiSessionHistoryPage.deviceId,
    initialized: useControlCenterStore.getState().aiSessionHistoryPage.initialized,
    hasMore: useControlCenterStore.getState().aiSessionHistoryPage.hasMore,
    historyLen: useControlCenterStore.getState().aiSessionHistory.length,
  }));
});
