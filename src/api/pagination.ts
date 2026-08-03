export interface ServerCursorPageMeta {
  limit: number;
  count: number;
  total_count: number;
  has_more: boolean;
  next_before_cursor?: string;
}

export interface ServerCursorPageResponse<T> {
  items: T[];
  page: ServerCursorPageMeta;
}

export const cursorPageQuery = (options?: {
  limit?: number;
  before?: string;
}): string => {
  const query = new URLSearchParams();
  query.set('limit', String(options?.limit ?? 30));
  if (options?.before) query.set('before', options.before);
  return query.toString();
};
