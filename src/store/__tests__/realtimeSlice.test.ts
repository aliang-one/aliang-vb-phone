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
  loadedAt: '2026-07-12T00:00:00Z',
  warnings: [],
};

describe('refreshFromServer outcome', () => {
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

  test('returns {ok:true} on a successful snapshot refresh', async () => {
    mockedLoadSnapshot.mockResolvedValue(emptySnapshot as never);

    const result = (await useControlCenterStore.getState().refreshFromServer()) as {
      ok: boolean;
      error?: string;
    };

    expect(result).toEqual({ ok: true });
  });

  test('keeps cursor-loaded histories across a snapshot refresh', async () => {
    useControlCenterStore.setState({
      notificationHistory: [
        {
          id: 'history-notification',
          type: 'completed',
          title: 'Older completion',
          body: 'done',
          read: true,
          createdAt: '2026-07-01T00:00:00Z',
        },
      ],
      notificationHistoryPage: {
        initialized: true,
        loading: false,
        hasMore: true,
        nextBeforeCursor: 'older-cursor',
      },
    });
    mockedLoadSnapshot.mockResolvedValue(emptySnapshot as never);

    await useControlCenterStore.getState().refreshFromServer();

    expect(useControlCenterStore.getState().notificationHistory).toHaveLength(1);
    expect(useControlCenterStore.getState().notificationHistoryPage).toMatchObject({
      nextBeforeCursor: 'older-cursor',
    });
  });

  test('returns {ok:false, error} when the snapshot fetch fails', async () => {
    mockedLoadSnapshot.mockRejectedValue(new Error('snapshot boom'));

    const result = (await useControlCenterStore.getState().refreshFromServer()) as {
      ok: boolean;
      error?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/snapshot boom/);
  });

  test('returns {ok:false} with a connection error when not connected (noop)', async () => {
    useControlCenterStore.setState({ serverMode: false });
    mockedGetAuthToken.mockReturnValue(null);

    const result = (await useControlCenterStore.getState().refreshFromServer()) as {
      ok: boolean;
      error?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
