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
 *   transcript_count, transcript[], purpose, source_session_id, approval_mode.
 */
import {
  mergeVibeRunSnapshot,
  serverAiSessionToVibeRun,
} from '../src/store/internals';
import { resolveDetailState, isAuthoritativeDetail } from '../src/store/sessionDetail';
import type { ServerAiSession } from '../src/api/sessions';
import * as fs from 'fs';
import * as path from 'path';

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

describe('wire contract — 会话发起来源 origin(手机 vs 电脑 TUI)', () => {
  // server 侧 publicAiSession 现在带 origin('phone'|'tui'); 列表卡片据此给
  // TUI 会话挂「电脑发起」badge, 会话详情页的 TUI 共用横幅判据也迁移过来。
  // 老 server 不发 origin → 映射层按 ai_import_ 前缀兜底, 新 App 不退化。
  it("origin: 'tui' 透传(TUI 扫盘导入会话)", () => {
    const run = serverAiSessionToVibeRun(
      wire({ session_id: 'ai_import_abc', origin: 'tui' }),
      [],
      [],
    );
    expect(run.origin).toBe('tui');
  });

  it("origin: 'phone' 透传(手机发起会话)", () => {
    const run = serverAiSessionToVibeRun(wire({ origin: 'phone' }), [], []);
    expect(run.origin).toBe('phone');
  });

  it('origin 缺失(老 server)且 ai_import_ 前缀 → 前缀兜底 tui', () => {
    const run = serverAiSessionToVibeRun(
      wire({ session_id: 'ai_import_deadbeefcafe0123', origin: undefined }),
      [],
      [],
    );
    expect(run.origin).toBe('tui');
  });

  it('origin 缺失(老 server)且普通 id → 前缀兜底 phone', () => {
    const run = serverAiSessionToVibeRun(wire({ origin: undefined }), [], []);
    expect(run.origin).toBe('phone');
  });
});

describe('wire contract — approval_mode(内核审批挡位,手机端只读展示)', () => {
  // 概念区分(勿混淆):approval_mode 是内核审批挡位('' | 'ask_all' |
  // 'bypass_all',由 PhoneServer publicAiSession 恒带键下发),≠ approvalScheme
  // (allow_all/ask_all/read_only 会话权限策略,i18n 也分开)。客户端模型三态
  // 保留(2026-11-09 评审修正):'' 是合法显式值(桌面端切回默认),必须与缺键
  // (老 server → undefined = 未知)区分,否则合并守卫会把重置永远洗掉。
  it('bypass_all 透传(桌面端切到放过所有 → 手机只读展示同值)', () => {
    const run = serverAiSessionToVibeRun(
      wire({ approval_mode: 'bypass_all' }),
      [],
      [],
    );
    expect(run.approvalMode).toBe('bypass_all');
  });

  it('缺键(老 server)→ undefined(未知,展示按默认推荐)', () => {
    const run = serverAiSessionToVibeRun(
      wire({ approval_mode: undefined }),
      [],
      [],
    );
    expect(run.approvalMode).toBeUndefined();
  });

  it("空串三态保留('' = 显式默认推荐,不得坍缩 undefined——否则重置传不到手机)", () => {
    const run = serverAiSessionToVibeRun(wire({ approval_mode: '' }), [], []);
    expect(run.approvalMode).toBe('');
  });

  it('非法值 → undefined(未知;脏 wire 数据防御,运行时注入绕开类型)', () => {
    const dirty = wire({});
    (dirty as { approval_mode?: string }).approval_mode = 'yolo';
    const run = serverAiSessionToVibeRun(dirty, [], []);
    expect(run.approvalMode).toBeUndefined();
  });
});

describe('wire contract — approvalMode 合并守卫(部分快照缺键不得洗掉详情值)', () => {
  // 照 executor 先例:列表/重命名等部分快照不带 approval_mode,裸 spread 会把
  // 详情快照刚拿到的挡位洗掉,设置页闪变。守卫 = incoming 缺键(undefined)
  // 保留 existing;显式值含 '' 照常覆盖(?? 只放过 undefined/空值链,
  // '' 是合法显式值必须传播——桌面端切回默认靠它落到手机)。
  it("existing='bypass_all' + incoming 缺键 → 保留", () => {
    const existing = serverAiSessionToVibeRun(
      wire({ approval_mode: 'bypass_all' }),
      [],
      [],
    );
    const incoming = serverAiSessionToVibeRun(
      wire({ approval_mode: undefined }),
      [],
      [],
    );
    const merged = mergeVibeRunSnapshot(existing, incoming);
    expect(merged.approvalMode).toBe('bypass_all');
  });

  it("incoming='ask_all' → 覆盖(桌面端真实切换照常生效)", () => {
    const existing = serverAiSessionToVibeRun(
      wire({ approval_mode: 'bypass_all' }),
      [],
      [],
    );
    const incoming = serverAiSessionToVibeRun(
      wire({ approval_mode: 'ask_all' }),
      [],
      [],
    );
    const merged = mergeVibeRunSnapshot(existing, incoming);
    expect(merged.approvalMode).toBe('ask_all');
  });

  it("incoming='' → 覆盖回默认推荐(桌面端切回默认必须传播,不得困在旧挡位)", () => {
    const existing = serverAiSessionToVibeRun(
      wire({ approval_mode: 'bypass_all' }),
      [],
      [],
    );
    const incoming = serverAiSessionToVibeRun(
      wire({ approval_mode: '' }),
      [],
      [],
    );
    const merged = mergeVibeRunSnapshot(existing, incoming);
    expect(merged.approvalMode).toBe('');
  });
});

// --- 真正的跨端 golden contract: 读服务端 publicAiSession 的实际输出 ---

const GOLDEN_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'AliangPhoneServer',
  'server',
  'test',
  'fixtures',
  'publicAiSession.golden.json',
);

describe('跨端 golden contract (服务端真实 publicAiSession 输出)', () => {
  const goldenAvailable = fs.existsSync(GOLDEN_PATH);

  const goldenIt = goldenAvailable ? it : it.skip;
  goldenIt(
    'golden payload 经 serverAiSessionToVibeRun 映射出正确的 VibeCodingRun',
    () => {
      const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as ServerAiSession;
      const run = serverAiSessionToVibeRun(golden, [], []);

      // 服务端 golden 的关键字段经映射后保持语义
      expect(run.id).toBe(golden.session_id);
      expect(run.status).toBeDefined();
      // runState/runStateVersion 透传(lifecycle 权威源)
      if (golden.run_state !== undefined) {
        expect(run.runState).toBe(golden.run_state);
      }
      if (golden.run_state_version !== undefined) {
        expect(run.runStateVersion).toBe(golden.run_state_version);
      }
      // phase 透传(列表显 done 脱节修复)
      if (golden.phase !== undefined) {
        expect(run.phase).toBe(golden.phase);
      }
      // transcript_count 透传(空历史升级信号)
      expect(run.transcriptCount).toBe(golden.transcript_count);
      // approval_mode 透传(审批挡位跨端展示):golden 是服务端 publicAiSession
      // 的真实输出,此处断言三态原样穿过映射,空串不得被折叠成 undefined
      if (golden.approval_mode !== undefined) {
        expect(run.approvalMode).toBe(golden.approval_mode);
      }
      // 有内容 → detailState ready
      if ((golden.transcript_count ?? 0) > 0) {
        expect(run.detailState).toEqual({ kind: 'ready' });
      }
    },
  );

  it('golden 不存在时跳过(非 CI / 无 sibling repo)', () => {
    if (!goldenAvailable) {
      // 手写 fixture 仍是 fallback(上面的 describe 覆盖)
      expect(true).toBe(true);
    }
  });
});
