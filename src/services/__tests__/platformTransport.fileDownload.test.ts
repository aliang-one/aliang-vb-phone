// Task 14 (TDD red): `file_download` server pushes must be normalized at the
// transport boundary — snake_case `download` payload → camelCase event member
// following the exact `preview.updated` pattern. `project_id` rides the server
// event but is deliberately dropped: the slice already knows the project from
// its own startDownload call.
type SocketHandler = (message: Record<string, unknown>) => void;

let socketHandler: SocketHandler | undefined;

jest.mock('../websocket', () => ({
  connectMobileSocket: jest.fn((handler: SocketHandler) => {
    socketHandler = handler;
    return { connected: true };
  }),
  disconnectMobileSocket: jest.fn(() => {
    socketHandler = undefined;
  }),
  getActiveSocket: jest.fn(() => ({ connected: true, send: jest.fn() })),
}));

jest.mock('../../api/client', () => ({
  ApiResponseError: class ApiResponseError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
  apiFetch: jest.fn(),
  apiGet: jest.fn(),
  apiPatch: jest.fn(),
  apiPost: jest.fn(),
}));

import { platformTransport } from '../platformTransport';

describe('platformTransport file_download normalization', () => {
  beforeEach(() => {
    socketHandler = undefined;
    jest.clearAllMocks();
  });

  afterEach(() => {
    platformTransport.disconnect();
  });

  it('normalizes a ready file_download push to camelCase (url/expiresAt carried, project_id dropped)', () => {
    const events: unknown[] = [];

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.({
      type: 'file_download',
      download: {
        request_id: 'rq-1',
        project_id: 'proj-1',
        state: 'ready',
        uploaded_bytes: 2048,
        total_bytes: 2048,
        url: 'https://cos.example.com/file.bin?sign=abc',
        expires_at: '2026-09-21T00:00:00Z',
      },
    });

    expect(events).toEqual([
      {
        type: 'file_download',
        download: {
          requestId: 'rq-1',
          state: 'ready',
          uploadedBytes: 2048,
          totalBytes: 2048,
          url: 'https://cos.example.com/file.bin?sign=abc',
          expiresAt: '2026-09-21T00:00:00Z',
          reason: undefined,
        },
        raw: {
          type: 'file_download',
          download: {
            request_id: 'rq-1',
            project_id: 'proj-1',
            state: 'ready',
            uploaded_bytes: 2048,
            total_bytes: 2048,
            url: 'https://cos.example.com/file.bin?sign=abc',
            expires_at: '2026-09-21T00:00:00Z',
          },
        },
      },
    ]);
  });

  it('normalizes a minimal uploading push — state defaults to uploading, optionals undefined', () => {
    const events: unknown[] = [];

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.({
      type: 'file_download',
      download: {
        request_id: 'rq-2',
        state: 'uploading',
      },
    });

    expect(events).toEqual([
      {
        type: 'file_download',
        download: {
          requestId: 'rq-2',
          state: 'uploading',
          uploadedBytes: undefined,
          totalBytes: undefined,
          url: undefined,
          expiresAt: undefined,
          reason: undefined,
        },
        raw: {
          type: 'file_download',
          download: {
            request_id: 'rq-2',
            state: 'uploading',
          },
        },
      },
    ]);
  });

  it('normalizes a failed push with its reason', () => {
    const events: unknown[] = [];

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.({
      type: 'file_download',
      download: {
        request_id: 'rq-3',
        state: 'failed',
        uploaded_bytes: 12,
        total_bytes: 100,
        reason: 'agent rpc timeout',
      },
    });

    expect(events).toEqual([
      {
        type: 'file_download',
        download: {
          requestId: 'rq-3',
          state: 'failed',
          uploadedBytes: 12,
          totalBytes: 100,
          url: undefined,
          expiresAt: undefined,
          reason: 'agent rpc timeout',
        },
        raw: {
          type: 'file_download',
          download: {
            request_id: 'rq-3',
            state: 'failed',
            uploaded_bytes: 12,
            total_bytes: 100,
            reason: 'agent rpc timeout',
          },
        },
      },
    ]);
  });

  it('degrades to raw when the download object is missing', () => {
    const events: unknown[] = [];

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.({ type: 'file_download' });

    expect(events).toEqual([{ type: 'raw', raw: { type: 'file_download' } }]);
  });
});
