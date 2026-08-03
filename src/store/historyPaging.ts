import type { ServerCursorPageMeta } from '../api/pagination';
import type { HistoryPageState } from './types';

export const emptyHistoryPage = (): HistoryPageState => ({
  initialized: false,
  loading: false,
  hasMore: true,
});

export const historyPageFromServer = (
  page: ServerCursorPageMeta,
): HistoryPageState => ({
  initialized: true,
  loading: false,
  hasMore: page.has_more,
  nextBeforeCursor: page.next_before_cursor,
  totalCount: page.total_count,
});

export const mergeHistoryById = <T extends { id: string }>(
  incoming: T[],
  existing: T[],
): T[] => {
  const byId = new Map(existing.map(item => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, { ...byId.get(item.id), ...item });
  }
  return Array.from(byId.values());
};
