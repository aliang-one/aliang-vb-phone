// Mock the HTTP layer first — jest hoists this above the imports below.
jest.mock('../src/api/client', () => ({
  apiGet: jest.fn().mockResolvedValue({
    session_id: 's1',
    messages: [],
    page: { limit: 60, count: 0, has_more: false },
  }),
  apiPost: jest.fn(),
  apiPatch: jest.fn(),
  apiFetch: jest.fn(),
  ApiResponseError: class ApiResponseError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { fetchAiSessionMessages } from '../src/api/sessions';
import { apiGet } from '../src/api/client';

const mockedApiGet = apiGet as jest.Mock;

// 跨仓契约(phone 半边):catch-up 锚点是客户端本地尾部的**裸消息 id**,必须
// 原样进 query(服务端按"解码失败→裸 id 回退"接受);连续翻页时回传的
// next_after_cursor 编码串同样原样透传。两半合起来钉死 cursor 契约。
describe('fetchAiSessionMessages — after 契约', () => {
  beforeEach(() => {
    mockedApiGet.mockClear();
  });

  it('裸消息 id 原样作为 after 上线', async () => {
    await fetchAiSessionMessages('s1', { limit: 60, after: 'msg_ABCDEF123456' });

    expect(mockedApiGet).toHaveBeenCalledTimes(1);
    const [url] = mockedApiGet.mock.calls[0];
    expect(url).toBe('/api/ai/sessions/s1/messages?limit=60&after=msg_ABCDEF123456');
  });

  it('服务端签发的编码游标原样透传(连续翻页)', async () => {
    const issuedCursor = 'eyJpZCI6Im00IiwidGltZXN0YW1wIjoiMjAyNiJ9';
    await fetchAiSessionMessages('s1', { limit: 60, after: issuedCursor });

    const [url] = mockedApiGet.mock.calls[0];
    expect(url).toBe(`/api/ai/sessions/s1/messages?limit=60&after=${issuedCursor}`);
  });
});
