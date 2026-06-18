// Mock the HTTP layer first — jest hoists this above the imports below, so the
// `fetchAiSession` import already sees the mocked apiGet.
jest.mock('../src/api/client', () => ({
  apiGet: jest.fn().mockResolvedValue({}),
  apiPost: jest.fn().mockResolvedValue({}),
  apiPatch: jest.fn().mockResolvedValue({}),
  apiFetch: jest.fn().mockResolvedValue({}),
  ApiResponseError: class ApiResponseError extends Error {},
}));

import { serverAiSessionToVibeRun } from '../src/store/internals';
import { fetchAiSession } from '../src/api/sessions';
import type { PlatformAiSessionSnapshot } from '../src/services/platformTransport';
import { apiGet } from '../src/api/client';

const mockedApiGet = apiGet as jest.Mock;

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
});

describe('fetchAiSession refresh option', () => {
  beforeEach(() => {
    mockedApiGet.mockClear();
  });

  it('omits the query string by default', async () => {
    await fetchAiSession('sess-1');
    expect(mockedApiGet).toHaveBeenCalledWith('/api/ai/sessions/sess-1');
  });

  it('appends ?refresh=true when refresh is requested', async () => {
    await fetchAiSession('sess-1', { refresh: true });
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/ai/sessions/sess-1?refresh=true',
    );
  });
});
