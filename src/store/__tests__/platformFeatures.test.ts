jest.mock('../../services/platformTransport', () => ({
  platformTransport: {
    loadSnapshot: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, getApiAuthToken: jest.fn() };
});

import { useControlCenterStore } from '../controlCenterStore';
import { emptySessionData } from '../internals';
import { platformTransport } from '../../services/platformTransport';
import { getApiAuthToken } from '../../api/client';

const mockedLoadSnapshot = platformTransport.loadSnapshot as jest.MockedFunction<
  typeof platformTransport.loadSnapshot
>;
const mockedGetAuthToken = getApiAuthToken as jest.MockedFunction<
  typeof getApiAuthToken
>;

const emptySnapshot = {
  devices: [],
  projects: [],
  aiSessions: [],
  terminalSessions: [],
  approvals: [],
  notifications: [],
  previewLinks: [],
  realtimeEvents: [],
  loadedAt: '2026-10-25T00:00:00Z',
  warnings: [],
};

// 账号门户开关（platformFeatures.accountPortalVisible）：server snapshot
// features.account_portal_visible 下发，严格 `=== true` 才展示；字段缺失
// （旧 server / 本地模式）默认隐藏——App Store 审核规避计费/套餐面。
describe('platform features (account portal visibility)', () => {
  beforeEach(() => {
    mockedLoadSnapshot.mockReset();
    mockedGetAuthToken.mockReset();
    mockedGetAuthToken.mockReturnValue('token');
    useControlCenterStore.setState({
      ...emptySessionData(),
      serverMode: true,
      stale: false,
      lastConnectError: null,
      lastSyncedAt: 1000,
    });
  });

  test('initial store state keeps the portal hidden', () => {
    expect(useControlCenterStore.getState().platformFeatures).toEqual({
      accountPortalVisible: false,
    });
  });

  test('snapshot features.account_portal_visible=true opts in to showing the sections', async () => {
    mockedLoadSnapshot.mockResolvedValue({
      ...emptySnapshot,
      features: { account_portal_visible: true },
    } as never);

    await useControlCenterStore.getState().refreshFromServer();

    expect(useControlCenterStore.getState().platformFeatures).toEqual({
      accountPortalVisible: true,
    });
  });

  test('a snapshot without features (old server) stays hidden', async () => {
    mockedLoadSnapshot.mockResolvedValue(emptySnapshot as never);

    await useControlCenterStore.getState().refreshFromServer();

    expect(useControlCenterStore.getState().platformFeatures).toEqual({
      accountPortalVisible: false,
    });
  });

  test('an explicit false stays hidden', async () => {
    mockedLoadSnapshot.mockResolvedValue({
      ...emptySnapshot,
      features: { account_portal_visible: false },
    } as never);

    await useControlCenterStore.getState().refreshFromServer();

    expect(useControlCenterStore.getState().platformFeatures).toEqual({
      accountPortalVisible: false,
    });
  });

  test('resetSessionData re-hides the portal (logout path)', async () => {
    mockedLoadSnapshot.mockResolvedValue({
      ...emptySnapshot,
      features: { account_portal_visible: true },
    } as never);
    await useControlCenterStore.getState().refreshFromServer();
    expect(useControlCenterStore.getState().platformFeatures.accountPortalVisible).toBe(true);

    useControlCenterStore.getState().resetSessionData();

    expect(useControlCenterStore.getState().platformFeatures).toEqual({
      accountPortalVisible: false,
    });
  });
});
