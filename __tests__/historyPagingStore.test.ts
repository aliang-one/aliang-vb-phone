jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    loadNotificationsPage: jest.fn(),
  },
}));

import { useControlCenterStore } from '../src/store/controlCenterStore';
import { emptySessionData } from '../src/store/internals';
import { platformTransport } from '../src/services/platformTransport';

const loadNotificationsPage =
  platformTransport.loadNotificationsPage as jest.MockedFunction<
    typeof platformTransport.loadNotificationsPage
  >;

const notification = (id: string, createdAt: string) => ({
  id,
  notification_id: id,
  user_id: 'user-1',
  type: 'completed' as const,
  title: id,
  body: `body-${id}`,
  read: false,
  created_at: createdAt,
});

describe('cursor-loaded notification history', () => {
  beforeEach(() => {
    loadNotificationsPage.mockReset();
    useControlCenterStore.setState({
      ...emptySessionData(),
      serverMode: true,
    });
  });

  it('uses the next cursor and de-duplicates overlapping pages', async () => {
    loadNotificationsPage
      .mockResolvedValueOnce({
        items: [
          notification('n3', '2026-08-01T03:00:00Z'),
          notification('n2', '2026-08-01T02:00:00Z'),
        ],
        page: {
          limit: 2,
          count: 2,
          total_count: 3,
          has_more: true,
          next_before_cursor: 'cursor-2',
        },
      })
      .mockResolvedValueOnce({
        items: [
          notification('n2', '2026-08-01T02:00:00Z'),
          notification('n1', '2026-08-01T01:00:00Z'),
        ],
        page: {
          limit: 2,
          count: 2,
          total_count: 3,
          has_more: false,
        },
      });

    await useControlCenterStore
      .getState()
      .loadNotificationHistory({ reset: true });
    await useControlCenterStore.getState().loadNotificationHistory();

    expect(loadNotificationsPage).toHaveBeenNthCalledWith(1, {
      limit: 30,
      before: undefined,
    });
    expect(loadNotificationsPage).toHaveBeenNthCalledWith(2, {
      limit: 30,
      before: 'cursor-2',
    });
    expect(
      useControlCenterStore.getState().notificationHistory.map(item => item.id),
    ).toEqual(['n3', 'n2', 'n1']);
    expect(
      useControlCenterStore.getState().notificationHistoryPage,
    ).toMatchObject({
      initialized: true,
      loading: false,
      hasMore: false,
      totalCount: 3,
    });
  });
});
