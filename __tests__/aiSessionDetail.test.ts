// Mock the HTTP layer first — jest hoists this above the imports below, so the
// `fetchAiSession` import already sees the mocked apiGet.
jest.mock('../src/api/client', () => ({
  apiGet: jest.fn().mockResolvedValue({}),
  apiPost: jest.fn().mockResolvedValue({}),
  apiPatch: jest.fn().mockResolvedValue({}),
  apiFetch: jest.fn().mockResolvedValue({}),
  ApiResponseError: class ApiResponseError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

import { mergeVibeRunSnapshot, serverAiSessionToVibeRun } from '../src/store/internals';
import type { VibeCodingRun } from '../src/data/platformModels';
import {
  createAiSession,
  fetchAiSession,
  interruptAiSession,
} from '../src/api/sessions';
import type { PlatformAiSessionSnapshot } from '../src/services/platformTransport';
import { ApiResponseError, apiGet, apiPost } from '../src/api/client';

const mockedApiGet = apiGet as jest.Mock;
const mockedApiPost = apiPost as jest.Mock;

// Build a minimal but valid AI session snapshot for mapping tests. Only the
// fields under test are varied per-case; everything else uses sane defaults so
// serverAiSessionToVibeRun's many `??` fallbacks don't obscure the assertions.
const baseSession = (overrides: Partial<PlatformAiSessionSnapshot> = {}) =>
  ({
    session_id: 'sess-1',
    kind: 'ai',
    user_id: 'user-1',
    device_id: 'device-1',
    status: 'idle',
    mode: 'vibe',
    title: 'Test session',
    last_active_at: '2026-06-18T10:00:00.000Z',
    created_at: '2026-06-18T09:00:00.000Z',
    ...overrides,
  }) as PlatformAiSessionSnapshot;

describe('serverAiSessionToVibeRun detail signalling', () => {
  it('surfaces detail_refresh.status as detailRefreshStatus', () => {
    const run = serverAiSessionToVibeRun(
      baseSession({ detail_refresh: { status: 'skipped_offline' } }),
      [],
      [],
    );
    expect(run.detailRefreshStatus).toBe('skipped_offline');
  });

  it('leaves detailRefreshStatus undefined when the payload omits detail_refresh', () => {
    const run = serverAiSessionToVibeRun(baseSession(), [], []);
    expect(run.detailRefreshStatus).toBeUndefined();
  });

  it('does NOT mark detailLoadedAt when transcript and events are empty arrays', () => {
    // Regression guard: an empty array is truthy in JS. The old
    // `session.transcript || session.events` form treated `[]` as "has detail"
    // and suppressed the chat screen's first-fetch, leaving it blank.
    const run = serverAiSessionToVibeRun(
      baseSession({ transcript: [], events: [] }),
      [],
      [],
    );
    expect(run.detailLoadedAt).toBeUndefined();
  });

  it('marks detailLoadedAt when the snapshot carries real transcript content', () => {
    const run = serverAiSessionToVibeRun(
      baseSession({
        transcript: [
          {
            id: 'm1',
            role: 'user',
            content: 'hi',
            timestamp: '2026-06-18T10:00:00.000Z',
          },
        ],
      }),
      [],
      [],
    );
    expect(run.detailLoadedAt).toBeTruthy();
    expect(run.transcript).toHaveLength(1);
  });

  it('labels claude_code sessions as Claude Code when no concrete model is set', () => {
    const run = serverAiSessionToVibeRun(
      baseSession({ provider: 'claude_code' as never }),
      [],
      [],
    );
    expect(run.model).toBe('Claude Code');
  });

  it('does not fabricate an agent/ai_* Git branch', () => {
    const run = serverAiSessionToVibeRun(
      baseSession({ session_id: 'ai_canonical', branch: undefined }),
      [],
      [],
    );
    expect(run.branch).toBe('');
  });
});

describe('createAiSession idempotency', () => {
  beforeEach(() => {
    mockedApiPost.mockClear();
  });
  afterEach(() => {
    mockedApiPost.mockClear();
  });

  it('forwards the stable client request id in the create body', async () => {
    await createAiSession({
      device_id: 'device-1',
      client_request_id: 'ai-create-123456',
      message: 'first message',
      provider: 'claudecode',
    });
    expect(mockedApiPost).toHaveBeenCalledWith(
      '/api/ai/sessions',
      expect.objectContaining({
        client_request_id: 'ai-create-123456',
        message: 'first message',
      }),
      { timeoutMs: 120000 },
    );
  });
});

describe('mergeVibeRunSnapshot status authority', () => {
  const run = (overrides: Partial<VibeCodingRun> = {}) =>
    ({
      id: 'sess-1',
      title: 'Test session',
      deviceId: 'device-1',
      projectId: 'project-1',
      directory: '/tmp/project',
      status: 'running',
      objective: '',
      model: 'Claude Code',
      currentStep: 'Waiting for AI response.',
      branch: 'agent/sess-1',
      lastActivityMs: 2_000,
      updatedAt: 'now',
      suggestions: [],
      transcript: [],
      events: [],
      structuredEvents: [],
      ...overrides,
    }) as VibeCodingRun;

  it('applies failed snapshots even when the phone optimistic timestamp is newer', () => {
    const merged = mergeVibeRunSnapshot(
      run({ status: 'running', lastActivityMs: 2_000 }),
      run({
        status: 'failed',
        currentStep: 'unsupported AI provider: claude_code',
        lastActivityMs: 1_000,
      }),
    );

    expect(merged.status).toBe('failed');
    expect(merged.currentStep).toBe('unsupported AI provider: claude_code');
  });

  it('still ignores stale non-error demotions from older snapshots', () => {
    const merged = mergeVibeRunSnapshot(
      run({ status: 'running', lastActivityMs: 2_000 }),
      run({ status: 'idle', lastActivityMs: 1_000 }),
    );

    expect(merged.status).toBe('running');
  });
});

describe('fetchAiSession refresh option', () => {
  beforeEach(() => {
    mockedApiGet.mockClear();
  });

  it('omits the query string by default', async () => {
    await fetchAiSession('sess-1');
    expect(mockedApiGet).toHaveBeenCalledWith('/api/ai/sessions/sess-1', {
      timeoutMs: 15000,
    });
  });

  it('appends ?refresh=true when refresh is requested', async () => {
    await fetchAiSession('sess-1', { refresh: true });
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/ai/sessions/sess-1?refresh=true',
      { timeoutMs: 15000 },
    );
  });

  it('shares concurrent requests for the same session and refresh mode', async () => {
    let resolveRequest!: (value: unknown) => void;
    mockedApiGet.mockReturnValueOnce(
      new Promise(resolve => {
        resolveRequest = resolve;
      }),
    );

    const first = fetchAiSession('sess-shared');
    const second = fetchAiSession('sess-shared');

    expect(mockedApiGet).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    resolveRequest(baseSession());
    await Promise.all([first, second]);
  });

  it('keeps forced refresh separate from a cache-first request', async () => {
    const cached = fetchAiSession('sess-modes');
    const refreshed = fetchAiSession('sess-modes', { refresh: true });

    expect(mockedApiGet).toHaveBeenCalledTimes(2);
    await Promise.all([cached, refreshed]);
  });
});

describe('interruptAiSession compatibility fallback', () => {
  afterEach(() => {
    mockedApiGet.mockReset();
    mockedApiGet.mockResolvedValue({});
    mockedApiPost.mockReset();
    mockedApiPost.mockResolvedValue({});
  });

  it('falls back to the legacy stop endpoint when interrupt is not deployed', async () => {
    const stoppedSession = baseSession({ status: 'paused' });
    mockedApiPost
      .mockRejectedValueOnce(new ApiResponseError('Not found', 404))
      .mockResolvedValueOnce({ status: 'paused', session: stoppedSession });

    const result = await interruptAiSession('sess-1');

    expect(result).toBe(stoppedSession);
    expect(mockedApiPost).toHaveBeenNthCalledWith(
      1,
      '/api/ai/sessions/sess-1/interrupt',
    );
    expect(mockedApiPost).toHaveBeenNthCalledWith(
      2,
      '/api/ai/sessions/sess-1/stop',
    );
  });

  it('refreshes the session when the legacy stop response has no snapshot', async () => {
    const refreshedSession = baseSession({ status: 'paused' });
    mockedApiPost
      .mockRejectedValueOnce(new ApiResponseError('Not found', 404))
      .mockResolvedValueOnce({ status: 'paused' });
    mockedApiGet.mockResolvedValueOnce(refreshedSession);

    const result = await interruptAiSession('sess-1');

    expect(result).toBe(refreshedSession);
    expect(mockedApiGet).toHaveBeenCalledWith('/api/ai/sessions/sess-1', {
      timeoutMs: 15000,
    });
  });
});
