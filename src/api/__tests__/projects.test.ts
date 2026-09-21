// File-download API layer tests. The client module is fully mocked so the
// assertions pin the HTTP verb + URL + body contract, not the transport.
jest.mock('../client', () => ({
  apiFetch: jest.fn(),
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  apiPatch: jest.fn(),
  apiPut: jest.fn(),
  apiDelete: jest.fn(),
}));

import { apiGet, apiPost, apiDelete } from '../client';
import {
  cancelProjectFileDownload,
  completeProjectFileDownload,
  fetchProjectFileDownload,
  startProjectFileDownload,
  type FileDownloadStatus,
} from '../projects';

const mockedGet = apiGet as jest.MockedFunction<typeof apiGet>;
const mockedPost = apiPost as jest.MockedFunction<typeof apiPost>;
const mockedDelete = apiDelete as jest.MockedFunction<typeof apiDelete>;

/** Compile-time contract lock: every documented field must keep its name/type. */
const fullStatus: FileDownloadStatus = {
  request_id: 'req-1',
  state: 'ready',
  uploaded_bytes: 12,
  total_bytes: 34,
  url: 'https://cos.example/obj?sig=1',
  expires_at: '2026-09-21T00:00:00Z',
  reason: 'ok',
};

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset().mockResolvedValue(fullStatus as never);
  mockedDelete.mockReset().mockResolvedValue(fullStatus as never);
});

describe('startProjectFileDownload', () => {
  test('POSTs {path} to /api/projects/:id/files/download and returns the status', async () => {
    const result = await startProjectFileDownload('proj-1', 'src/a.ts');

    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/projects/proj-1/files/download',
      { path: 'src/a.ts' },
    );
    expect(result).toEqual(fullStatus);
  });

  test('URL-encodes the project id', async () => {
    await startProjectFileDownload('proj 1', 'a b.ts');

    expect(mockedPost).toHaveBeenCalledWith(
      '/api/projects/proj%201/files/download',
      { path: 'a b.ts' },
    );
  });
});

describe('fetchProjectFileDownload', () => {
  test('GETs /api/projects/:id/files/download/:requestId', async () => {
    mockedGet.mockResolvedValue(fullStatus as never);

    const result = await fetchProjectFileDownload('proj-1', 'req-1');

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith(
      '/api/projects/proj-1/files/download/req-1',
    );
    expect(result).toEqual(fullStatus);
  });

  test('URL-encodes the request id', async () => {
    mockedGet.mockResolvedValue(fullStatus as never);

    await fetchProjectFileDownload('proj-1', 'req/1');

    expect(mockedGet).toHaveBeenCalledWith(
      '/api/projects/proj-1/files/download/req%2F1',
    );
  });
});

describe('cancelProjectFileDownload', () => {
  test('DELETEs /api/projects/:id/files/download/:requestId', async () => {
    const result = await cancelProjectFileDownload('proj-1', 'req-1');

    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith(
      '/api/projects/proj-1/files/download/req-1',
    );
    expect(result).toEqual(fullStatus);
  });
});

describe('completeProjectFileDownload', () => {
  test('POSTs to /api/projects/:id/files/download/:requestId/complete', async () => {
    const result = await completeProjectFileDownload('proj-1', 'req-1');

    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/projects/proj-1/files/download/req-1/complete',
    );
    expect(result).toEqual(fullStatus);
  });
});
