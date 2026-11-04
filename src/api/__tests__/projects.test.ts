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

import { apiGet, apiPost, apiPut, apiDelete } from '../client';
import {
  cancelProjectFileDownload,
  completeProjectFileDownload,
  fetchProjectFileDownload,
  startProjectFileDownload,
  writeProjectFileContent,
  type FileDownloadStatus,
} from '../projects';

const mockedGet = apiGet as jest.MockedFunction<typeof apiGet>;
const mockedPost = apiPost as jest.MockedFunction<typeof apiPost>;
const mockedPut = apiPut as jest.MockedFunction<typeof apiPut>;
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

const writeResult = {
  ok: true,
  path: 'src/a.ts',
  size_bytes: 12,
  sha256: 'abc123',
};

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset().mockResolvedValue(fullStatus as never);
  mockedPut.mockReset().mockResolvedValue(writeResult as never);
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

describe('writeProjectFileContent', () => {
  test('PUTs {path,content} to /api/projects/:id/files/content and passes the response through', async () => {
    mockedPut.mockResolvedValue(writeResult as never);

    const result = await writeProjectFileContent('proj-1', 'src/a.ts', 'hello');

    expect(mockedPut).toHaveBeenCalledTimes(1);
    expect(mockedPut).toHaveBeenCalledWith(
      '/api/projects/proj-1/files/content',
      { path: 'src/a.ts', content: 'hello' },
    );
    expect(result).toEqual(writeResult);
  });

  test('URL-encodes the project id', async () => {
    await writeProjectFileContent('proj 1', 'a.ts', 'x');

    expect(mockedPut).toHaveBeenCalledWith(
      '/api/projects/proj%201/files/content',
      { path: 'a.ts', content: 'x' },
    );
  });

  test('sends encoding when opts.encoding is provided', async () => {
    await writeProjectFileContent('proj-1', 'img.png', 'AAAA', {
      encoding: 'base64',
    });

    expect(mockedPut).toHaveBeenCalledWith(
      '/api/projects/proj-1/files/content',
      { path: 'img.png', content: 'AAAA', encoding: 'base64' },
    );
  });

  test('sends expected_sha256 when opts.expectedSha256 is provided', async () => {
    await writeProjectFileContent('proj-1', 'src/a.ts', 'next', {
      expectedSha256: 'deadbeef',
    });

    expect(mockedPut).toHaveBeenCalledWith(
      '/api/projects/proj-1/files/content',
      { path: 'src/a.ts', content: 'next', expected_sha256: 'deadbeef' },
    );
  });

  test('sends both opts together when provided', async () => {
    await writeProjectFileContent('proj-1', 'img.png', 'BBBB', {
      encoding: 'base64',
      expectedSha256: 'cafebabe',
    });

    expect(mockedPut).toHaveBeenCalledWith(
      '/api/projects/proj-1/files/content',
      {
        path: 'img.png',
        content: 'BBBB',
        encoding: 'base64',
        expected_sha256: 'cafebabe',
      },
    );
  });
});
