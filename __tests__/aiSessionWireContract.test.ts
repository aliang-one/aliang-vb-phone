/**
 * Cross-end wire contract: server `publicAiSession` (AliangPhoneServer) → phone
 * `VibeCodingRun` (serverAiSessionToVibeRun).
 *
 * Why this file exists: the server serializes the session one place
 * (`modules/ai/messages.ts publicAiSession`), the phone declares the wire shape
 * a second place (`api/sessions.ts ServerAiSession`), and maps it to a model a
 * third place (`store/internals.ts serverAiSessionToVibeRun`). Three TS types
 * hand-synced across two repos. The historical bug — "open a conversation, it's
 * blank until refresh" — was a silent semantic drift across these: the phone
 * re-inferred `detail_refresh.status` meaning inline, got it wrong for
 * `fresh+[]`, and stamped a "loaded" flag that froze the screen.
 *
 * This file is the phone-side source of truth for that contract. Each test
 * fixes a realistic wire payload (matching the server's snake_case output) and
 * pins the model semantics for the drift-prone fields. Every assertion carries
 * the historical bug it guards. If the server changes a field's meaning, the
 * fixture here is what must be consciously re-reviewed — that review is the
 * accident-prevention, not the types alone.
 *
 * Server fields referenced (publicAiSession + the detail route's `detail_refresh`):
 *   status, run_state, run_state_version, phase, detail_refresh.status,
 *   transcript_count, transcript[], purpose, source_session_id.
 */
import { serverAiSessionToVibeRun } from '../src/store/internals';
import { resolveDetailState, isAuthoritativeDetail } from '../src/store/sessionDetail';
import type { ServerAiSession } from '../src/api/sessions';

// Realistic wire payload matching server publicAiSession output. Only the
// contract-relevant fields are varied per case; everything else uses stable
// defaults so the mapping's `??` fallbacks don't hide drift.
const wire = (over: Partial<ServerAiSession>): ServerAiSession =>
  ({
    session_id: 'sess-1',
    kind: 'ai',
    user_id: 'u1',
    device_id: 'd1',
    status: 'idle',
    mode: 'vibe',
    purpose: 'chat',
    created_at: '2026-08-05T09:00:00Z',
    last_active_at: '2026-08-05T10:00:00Z',
    ...over,
  }) as ServerAiSession;

describe('wire contract — lifecycle authority (runDisplayPhase inputs)', () => {
  it('run_state + run_state_version 透传到 model(协议 v2 的权威源)', () => {
    const run = serverAiSessionToVibeRun(
      wire({ run_state: 'running', run_state_version: 7 }),
      [],
      [],
    );
    expect(run.runState).toBe('running');
    expect(run.runStateVersion).toBe(7);
  });

  it('服务端只在有 run_state 时发 version;缺失时 model 两者皆 undefined(老服务器降级)', () => {
    const run = serverAiSessionToVibeRun(wire({ run_state: undefined }), [], []);
    expect(run.runState).toBeUndefined();
    expect(run.runStateVersion).toBeUndefined();
  });
});

describe('wire contract — 服务端权威 phase(列表显 done 脱节修复)', () => {
  // 服务端 derivePhase 把 hasPendingApproval 排在 closed 之前,故审批期间裸 status
  // 是 idle/closed 但 phase 仍是 waiting_approval。手机必须保留 phase 给 runDisplayPhase。
  it('phase: waiting_approval 透传(即便裸 status 是 idle)', () => {
    const run = serverAiSessionToVibeRun(
      wire({ status: 'idle', phase: 'waiting_approval' }),
      [],
      [],
    );
    expect(run.phase).toBe('waiting_approval');
  });

  it('phase 缺失(老服务器)→ model phase undefined,交 deriveSessionPhase 兜底', () => {
    const run = serverAiSessionToVibeRun(wire({ phase: undefined }), [], []);
    expect(run.phase).toBeUndefined();
  });
});

describe('wire contract — detail_refresh 信号(detailLoadedAt bug 驱动)', () => {
  // detail_refresh 由详情路由附加(非 publicAiSession 本体)。它的 status 决定
  // resolveDetailState,是"打开空白直到刷新"根因。每种值都要正确透传。
  it('detail_refresh.status: skipped_offline → detailRefreshStatus(设备离线,历史不可达)', () => {
    const run = serverAiSessionToVibeRun(
      wire({ detail_refresh: { status: 'skipped_offline' } }),
      [],
      [],
    );
    expect(run.detailRefreshStatus).toBe('skipped_offline');
    expect(resolveDetailState({
      transcriptLength: run.transcript.length,
      transcriptCount: run.transcriptCount ?? 0,
      detailRefreshStatus: run.detailRefreshStatus,
    })).toEqual({ kind: 'offline' });
  });

  it('detail_refresh.status: failed → failed(请求出错)', () => {
    const run = serverAiSessionToVibeRun(
      wire({ detail_refresh: { status: 'failed', error: 'agent_timeout' } }),
      [],
      [],
    );
    expect(run.detailRefreshStatus).toBe('failed');
  });

  // 本次 bug 的核心 case:fresh + 空 transcript + 已知历史。
  it('detail_refresh.status: fresh + 空 transcript + transcript_count>0 → recoverable_empty(本次 bug)', () => {
    const run = serverAiSessionToVibeRun(
      wire({
        transcript: [],
        transcript_count: 5,
        detail_refresh: { status: 'fresh' },
      }),
      [],
      [],
    );
    expect(run.transcriptCount).toBe(5);
    const state = resolveDetailState({
      transcriptLength: run.transcript.length,
      transcriptCount: run.transcriptCount ?? 0,
      detailRefreshStatus: run.detailRefreshStatus,
    });
    expect(state).toEqual({ kind: 'recoverable_empty' });
    // 非权威 → hasDetail false → 屏幕继续自动重试(不冻结)。这就是修复。
    expect(isAuthoritativeDetail(state)).toBe(false);
  });
});

describe('wire contract — history-count 信号(空历史升级判定的依据)', () => {
  it('transcript_count 透传(即便 transcript 为空,元数据仍说有历史)', () => {
    const run = serverAiSessionToVibeRun(
      wire({ transcript: [], transcript_count: 12 }),
      [],
      [],
    );
    expect(run.transcript).toHaveLength(0);
    expect(run.transcriptCount).toBe(12);
  });

  it('transcript_count 缺失 → 回退到 transcript.length(老服务器兼容)', () => {
    const run = serverAiSessionToVibeRun(
      wire({
        transcript: [
          { id: 'm1', role: 'user', content: 'hi', timestamp: '2026-08-05T10:00:00Z' },
          { id: 'm2', role: 'assistant', content: 'yo', timestamp: '2026-08-05T10:00:01Z' },
        ],
      }),
      [],
      [],
    );
    expect(run.transcriptCount).toBe(2);
  });
});

describe('wire contract — 会话身份与状态映射', () => {
  it('status 映射:closed → completed(列表卡片 StatusChip 据此)', () => {
    const run = serverAiSessionToVibeRun(wire({ status: 'closed' }), [], []);
    // mapSessionStatus 把 closed 映射成 completed(VibeStatus)。
    expect(run.status).toBe('completed');
  });

  it('source_session_id 透传(Claude --resume 绑定)', () => {
    const run = serverAiSessionToVibeRun(
      wire({ source_session_id: 'claude-abc-123' }),
      [],
      [],
    );
    expect(run.sourceSessionId).toBe('claude-abc-123');
  });

  it('purpose: goal → model purpose goal(goal UI 仅此渲染)', () => {
    const run = serverAiSessionToVibeRun(wire({ purpose: 'goal' }), [], []);
    expect(run.purpose).toBe('goal');
  });
});
