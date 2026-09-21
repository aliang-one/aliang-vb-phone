// Task 14 (TDD red): the file-download slice state machine + its wiring into
// the one-and-only WS dispatch point (`handleTransportEvent`). The wiring test
// deliberately dispatches a normalized transport event through the REAL
// dispatcher — calling `handleFileDownloadEvent` directly would pass even if
// the `case 'file_download'` route was never added (progress bar forever dead).
jest.mock('../../services/platformTransport', () => ({
  platformTransport: {
    loadSnapshot: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../../api/projects', () => ({
  ...jest.requireActual('../../api/projects'),
  startProjectFileDownload: jest.fn(),
  fetchProjectFileDownload: jest.fn(),
  cancelProjectFileDownload: jest.fn(),
}));

import {
  cancelProjectFileDownload,
  fetchProjectFileDownload,
  startProjectFileDownload,
  type FileDownloadStatus,
} from '../../api/projects';
import { ApiResponseError } from '../../api/client';
import { useControlCenterStore } from '../controlCenterStore';
import { phaseFromStatus } from '../slices/fileDownloadSlice';
import type { ControlCenterState } from '../types';
import type { PlatformFileDownloadStatus } from '../../services/platformTransport';

const mockedStart = startProjectFileDownload as jest.MockedFunction<
  typeof startProjectFileDownload
>;
const mockedFetch = fetchProjectFileDownload as jest.MockedFunction<
  typeof fetchProjectFileDownload
>;
const mockedCancel = cancelProjectFileDownload as jest.MockedFunction<
  typeof cancelProjectFileDownload
>;

const state = () => useControlCenterStore.getState();

const resetStore = () =>
  useControlCenterStore.setState({
    serverMode: true,
    fileDownloadActive: null,
    fileDownloadPhase: 'idle',
  } as Partial<ControlCenterState>);

const dispatch = (event: Parameters<ControlCenterState['handleTransportEvent']>[0]) =>
  useControlCenterStore.getState().handleTransportEvent(event);

const dispatchDownload = (download: PlatformFileDownloadStatus) =>
  dispatch({ type: 'file_download', download, raw: {} });

const seedActive = async (
  overrides?: Partial<{ requestId: string; status: FileDownloadStatus }>,
) => {
  mockedStart.mockResolvedValue(
    overrides?.status ?? {
      request_id: overrides?.requestId ?? 'rq-1',
      state: 'uploading',
      uploaded_bytes: 0,
      total_bytes: 2048,
    },
  );
  await state().startDownload('proj-1', 'src/main.ts', 'main.ts');
};

beforeEach(() => {
  jest.resetAllMocks();
  resetStore();
});

describe('phaseFromStatus (pure)', () => {
  it('maps server states onto client phases', () => {
    expect(phaseFromStatus('uploading')).toBe('uploading');
    expect(phaseFromStatus('ready')).toBe('ready');
    expect(phaseFromStatus('failed')).toBe('failed');
    expect(phaseFromStatus('completed')).toBe('idle');
    expect(phaseFromStatus('cancelled')).toBe('idle');
  });
});

describe('startDownload', () => {
  it('seeds a requesting active record, then flips to uploading with the 202 status', async () => {
    let resolveStart!: (status: FileDownloadStatus) => void;
    mockedStart.mockReturnValue(
      new Promise<FileDownloadStatus>(resolve => {
        resolveStart = resolve;
      }),
    );

    const pending = state().startDownload('proj-1', 'src/main.ts', 'main.ts');
    expect(mockedStart).toHaveBeenCalledWith('proj-1', 'src/main.ts');
    expect(state().fileDownloadPhase).toBe('requesting');
    expect(state().fileDownloadActive).toMatchObject({
      projectId: 'proj-1',
      path: 'src/main.ts',
      filename: 'main.ts',
      requestId: '',
    });

    resolveStart({
      request_id: 'rq-1',
      state: 'uploading',
      uploaded_bytes: 128,
      total_bytes: 2048,
    });
    await pending;

    expect(state().fileDownloadPhase).toBe('uploading');
    expect(state().fileDownloadActive).toMatchObject({
      requestId: 'rq-1',
      totalBytes: 2048,
      uploadedBytes: 128,
    });
  });

  it('re-pulls status once the 202 lands — pushes dropped while the POST was in flight are recovered', async () => {
    // The attribution guard drops every WS push that races the start POST
    // (requestId still ''). Once the 202 assigns the id, a single REST
    // reconcile must recover anything lost in that window.
    mockedStart.mockResolvedValue({
      request_id: 'rq-late',
      state: 'uploading',
      uploaded_bytes: 0,
      total_bytes: 4096,
    });
    mockedFetch.mockResolvedValue({
      request_id: 'rq-late',
      state: 'ready',
      uploaded_bytes: 4096,
      total_bytes: 4096,
      url: 'https://cos.example.com/late.ts',
    });

    await state().startDownload('proj-1', 'src/late.ts', 'late.ts');

    expect(mockedFetch).toHaveBeenCalledWith('proj-1', 'rq-late');
    expect(state().fileDownloadPhase).toBe('ready');
    expect(state().fileDownloadActive).toMatchObject({
      url: 'https://cos.example.com/late.ts',
      uploadedBytes: 4096,
    });
  });

  it('captures ApiError into markFailed so server error codes reach the sheet as reason', async () => {
    mockedStart.mockRejectedValue(
      new ApiResponseError(
        'Another download is already in progress',
        429,
        'download_in_progress',
      ),
    );

    await state().startDownload('proj-1', 'src/a.ts', 'a.ts');

    expect(state().fileDownloadPhase).toBe('failed');
    expect(state().fileDownloadActive).toMatchObject({
      projectId: 'proj-1',
      filename: 'a.ts',
      reason: 'Another download is already in progress',
    });
  });
});

describe('handleFileDownloadEvent', () => {
  it('ready stores the url and flips phase to ready', async () => {
    await seedActive();

    state().handleFileDownloadEvent({
      requestId: 'rq-1',
      state: 'ready',
      uploadedBytes: 2048,
      totalBytes: 2048,
      url: 'https://cos.example.com/main.ts?sign=x',
      expiresAt: '2026-09-21T00:00:00Z',
    });

    expect(state().fileDownloadPhase).toBe('ready');
    expect(state().fileDownloadActive).toMatchObject({
      url: 'https://cos.example.com/main.ts?sign=x',
      uploadedBytes: 2048,
      totalBytes: 2048,
    });
  });

  it('uploading events overwrite bytes idempotently — a repeat never resets progress to 0', async () => {
    await seedActive({
      status: { request_id: 'rq-1', state: 'uploading', uploaded_bytes: 512, total_bytes: 2048 },
    });

    state().handleFileDownloadEvent({ requestId: 'rq-1', state: 'uploading', uploadedBytes: 1024, totalBytes: 2048 });
    state().handleFileDownloadEvent({ requestId: 'rq-1', state: 'uploading', uploadedBytes: 1024, totalBytes: 2048 });

    expect(state().fileDownloadPhase).toBe('uploading');
    expect(state().fileDownloadActive).toMatchObject({ uploadedBytes: 1024, totalBytes: 2048 });
  });

  it('failed stores the reason and flips phase to failed', async () => {
    await seedActive();

    state().handleFileDownloadEvent({ requestId: 'rq-1', state: 'failed', reason: 'agent rpc timeout' });

    expect(state().fileDownloadPhase).toBe('failed');
    expect(state().fileDownloadActive?.reason).toBe('agent rpc timeout');
  });

  it('completed clears the active record back to idle', async () => {
    await seedActive();

    state().handleFileDownloadEvent({ requestId: 'rq-1', state: 'completed' });

    expect(state().fileDownloadActive).toBeNull();
    expect(state().fileDownloadPhase).toBe('idle');
  });

  it('cancelled clears the active record back to idle', async () => {
    await seedActive();

    state().handleFileDownloadEvent({ requestId: 'rq-1', state: 'cancelled' });

    expect(state().fileDownloadActive).toBeNull();
    expect(state().fileDownloadPhase).toBe('idle');
  });

  it('ignores events for a different requestId (stale push from an earlier download)', async () => {
    await seedActive();

    state().handleFileDownloadEvent({ requestId: 'rq-old', state: 'ready', url: 'https://cos/old' });

    expect(state().fileDownloadPhase).toBe('uploading');
    expect(state().fileDownloadActive?.url).toBeUndefined();
  });

  it('ignores events when no download is active', () => {
    state().handleFileDownloadEvent({ requestId: 'rq-ghost', state: 'ready', url: 'https://cos/ghost' });

    expect(state().fileDownloadActive).toBeNull();
    expect(state().fileDownloadPhase).toBe('idle');
  });

  it('does not regress saving/done phases on a late duplicate ready push (fields still merge)', async () => {
    await seedActive();
    state().handleFileDownloadEvent({ requestId: 'rq-1', state: 'ready', url: 'https://cos/main.ts' });
    state().markSaving();

    state().handleFileDownloadEvent({ requestId: 'rq-1', state: 'ready', url: 'https://cos/main.ts' });

    expect(state().fileDownloadPhase).toBe('saving');
    expect(state().fileDownloadActive?.url).toBe('https://cos/main.ts');
  });

  it('does not regress a ready phase on a late uploading push — ready is frozen too', async () => {
    await seedActive();
    state().handleFileDownloadEvent({
      requestId: 'rq-1',
      state: 'ready',
      uploadedBytes: 2048,
      totalBytes: 2048,
      url: 'https://cos/main.ts',
    });

    // A stale WS push (snapshot taken before the upload finished) reports the
    // old mid-upload phase and byte counter.
    state().handleFileDownloadEvent({ requestId: 'rq-1', state: 'uploading', uploadedBytes: 512, totalBytes: 2048 });

    expect(state().fileDownloadPhase).toBe('ready');
    expect(state().fileDownloadActive?.uploadedBytes).toBe(2048);
  });
});

describe('cancelDownload', () => {
  it('calls the DELETE api and lands on cancelled', async () => {
    await seedActive();
    mockedCancel.mockResolvedValue({ request_id: 'rq-1', state: 'cancelled' });

    await state().cancelDownload();

    expect(mockedCancel).toHaveBeenCalledWith('proj-1', 'rq-1');
    expect(state().fileDownloadActive).toBeNull();
    expect(state().fileDownloadPhase).toBe('cancelled');
  });
});

describe('refreshStatus (REST reconcile)', () => {
  it('reconciles a ready status via fetchProjectFileDownload', async () => {
    await seedActive();
    mockedFetch.mockResolvedValue({
      request_id: 'rq-1',
      state: 'ready',
      uploaded_bytes: 2048,
      total_bytes: 2048,
      url: 'https://cos.example.com/main.ts?sign=y',
    });

    await state().refreshStatus();

    expect(mockedFetch).toHaveBeenCalledWith('proj-1', 'rq-1');
    expect(state().fileDownloadPhase).toBe('ready');
    expect(state().fileDownloadActive?.url).toBe('https://cos.example.com/main.ts?sign=y');
  });

  it('resets on 404 — the request died with a server restart', async () => {
    await seedActive();
    mockedFetch.mockRejectedValue(new ApiResponseError('download not found', 404));

    await state().refreshStatus();

    expect(state().fileDownloadActive).toBeNull();
    expect(state().fileDownloadPhase).toBe('idle');
  });

  it('leaves WS-driven state untouched on transient errors', async () => {
    await seedActive();
    mockedFetch.mockRejectedValue(new ApiResponseError('server exploded', 503));

    await state().refreshStatus();

    expect(state().fileDownloadPhase).toBe('uploading');
    expect(state().fileDownloadActive).not.toBeNull();
  });

  it('does not fetch when no download is active', async () => {
    await state().refreshStatus();

    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('does not regress ready on a stale REST snapshot either — the reconcile shares the frozen guard', async () => {
    await seedActive();
    state().handleFileDownloadEvent({
      requestId: 'rq-1',
      state: 'ready',
      uploadedBytes: 2048,
      totalBytes: 2048,
      url: 'https://cos/main.ts',
    });
    // REST GET answered from a lagging replica: still says uploading at 100B.
    mockedFetch.mockResolvedValue({
      request_id: 'rq-1',
      state: 'uploading',
      uploaded_bytes: 100,
      total_bytes: 2048,
    });

    await state().refreshStatus();

    expect(state().fileDownloadPhase).toBe('ready');
    expect(state().fileDownloadActive?.uploadedBytes).toBe(2048);
  });
});

describe('handleTransportEvent wiring (the dispatcher route)', () => {
  it('routes file_download transport events into the slice — the WS path must actually land', async () => {
    await seedActive({ requestId: 'rq-w' });

    dispatchDownload({ requestId: 'rq-w', state: 'ready', uploadedBytes: 100, totalBytes: 100, url: 'https://cos/w' });

    expect(state().fileDownloadPhase).toBe('ready');
    expect(state().fileDownloadActive).toMatchObject({ url: 'https://cos/w', uploadedBytes: 100 });

    dispatchDownload({ requestId: 'rq-w', state: 'completed' });

    expect(state().fileDownloadActive).toBeNull();
    expect(state().fileDownloadPhase).toBe('idle');
  });
});
