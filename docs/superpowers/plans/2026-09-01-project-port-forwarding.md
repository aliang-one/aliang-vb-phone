# 项目级端口转发（preview 驱动自动公网映射）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建会话页「端口映射」开关变真功能：打开后，agent 上报 `preview.ready` 时 server 钩子自动为检测到的 dev 端口建立公网隧道映射（24h TTL），手机 preview 卡片展示公网地址并支持复制/打开/撤销。

**Architecture:** 会话级布尔标记随 `createAiSession` 入库；`handlePreviewReady` 末尾挂 fire-and-forget 钩子调 `autoMapPreviewPort`（守卫 → 网关复核去重 → `ensureAgentTunnel` → `createPortMapping`），结果写回 `PreviewLink.mapping` 并以新 WS 事件 `preview.updated` 推手机；DELETE 映射路由联动翻 `revoked`。agent 与网关零改动。

**Tech Stack:** Node/TS + zod + vitest（AliangPhoneServer）；React Native + jest（AliangVibeCodingPhone）。

**Spec:** `docs/superpowers/specs/2026-09-01-project-port-forwarding-design.md`（手机仓内，相对路径以 AliangVibeCodingPhone 为根）

**仓库约定：**
- Server 仓根：`/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer`（下称 **SERVER**）；测试命令在 SERVER 根执行 `npx vitest run <file>`。
- Phone 仓根：`/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone`（下称 **PHONE**）；测试命令在 PHONE 根执行 `npx jest <file>`。
- 两仓当前都在 `main`，每个 Task 结束各自 commit（中文 message，尾部 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`）。
- 找不到计划中给出的函数/方法名时，先用 `grep -rn "<名字>" <仓>/server/src`（或 phone `src`）定位再动手——计划已尽量给出锚点行号，但行号可能漂移，以 grep 锚点为准。

---

## Part A — Server（AliangPhoneServer）

### Task 1: `isTunnelConfigured()` 完整性谓词

**Files:**
- Modify: `server/src/modules/tunnel/settings.ts`（`resolveTunnelConfig` 在 :51）
- Modify: `server/src/modules/tunnel/control.ts`（`requireTunnelConfig` 在 :30 附近）
- Modify: `server/test/modules/tunnel/control.test.ts`（必要连带：settings.js mock 工厂随新导出扩展）
- Test: `server/test/modules/tunnel/settings.test.ts`（追加 describe）

- [ ] **Step 1: 写失败测试**

在 `server/test/modules/tunnel/settings.test.ts` 末尾追加（自包含 mock，不依赖现有用例结构）：

```typescript
import { vi } from 'vitest';

vi.mock('../../../src/modules/tunnel/settings.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/modules/tunnel/settings.js')>();
  return { ...mod, __esModule: true };
});

import { isTunnelConfigured } from '../../../src/modules/tunnel/settings.js';

// isTunnelConfigured 直接读 resolveTunnelConfig()（env+admin 合并）。通过
// 设 env 驱动：settings.test.ts 现有用例若已操纵 env/admin db，沿用其手法；
// 若不方便，用 vi.stubEnv + 最小 env 组合。
describe('isTunnelConfigured', () => {
  it('returns false when disabled', () => {
    // 构造 enabled=false 的 env（沿用本文件现有 env 手法）
    expect(isTunnelConfigured()).toBe(false);
  });
  it('returns true only when enabled + pikoUpstreamUrl + routePublicKey all set', () => {
    // 构造完整 env
    expect(isTunnelConfigured()).toBe(true);
  });
});
```

> 执行者注意：先读 `settings.test.ts` 现有内容再追加，复用它已有的 env/db 构造手法；若该文件完全没有 env 手法，用 `vi.stubEnv('ALIANG_TUNNEL_ENABLED', 'true')` + 其余 `ALIANG_TUNNEL_*` 变量（变量名清单见 `server/src/config.ts:107`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd SERVER && npx vitest run server/test/modules/tunnel/settings.test.ts`
Expected: FAIL（`isTunnelConfigured` 未导出）

- [ ] **Step 3: 实现**

`settings.ts` 末尾追加：

```typescript
/**
 * Non-throwing completeness predicate over the merged tunnel config.
 * Single source of truth for "server-side tunnel is usable"; consumed by
 * requireTunnelConfig (control.ts, throws 503) and publicDevice
 * (tunnel_available). Do NOT use `resolveTunnelConfig()` success as the
 * predicate — it always returns a merged object and never throws.
 */
export function isTunnelConfigured(): boolean {
  const config = resolveTunnelConfig();
  return Boolean(config.enabled && config.pikoUpstreamUrl && config.routePublicKey);
}
```

`control.ts` 的 `requireTunnelConfig` 改为复用谓词（消除双份判据）：

```typescript
import { resolveTunnelConfig, isTunnelConfigured } from './settings.js';

function requireTunnelConfig() {
  if (!isTunnelConfigured()) {
    throw new ApiError(503, 'tunnel_service_unavailable');
  }
  return resolveTunnelConfig();
}
```

（若 `control.ts` 原 import 只有 `resolveTunnelConfig`，更新该行。）

- [ ] **Step 4: 跑测试确认通过 + 回归**

Run: `cd SERVER && npx vitest run server/test/modules/tunnel/settings.test.ts server/test/modules/tunnel/control.test.ts`
Expected: PASS（settings 新增用例 + control 既有用例全绿）

- [ ] **Step 5: Commit**

```bash
cd SERVER && git add server/src/modules/tunnel/settings.ts server/src/modules/tunnel/control.ts server/test/modules/tunnel/settings.test.ts
git commit -m "tunnel: 新增 isTunnelConfigured 完整性谓词，requireTunnelConfig 复用同一判据"
```

### Task 2: 类型扩展（AiSession + PreviewLink）

**Files:**
- Modify: `server/src/types.ts`（`AiSession` 的 `canRun` 字段附近，约 :601-640 区；`PreviewLink` 在 :707）

- [ ] **Step 1: AiSession 加标记**

在 `AiSession` 类型的 `canRun?: boolean | null;` 行后加：

```typescript
  /**
   * Create-flow flag (create-page "端口映射" toggle). When true, the server
   * auto-creates a public tunnel mapping for any port the agent reports via
   * preview.ready in this session (see modules/tunnel/previewMapping.ts).
   */
  exposePreviewPort?: boolean;
```

- [ ] **Step 2: PreviewLink 加映射状态**

在 `PreviewLink` 类型（:707）的 `createdAt: string;` 行后加：

```typescript
  /** Auto-created public tunnel mapping state (undefined = never attempted). */
  publicUrl?: string;
  portMappingId?: string;
  mappingStatus?: 'mapped' | 'failed' | 'unavailable' | 'revoked';
  mappingError?: string;
```

- [ ] **Step 3: typecheck**

Run: `cd SERVER && npx tsc -p server/tsconfig.json --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
cd SERVER && git add server/src/types.ts
git commit -m "types: AiSession.exposePreviewPort + PreviewLink 公网映射状态字段"
```

### Task 3: 创建 schema + POST handler 贯通标记

**Files:**
- Modify: `server/src/schemas.ts:45`（`aiCreateSchema`）
- Modify: `server/src/modules/routes/ai.ts:365`（session 构造）
- Test: `server/test/modules/ai/aiCreateSchema.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, expect, it } from 'vitest';
import { aiCreateSchema } from '../../../src/schemas.js';

describe('aiCreateSchema expose_preview_port', () => {
  it('defaults to false when omitted', () => {
    const parsed = aiCreateSchema.parse({ device_id: 'dev-1' });
    expect(parsed.expose_preview_port).toBe(false);
  });
  it('accepts true', () => {
    const parsed = aiCreateSchema.parse({ device_id: 'dev-1', expose_preview_port: true });
    expect(parsed.expose_preview_port).toBe(true);
  });
  it('rejects non-boolean', () => {
    expect(() => aiCreateSchema.parse({ device_id: 'dev-1', expose_preview_port: 'yes' })).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd SERVER && npx vitest run server/test/modules/ai/aiCreateSchema.test.ts`
Expected: FAIL（schema 无该字段 → parse 抛 UnrecognizedKey 或 undefined）

- [ ] **Step 3: 实现**

`schemas.ts` 的 `aiCreateSchema` 在 `canRun: z.boolean().optional(),` 行后加：

```typescript
  // Create-flow flag: auto-expose agent-reported preview ports as public
  // tunnel mappings for this session (see modules/tunnel/previewMapping.ts).
  expose_preview_port: z.boolean().optional().default(false),
```

`routes/ai.ts` session 构造（`const session: AiSession = recoveredSession ?? {` 块内，`canRun: input.canRun ?? null,` 行后）加：

```typescript
      exposePreviewPort: input.expose_preview_port || undefined,
```

- [ ] **Step 4: 跑测试确认通过 + typecheck**

Run: `cd SERVER && npx vitest run server/test/modules/ai/aiCreateSchema.test.ts && npx tsc -p server/tsconfig.json --noEmit`
Expected: PASS + 0 errors

- [ ] **Step 5: Commit**

```bash
cd SERVER && git add server/src/schemas.ts server/src/modules/routes/ai.ts server/test/modules/ai/aiCreateSchema.test.ts
git commit -m "ai: createAiSession 接受 expose_preview_port 并落到会话标记"
```

### Task 4: 持久化（ai_sessions + preview_links 两列）

**Files:**
- Modify: `server/src/db/aiSessions.ts`（UPSERT SQL :27、params :85 附近、rowToAiSession :144 附近；postgres dao 同文件后半）
- Modify: `server/src/database.ts`（ai_sessions DDL ~:349、ensureColumn ~:959；preview_links DDL :700）
- Modify: `server/src/postgresDatabase.ts`（ai_sessions ALTER ~:801、preview_links CREATE :599 + ALTER 区）
- Modify: `server/src/db/previewLinks.ts`（rowToPreviewLink、两处 upsert）
- Test: `server/test/previewMapping.db.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, expect, it } from 'vitest';
import { SQLiteDatabase } from '../src/database.js';
import type { AiSession, PreviewLink } from '../src/types.js';

const session = (expose: boolean): AiSession =>
  ({
    id: 'ai_test1',
    kind: 'ai',
    userId: 'u1',
    deviceId: 'd1',
    status: 'running',
    mode: 'vibe',
    exposePreviewPort: expose || undefined,
    transcript: [],
    events: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    lastActiveAt: '2026-09-01T00:00:00.000Z',
  }) as unknown as AiSession;

const link = (mapping?: PreviewLink['mappingStatus']): PreviewLink =>
  ({
    id: 'prev_1',
    userId: 'u1',
    sessionId: 'ai_test1',
    deviceId: 'd1',
    port: 3000,
    shortUrl: 'http://localhost:3000',
    targetUrl: 'http://127.0.0.1:3000',
    access: 'private',
    createdAt: '2026-09-01T00:00:00.000Z',
    publicUrl: mapping ? `https://abc.tunnel.test` : undefined,
    portMappingId: mapping ? 'pm_1' : undefined,
    mappingStatus: mapping,
    mappingError: mapping === 'failed' ? 'boom' : undefined,
  }) as PreviewLink;

describe('preview port-forwarding persistence', () => {
  it('round-trips exposePreviewPort on ai_sessions', () => {
    const db = new SQLiteDatabase(':memory:');
    db.upsertAiSession(session(true));
    expect(db.getAiSession('ai_test1')?.exposePreviewPort).toBe(true);
    db.upsertAiSession(session(false));
    expect(db.getAiSession('ai_test1')?.exposePreviewPort).toBe(false);
    db.close();
  });

  it('round-trips preview link mapping state', () => {
    const db = new SQLiteDatabase(':memory:');
    // 公开包装方法（database.ts:2663-2669）：upsertPreviewLink / getPreviewLinksByUser / getPreviewLinkBySession
    db.upsertPreviewLink(link('mapped'));
    const got = db.getPreviewLinksByUser('u1').find(l => l.id === 'prev_1');
    expect(got?.mappingStatus).toBe('mapped');
    expect(got?.publicUrl).toBe('https://abc.tunnel.test');
    expect(got?.portMappingId).toBe('pm_1');

    db.upsertPreviewLink(link('failed'));
    expect(db.getPreviewLinksByUser('u1')[0]?.mappingError).toBe('boom');

    db.upsertPreviewLink(link(undefined));
    expect(db.getPreviewLinksByUser('u1')[0]?.mappingStatus).toBeUndefined();
    db.close();
  });
});
```

> 执行者注意：`upsertAiSession/getAiSession/upsertPreviewLink/listPreviewLinks` 为按现有命名惯例推定的公开包装名——先 `grep -n "PreviewLink\|upsertAiSession" server/src/database.ts` 用真实方法名替换。测试断言语义不变。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd SERVER && npx vitest run server/test/previewMapping.db.test.ts`
Expected: FAIL（列不存在，值丢失）

- [ ] **Step 3: 实现**

**aiSessions 列（sqlite）：**
1. `database.ts` ai_sessions DDL（`approval_scheme TEXT,` 同区，~:349）加一行 `expose_preview_port INTEGER NOT NULL DEFAULT 0,`
2. `database.ts` ensureColumn 区（`this.ensureColumn('ai_sessions', 'can_run', 'INTEGER');` ~:962 之后）加：
   `this.ensureColumn('ai_sessions', 'expose_preview_port', 'INTEGER NOT NULL DEFAULT 0');`
3. `postgresDatabase.ts`：ai_sessions CREATE（`approval_scheme TEXT,` ~:303）加 `expose_preview_port INTEGER NOT NULL DEFAULT 0,`；ALTER 迁移区（`ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS approval_scheme TEXT` ~:801 旁）加：
   `` `ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS expose_preview_port INTEGER NOT NULL DEFAULT 0`, ``

**aiSessions dao（`db/aiSessions.ts`，sqlite + postgres 两 dao 同步改）：**
1. `AI_SESSION_UPSERT_SQL`：INSERT 列清单 `can_read, can_modify, can_run` 后加 `, expose_preview_port`；VALUES 对应加 `?`；`ON CONFLICT` SET 加 `expose_preview_port=excluded.expose_preview_port`
2. sqlite upsert params 数组 `session.approvalScheme ?? null,` 区末（can_read/can_modify/can_run 之后）加 `session.exposePreviewPort ? 1 : 0,`；postgres dao 的 params 数组同样加（注意 pg dao 的占位符风格与列序与 sqlite 一致）
3. `rowToAiSession` 在 `approvalScheme: ...` 附近加 `exposePreviewPort: Boolean(row.expose_preview_port),`

**preview_links 列：**
1. `database.ts` preview_links DDL（:700，`created_at TEXT NOT NULL` 后）加 `mapping_state TEXT`；ensureColumn 区加 `this.ensureColumn('preview_links', 'mapping_state', 'TEXT');`
2. `postgresDatabase.ts` preview_links CREATE（:599）加 `mapping_state TEXT`；ALTER 迁移区加 `` `ALTER TABLE preview_links ADD COLUMN IF NOT EXISTS mapping_state TEXT` ``

**`db/previewLinks.ts`：**
1. `rowToPreviewLink` 末尾加（JSON 容错解码）：

```typescript
    ...decodeMappingState(row.mapping_state),
```

文件顶部加 helper：

```typescript
function decodeMappingState(raw: unknown): Pick<PreviewLink, 'publicUrl' | 'portMappingId' | 'mappingStatus' | 'mappingError'> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      publicUrl: typeof parsed.publicUrl === 'string' ? parsed.publicUrl : undefined,
      portMappingId: typeof parsed.portMappingId === 'string' ? parsed.portMappingId : undefined,
      mappingStatus: (['mapped', 'failed', 'unavailable', 'revoked'] as const).includes(
        parsed.mappingStatus as PreviewLink['mappingStatus'] & string,
      )
        ? (parsed.mappingStatus as PreviewLink['mappingStatus'])
        : undefined,
      mappingError: typeof parsed.mappingError === 'string' ? parsed.mappingError : undefined,
    };
  } catch {
    return {};
  }
}
```

2. 两处 upsert（sqlite + postgres）：INSERT 列清单 `created_at` 后加 `, mapping_state`、VALUES 加 `?`、ON CONFLICT SET 加 `mapping_state=excluded.mapping_state`；params 末尾加：

```typescript
      (link.publicUrl || link.portMappingId || link.mappingStatus || link.mappingError)
        ? JSON.stringify({
            publicUrl: link.publicUrl,
            portMappingId: link.portMappingId,
            mappingStatus: link.mappingStatus,
            mappingError: link.mappingError,
          })
        : null,
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `cd SERVER && npx vitest run server/test/previewMapping.db.test.ts && npx vitest run`
Expected: 新测试 PASS；全量无新增失败（基线见最近一次全量跑）

- [ ] **Step 5: Commit**

```bash
cd SERVER && git add server/src/db/aiSessions.ts server/src/db/previewLinks.ts server/src/database.ts server/src/postgresDatabase.ts server/test/previewMapping.db.test.ts
git commit -m "db: ai_sessions.expose_preview_port + preview_links.mapping_state 持久化（sqlite/pg 镜像）"
```

### Task 5: `previewMapping.ts` 核心模块

**Files:**
- Create: `server/src/modules/tunnel/previewMapping.ts`
- Test: `server/test/modules/tunnel/previewMapping.test.ts`
- Modify（T5 质量审查补充，已随修复提交 7335abc 落地）: `server/src/shared/serializers.ts`——`publicPreviewLink` 必须带出 `public_url/port_mapping_id/mapping_status/mapping_error` 四字段，否则 T9 的 normalize、T12 的断言、快照收敛全部拿不到映射状态

- [ ] **Step 1: 写失败测试**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiSession, Device, PreviewLink } from '../../../src/types.js';
import { ApiError } from '../../../src/errors.js';

vi.mock('../../../src/modules/tunnel/settings.js', () => ({
  resolveTunnelConfig: vi.fn(() => ({
    enabled: true,
    pikoUpstreamUrl: 'http://127.0.0.1:8001',
    routePublicKey: 'route-pk',
  })),
  isTunnelConfigured: vi.fn(() => true),
  __esModule: true,
}));
vi.mock('../../../src/modules/tunnel/control.js', () => ({
  ensureAgentTunnel: vi.fn(async () => ({ state: 'connected' })),
  __esModule: true,
}));
vi.mock('../../../src/modules/tunnel/gatewayClient.js', () => ({
  createPortMapping: vi.fn(),
  getPortMapping: vi.fn(),
  __esModule: true,
}));
vi.mock('../../../src/shared/ws/registry.js', () => ({
  isAgentConnected: vi.fn(() => true),
  __esModule: true,
}));
const mockDevices = new Map<string, Device>();
vi.mock('../../../src/store.js', () => ({
  devices: mockDevices,
  previewLinks: new Map(), // PreviewLinkRepository 委托此 Map（store 不 mock 会 undefined 崩）
  scheduleStateSave: vi.fn(),
  __esModule: true,
}));
const mockPublish = vi.fn(async () => {});
vi.mock('../../../src/shared/realtime/publish.js', () => ({
  publishToMobiles: (...args: unknown[]) => mockPublish(...(args as [])),
  __esModule: true,
}));

import {
  autoMapPreviewPort,
  revokeLinkedPreviewMappings,
  PREVIEW_MAPPING_TTL_SECONDS,
} from '../../../src/modules/tunnel/previewMapping.js';
import { ensureAgentTunnel } from '../../../src/modules/tunnel/control.js';
import { createPortMapping, getPortMapping } from '../../../src/modules/tunnel/gatewayClient.js';
import { isTunnelConfigured } from '../../../src/modules/tunnel/settings.js';
import { isAgentConnected } from '../../../src/shared/ws/registry.js';
import { PreviewLinkRepository } from '../../../src/modules/preview/repository.js';

const device = (caps: string[] = ['http_tunnel_v1', 'websocket_tunnel_v1']): Device =>
  ({ id: 'd1', userId: 'u1', capabilities: caps }) as unknown as Device;

const session = (): AiSession =>
  ({
    id: 'ai_s1',
    userId: 'u1',
    deviceId: 'd1',
    exposePreviewPort: true,
  }) as unknown as AiSession;

const link = (port = 3000): PreviewLink =>
  ({
    id: 'prev_1',
    userId: 'u1',
    sessionId: 'ai_s1',
    deviceId: 'd1',
    port,
    shortUrl: 'http://192.168.1.5:3000',
    targetUrl: 'http://127.0.0.1:3000',
    access: 'private',
    createdAt: '2026-09-01T00:00:00.000Z',
  }) as PreviewLink;

beforeEach(() => {
  vi.clearAllMocks();
  mockDevices.clear();
  mockDevices.set('d1', device());
  PreviewLinkRepository.delete('prev_1');
});

describe('autoMapPreviewPort', () => {
  it('maps the port and publishes preview.updated on success', async () => {
    vi.mocked(createPortMapping).mockResolvedValue({
      id: 'pm_new', short_url: 'https://abc.tunnel.test',
    } as never);
    const l = link();
    await autoMapPreviewPort(session(), l);
    expect(ensureAgentTunnel).toHaveBeenCalledWith(mockDevices.get('d1'));
    expect(createPortMapping).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'u1', deviceId: 'd1',
        targetHost: '127.0.0.1', targetPort: 3000,
        kind: 'http', expiresInSeconds: PREVIEW_MAPPING_TTL_SECONDS,
      }),
    );
    expect(l.mappingStatus).toBe('mapped');
    expect(l.publicUrl).toBe('https://abc.tunnel.test');
    expect(l.portMappingId).toBe('pm_new');
    expect(mockPublish).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ type: 'preview.updated' }),
      expect.anything(),
    );
  });

  it('marks unavailable when tunnel is not configured', async () => {
    vi.mocked(isTunnelConfigured).mockReturnValue(false);
    const l = link();
    await autoMapPreviewPort(session(), l);
    expect(l.mappingStatus).toBe('unavailable');
    expect(l.mappingError).toBe('tunnel_disabled');
    expect(createPortMapping).not.toHaveBeenCalled();
  });

  it('marks unavailable when agent offline or capabilities missing', async () => {
    vi.mocked(isAgentConnected).mockReturnValue(false);
    const l = link();
    await autoMapPreviewPort(session(), l);
    expect(l.mappingStatus).toBe('unavailable');
    expect(l.mappingError).toBe('agent_offline');

    vi.mocked(isAgentConnected).mockReturnValue(true);
    mockDevices.set('d1', device(['ai_run_start_v3']));
    const l2 = link();
    await autoMapPreviewPort(session(), l2);
    expect(l2.mappingStatus).toBe('unavailable');
    expect(l2.mappingError).toBe('tunnel_unsupported');
  });

  it('skips port<=0 with port_missing', async () => {
    const l = link(0);
    await autoMapPreviewPort(session(), l);
    expect(l.mappingStatus).toBe('unavailable');
    expect(l.mappingError).toBe('port_missing');
    expect(createPortMapping).not.toHaveBeenCalled();
  });

  it('reuses an alive existing mapping for the same session+port', async () => {
    PreviewLinkRepository.upsert({
      ...link(), id: 'prev_0',
      publicUrl: 'https://old.tunnel.test', portMappingId: 'pm_old', mappingStatus: 'mapped',
    });
    vi.mocked(getPortMapping).mockResolvedValue({ id: 'pm_old' } as never);
    const l = link();
    await autoMapPreviewPort(session(), l);
    expect(createPortMapping).not.toHaveBeenCalled();
    expect(l.mappingStatus).toBe('mapped');
    expect(l.publicUrl).toBe('https://old.tunnel.test');
  });

  it('rebuilds when the dedupe revalidation finds the mapping revoked (gateway 404)', async () => {
    PreviewLinkRepository.upsert({
      ...link(), id: 'prev_0',
      publicUrl: 'https://dead.tunnel.test', portMappingId: 'pm_dead', mappingStatus: 'mapped',
    });
    vi.mocked(getPortMapping).mockRejectedValue(new ApiError(404, 'port_mapping_not_found'));
    vi.mocked(createPortMapping).mockResolvedValue({
      id: 'pm_new', short_url: 'https://fresh.tunnel.test',
    } as never);
    const l = link();
    await autoMapPreviewPort(session(), l);
    expect(createPortMapping).toHaveBeenCalled();
    expect(l.publicUrl).toBe('https://fresh.tunnel.test');
    expect(l.portMappingId).toBe('pm_new');
  });

  it('marks failed when gateway create fails', async () => {
    vi.mocked(createPortMapping).mockRejectedValue(new ApiError(502, 'tunnel_gateway_error'));
    const l = link();
    await autoMapPreviewPort(session(), l);
    expect(l.mappingStatus).toBe('failed');
    expect(l.mappingError).toBe('tunnel_gateway_error');
  });

  it('marks unavailable when ensureAgentTunnel throws (409/504)', async () => {
    vi.mocked(ensureAgentTunnel).mockRejectedValue(new ApiError(409, 'device_offline'));
    const l = link();
    await autoMapPreviewPort(session(), l);
    expect(l.mappingStatus).toBe('unavailable');
    expect(createPortMapping).not.toHaveBeenCalled();
  });
});

describe('revokeLinkedPreviewMappings', () => {
  it('flips matching links to revoked and publishes preview.updated', async () => {
    PreviewLinkRepository.upsert({
      ...link(), id: 'prev_a',
      publicUrl: 'https://abc.tunnel.test', portMappingId: 'pm_x', mappingStatus: 'mapped',
    });
    PreviewLinkRepository.upsert({
      ...link(), id: 'prev_b', port: 8080,
      publicUrl: 'https://other.tunnel.test', portMappingId: 'pm_y', mappingStatus: 'mapped',
    });
    await revokeLinkedPreviewMappings('pm_x');
    const a = PreviewLinkRepository.get('prev_a')!;
    const b = PreviewLinkRepository.get('prev_b')!;
    expect(a.mappingStatus).toBe('revoked');
    expect(b.mappingStatus).toBe('mapped');
    expect(mockPublish).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ type: 'preview.updated' }),
      expect.anything(),
    );
  });
});
```

> 注意：`ApiError` 构造签名以 `server/src/errors.ts` 为准（`new ApiError(status, code)`）；测试用真实 `PreviewLinkRepository`，**它委托 store 的 `previewLinks` Map，因此上面 store mock 必须含 `previewLinks: new Map()`**（缺了会在 `Repository.delete/upsert` 处 TypeError）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd SERVER && npx vitest run server/test/modules/tunnel/previewMapping.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现模块**

`server/src/modules/tunnel/previewMapping.ts`：

```typescript
// Auto port-forwarding: when a session was created with the create-page
// "端口映射" toggle on (AiSession.exposePreviewPort), every port the agent
// reports via preview.ready gets a REAL public tunnel mapping (24h TTL),
// replacing the agent-local short URL for phone display. Fired and forgotten
// from handlePreviewReady — never blocks or throws into the caller.
// Lifecycle: fixed TTL + manual revoke; no auto-retry (manual fallback =
// device PortMappings screen). See docs spec 2026-09-01-project-port-forwarding.

import type { AiSession, Device, PreviewLink } from '../../types.js';
import { ApiError } from '../../errors.js';
import { devices, scheduleStateSave } from '../../store.js';
import { isAgentConnected } from '../../shared/ws/registry.js';
import { publishToMobiles } from '../../shared/realtime/publish.js';
import { publicPreviewLink } from '../../shared/serializers.js';
import { PreviewLinkRepository } from '../preview/repository.js';
import { isTunnelConfigured, resolveTunnelConfig } from './settings.js';
import { ensureAgentTunnel } from './control.js';
import { createPortMapping, getPortMapping } from './gatewayClient.js';

export const PREVIEW_MAPPING_TTL_SECONDS = 86_400; // 24h, gateway cap is 7d

type MappingStatus = NonNullable<PreviewLink['mappingStatus']>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'tunnel_gateway_error';
}

function hasTunnelCapabilities(device: Device): boolean {
  const capabilities = new Set(device.capabilities ?? []);
  return capabilities.has('http_tunnel_v1') && capabilities.has('websocket_tunnel_v1');
}

function publishUpdated(link: PreviewLink): void {
  void publishToMobiles(
    link.userId,
    { type: 'preview.updated', preview: publicPreviewLink(link) },
    {
      direction: 'agent_to_mobile',
      source: { kind: 'agent', user_id: link.userId, device_id: link.deviceId },
      deviceId: link.deviceId,
      sessionId: link.sessionId,
    },
  ).catch(() => {});
}

function commit(link: PreviewLink, status: MappingStatus, error?: string): void {
  link.mappingStatus = status;
  link.mappingError = error;
  PreviewLinkRepository.upsert(link);
  scheduleStateSave();
  publishUpdated(link);
}

function hasTunnelCapabilitiesOf(device: Device | undefined): boolean {
  return Boolean(device && hasTunnelCapabilities(device));
}

/** Newest-first scan is unnecessary — any active mapping for the triple works. */
export function findExistingPreviewMapping(
  userId: string,
  sessionId: string,
  port: number,
): PreviewLink | undefined {
  for (const link of PreviewLinkRepository.values()) {
    if (
      link.userId === userId &&
      link.sessionId === sessionId &&
      link.port === port &&
      link.mappingStatus === 'mapped' &&
      link.portMappingId
    ) {
      return link;
    }
  }
  return undefined;
}

/**
 * Server-side `mappingStatus === 'mapped'` is NOT proof the gateway mapping is
 * still alive (phone revoke, natural expiry). Revalidate before reuse; a 404
 * (thrown ApiError) means rebuild. Other errors are transient — propagate.
 */
async function mappingStillAlive(mappingId: string): Promise<boolean> {
  try {
    await getPortMapping(resolveTunnelConfig(), mappingId);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false;
    throw error;
  }
}

export async function autoMapPreviewPort(
  session: AiSession,
  link: PreviewLink,
): Promise<void> {
  try {
    if (!isTunnelConfigured()) {
      return commit(link, 'unavailable', 'tunnel_disabled');
    }
    const device = devices.get(session.deviceId);
    if (!device || !isAgentConnected(device.id)) {
      return commit(link, 'unavailable', 'agent_offline');
    }
    if (!hasTunnelCapabilitiesOf(device)) {
      return commit(link, 'unavailable', 'tunnel_unsupported');
    }
    if (!Number.isFinite(link.port) || link.port <= 0) {
      return commit(link, 'unavailable', 'port_missing');
    }

    const existing = findExistingPreviewMapping(session.userId, link.sessionId, link.port);
    if (existing?.portMappingId && existing.publicUrl) {
      if (await mappingStillAlive(existing.portMappingId)) {
        link.publicUrl = existing.publicUrl;
        link.portMappingId = existing.portMappingId;
        return commit(link, 'mapped');
      }
    }

    try {
      await ensureAgentTunnel(device);
    } catch (error) {
      return commit(link, 'unavailable', errorMessage(error));
    }

    let mapping;
    try {
      mapping = await createPortMapping(resolveTunnelConfig(), {
        userId: session.userId,
        deviceId: session.deviceId,
        targetHost: '127.0.0.1',
        targetPort: link.port,
        kind: 'http',
        expiresInSeconds: PREVIEW_MAPPING_TTL_SECONDS,
      });
    } catch (error) {
      return commit(link, 'failed', errorMessage(error));
    }

    link.publicUrl = mapping.short_url;
    link.portMappingId = mapping.id;
    commit(link, 'mapped');
  } catch (error) {
    // Unexpected (publish/store hiccups): fail soft, never throw into the
    // preview.ready handler.
    commit(link, 'failed', errorMessage(error));
  }
}

/**
 * Server-side revoke linkage: after the gateway confirmations a mapping is
 * gone, every preview link carrying it must converge to 'revoked' so a
 * refresh/relaunch cannot resurrect a dead publicUrl (snapshot is authored
 * from PreviewLinkRepository). Called from DELETE /api/port-mappings/:id.
 */
export async function revokeLinkedPreviewMappings(mappingId: string): Promise<void> {
  for (const link of PreviewLinkRepository.values()) {
    if (link.portMappingId !== mappingId || link.mappingStatus === 'revoked') continue;
    commit(link, 'revoked');
  }
}
```

> 执行者注意：
> 1. `publishToMobiles` 的第三参 shape 以 `handlePreviewReady`（`projectDevice.ts:96-106`）现有调用为准，直接照抄其 envelope（direction/source/deviceId/sessionId）。
> 2. `mapping.short_url` 字段名以 `gatewayClient.ts` 的 `PortMapping` 类型为准。
> 3. 实现里删掉上面重复的 `hasTunnelCapabilitiesOf` 包装（直接用 `hasTunnelCapabilities` + 判空），保持一个函数一个职责。
> 4. `ApiError.status` 属性名以 `errors.ts` 实际为准（可能是 `status` 或 `statusCode`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd SERVER && npx vitest run server/test/modules/tunnel/previewMapping.test.ts`
Expected: PASS（9 个用例）

- [ ] **Step 5: Commit**

```bash
cd SERVER && git add server/src/modules/tunnel/previewMapping.ts server/test/modules/tunnel/previewMapping.test.ts
git commit -m "tunnel: previewMapping 自动公网映射模块（去重复核/守卫降级/撤销联动）"
```

### Task 6: `handlePreviewReady` 挂钩

**Files:**
- Modify: `server/src/modules/agent/handlers/projectDevice.ts:67-108`（`handlePreviewReady`）
- Test: `server/test/modules/agent/previewMappingHook.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

const autoMap = vi.fn(async () => {});
vi.mock('../../../src/modules/tunnel/previewMapping.js', () => ({
  autoMapPreviewPort: (...args: unknown[]) => autoMap(...(args as [])),
  __esModule: true,
}));
const mockAiSessions = new Map();
vi.mock('../../../src/store.js', () => ({
  aiSessions: mockAiSessions,
  previewLinks: new Map(),
  scheduleStateSave: vi.fn(),
  __esModule: true,
}));
// 其余 handlePreviewReady 的依赖（publishToMobiles 等）照
// server/test/modules/agent/ 下现有 agent handler 测试的 mock 方式补齐；
// 未 mock 的依赖报错时按错误信息补。

import { handlePreviewReady } from '../../../src/modules/agent/handlers/projectDevice.js';

const makeWs = () => ({ userId: 'u1', deviceId: 'd1', sendJson: vi.fn() } as never);

const message = () => ({
  type: 'preview.ready',
  session_id: 'ai_s1',
  port: 3000,
  short_url: 'http://lan:3000',
  target_url: 'http://127.0.0.1:3000',
});

beforeEach(() => {
  autoMap.mockClear();
  mockAiSessions.clear();
});

describe('handlePreviewReady → autoMapPreviewPort hook', () => {
  it('fires autoMapPreviewPort when the session has exposePreviewPort', async () => {
    mockAiSessions.set('ai_s1', { id: 'ai_s1', userId: 'u1', deviceId: 'd1', exposePreviewPort: true });
    await handlePreviewReady(makeWs(), message());
    expect(autoMap).toHaveBeenCalledTimes(1);
    expect(autoMap).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ai_s1' }),
      expect.objectContaining({ port: 3000 }),
    );
  });

  it('does nothing when the flag is off or ownership mismatches', async () => {
    mockAiSessions.set('ai_s1', { id: 'ai_s1', userId: 'u1', deviceId: 'd1' });
    await handlePreviewReady(makeWs(), message());
    expect(autoMap).not.toHaveBeenCalled();

    mockAiSessions.set('ai_s1', { id: 'ai_s1', userId: 'OTHER', deviceId: 'd1', exposePreviewPort: true });
    await handlePreviewReady(makeWs(), message());
    expect(autoMap).not.toHaveBeenCalled();
  });
});
```

> 执行者注意：`handlePreviewReady` 的真实依赖（`publishToMobiles`、`sendJson` 的 ws 形状、`now` 等）以源码为准补 mock；测试断言聚焦 hook 触发条件。若现有 agent handler 测试已有该函数的测试文件，把用例并入而不是新建。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd SERVER && npx vitest run server/test/modules/agent/previewMappingHook.test.ts`
Expected: FAIL（hook 不存在，autoMap 零调用）

- [ ] **Step 3: 实现**

`handlePreviewReady` 中，**`await publishToMobiles('preview.ready', ...)` 之后**（T5 质量审查修正：守卫路径的 `preview.updated` 是同步 commit，若钩子放在 publish 之前，手机会先收到 preview.updated 再收到 preview.ready，T12 的 preview.ready 合并会用无映射字段的载荷覆盖掉刚送达的映射状态）插：

```typescript
  // Auto port-forwarding hook (create-page toggle): fire-and-forget, never
  // blocks the preview.ready fan-out or its ack. Ownership is re-checked so a
  // forged/foreign session_id cannot trigger tunnel work.
  const session = aiSessions.get(sessionId);
  if (
    session &&
    session.userId === ws.userId &&
    session.deviceId === ws.deviceId &&
    session.exposePreviewPort
  ) {
    void autoMapPreviewPort(session, link);
  }
```

import 区加 `autoMapPreviewPort`（from `../../tunnel/previewMapping.js`）与 `aiSessions`（from `../../../store.js`，若该文件尚未引入）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd SERVER && npx vitest run server/test/modules/agent/previewMappingHook.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd SERVER && git add server/src/modules/agent/handlers/projectDevice.ts server/test/modules/agent/previewMappingHook.test.ts
git commit -m "agent: preview.ready 挂载自动公网映射钩子（fire-and-forget + 归属校验）"
```

### Task 7: DELETE 路由撤销联动

**Files:**
- Modify: `server/src/modules/routes/portMappings.ts:112-133`（DELETE handler）
- Test: 已在 Task 5 `revokeLinkedPreviewMappings` 用例覆盖函数本体；此处只接线

- [ ] **Step 1: 接线**

DELETE handler 中 `const mapping = await revokePortMapping(config, req.params.mappingId);` 之后、`rememberAudit` 之前加：

```typescript
    // Converge preview links that carry this mapping to 'revoked' BEFORE the
    // response returns, so the phone's next snapshot cannot resurrect a dead
    // publicUrl. See previewMapping.revokeLinkedPreviewMappings.
    await revokeLinkedPreviewMappings(mapping.id);
```

import 区加 `import { revokeLinkedPreviewMappings } from '../tunnel/previewMapping.js';`

- [ ] **Step 2: 回归**

Run: `cd SERVER && npx vitest run server/test/modules/tunnel/ && npx tsc -p server/tsconfig.json --noEmit`
Expected: tunnel 全部测试 PASS + 0 type errors

- [ ] **Step 3: Commit**

```bash
cd SERVER && git add server/src/modules/routes/portMappings.ts
git commit -m "port-mappings: DELETE 联动翻转关联 preview 链接为 revoked 并推 preview.updated"
```

### Task 8: `publicDevice.tunnel_available`

**Files:**
- Modify: `server/src/modules/device/serializers.ts`（`publicDevice`）
- Test: `server/test/modules/device/publicDevice.test.ts`（新建；若已有同类文件则并入）

- [ ] **Step 1: 写失败测试**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/shared/ws/registry.js', () => ({
  isAgentConnected: vi.fn(() => true),
  __esModule: true,
}));
vi.mock('../../../src/store.js', () => ({
  transientAgentReconnects: new Set(),
  __esModule: true,
}));
vi.mock('../../../src/modules/tunnel/settings.js', () => ({
  isTunnelConfigured: vi.fn(() => true),
  __esModule: true,
}));

import { publicDevice } from '../../../src/modules/device/serializers.js';
import { isTunnelConfigured } from '../../../src/modules/tunnel/settings.js';

const device = { id: 'd1', userId: 'u1', name: 'D', platform: 'darwin', capabilities: [] };

beforeEach(() => vi.clearAllMocks());

describe('publicDevice.tunnel_available', () => {
  it('mirrors isTunnelConfigured', () => {
    expect(publicDevice(device as never).tunnel_available).toBe(true);
    vi.mocked(isTunnelConfigured).mockReturnValue(false);
    expect(publicDevice(device as never).tunnel_available).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd SERVER && npx vitest run server/test/modules/device/publicDevice.test.ts`
Expected: FAIL（无 tunnel_available 字段）

- [ ] **Step 3: 实现**

`publicDevice` 返回对象 `capabilities: device.capabilities,` 行后加：

```typescript
    tunnel_available: isTunnelConfigured(),
```

import 加 `import { isTunnelConfigured } from '../tunnel/settings.js';`

- [ ] **Step 4: 跑测试 + typecheck + 全量回归**

Run: `cd SERVER && npx vitest run server/test/modules/device/publicDevice.test.ts && npx tsc -p server/tsconfig.json --noEmit && npx vitest run`
Expected: PASS / 0 errors / 全量无新增失败

- [ ] **Step 5: Commit**

```bash
cd SERVER && git add server/src/modules/device/serializers.ts server/test/modules/device/publicDevice.test.ts
git commit -m "device: publicDevice 暴露 tunnel_available 供手机门控创建页开关"
```

---

## Part B — Phone（AliangVibeCodingPhone）

### Task 9: 类型 + i18n

**Files:**
- Modify: `src/app/navigation/types.ts:32`（draftConfig 类型）
- Modify: `src/store/types.ts:203`（StartAgentInput）
- Modify: `src/data/platformModels.ts:689`（PreviewLink）
- Modify: `src/services/platformTransport.ts`（PlatformDeviceSnapshot ~:65、PlatformPreviewSnapshot :120、normalize ~:75/213/237）
- Modify: `src/api/platformState.ts:10`（`ServerPreviewLink` 加 4 个 snake_case 字段，否则 normalize 引用 `link.public_url` 等过不了 typecheck）
- Modify: `src/i18n/locales/vibecoding/zh.json` + `en.json`

- [ ] **Step 1: draftConfig + StartAgentInput**

`navigation/types.ts` draftConfig 的 `canRun?: boolean;` 后加：

```typescript
      /** Create-page toggle: auto-expose agent-reported preview ports as public tunnel links. */
      exposePreviewPort?: boolean;
```

`store/types.ts` StartAgentInput 的 `canRun?: boolean;` 后加同语义字段 `exposePreviewPort?: boolean;`（注释可简写）。

- [ ] **Step 2: PreviewLink + 快照类型**

`platformModels.ts` PreviewLink 的 `access` 行后加：

```typescript
  /** Auto-created public tunnel mapping (undefined = none/never attempted). */
  publicUrl?: string;
  portMappingId?: string;
  mappingStatus?: 'mapped' | 'failed' | 'unavailable' | 'revoked';
  mappingError?: string;
```

`platformTransport.ts`：
1. `PlatformPreviewSnapshot`（:120）同步加上述 4 个可选字段；
2. `PlatformDeviceSnapshot` 加 `tunnelAvailable?: boolean;`；
3. device normalize（`capabilities: asStringArray(...)` 同区）加 `tunnelAvailable: Boolean(device.tunnel_available),`；
4. `ServerDevice` 类型（grep `interface ServerDevice` / `type ServerDevice` 定位其定义文件）加 `tunnel_available?: boolean;`；
5. `src/api/platformState.ts` 的 `ServerPreviewLink` 接口加 `public_url?: string; port_mapping_id?: string; mapping_status?: string; mapping_error?: string;`（不加则本任务 typecheck 门过不了）；
6. `normalizeServerPreviewLink`（:237）加：

```typescript
    publicUrl: asString(link.public_url),
    portMappingId: asString(link.port_mapping_id),
    mappingStatus: asPreviewMappingStatus(link.mapping_status),
    mappingError: asString(link.mapping_error),
```

文件内加 helper（放在 `normalizeServerPreviewLink` 上方）：

```typescript
function asPreviewMappingStatus(
  value: unknown,
): PlatformPreviewSnapshot['mappingStatus'] {
  return value === 'mapped' || value === 'failed' || value === 'unavailable' || value === 'revoked'
    ? value
    : undefined;
}
```

6. WS 联合类型（:160 `preview.ready` 行后）加：

```typescript
  | { type: 'preview.updated'; preview: PlatformPreviewSnapshot; raw: Record<string, unknown> }
```

7. transport reducer（`preview.ready` 分支 :735）改为共享归一化：

```typescript
    if ((type === 'preview.ready' || type === 'preview.updated') && message.preview && typeof message.preview === 'object') {
      const preview = message.preview as Record<string, unknown>;
      return {
        type,
        preview: {
          id: String(preview.id ?? ''),
          sessionId: String(preview.session_id ?? ''),
          port: Number(preview.port ?? 0),
          shortUrl: String(preview.short_url ?? ''),
          targetUrl: String(preview.target_url ?? ''),
          publicUrl: asString(preview.public_url),
          portMappingId: asString(preview.port_mapping_id),
          mappingStatus: asPreviewMappingStatus(preview.mapping_status),
          mappingError: asString(preview.mapping_error),
          expiresIn: asString(preview.expires_in),
          access: String(preview.access ?? 'private'),
          createdAt: asString(preview.created_at),
        } as PlatformPreviewSnapshot,
        expiresIn: String(message.expires_in ?? preview.expires_in ?? ''),
        raw: message,
      } as PlatformTransportEvent;
    }
```

（`type` 已在上面解出；保持原分支的其余语义不变。）

- [ ] **Step 3: i18n**

`zh.json`：`"portMapping"` 对象改为：

```json
      "portMapping": {
        "title": "将预览端口暴露为公网短链",
        "comingSoon": "即将支持",
        "onHint": "AI 起的预览端口自动生成公网地址(24小时有效)",
        "offHint": "开启后自动为预览端口生成公网地址",
        "disabledHint": "设备不在线或隧道不可用"
      }
```

文件顶层（`createScreen` 同级）加：

```json
  "sessionPreview": {
    "publicBadge": "公网",
    "copy": "复制",
    "copied": "已复制",
    "open": "打开",
    "revoke": "撤销",
    "revokeTitle": "撤销公网映射？",
    "revokeBody": "撤销后该公网地址立即失效。",
    "revoked": "已撤销",
    "failed": "公网映射未能建立"
  }
```

`en.json` 对应英文（title: "Expose preview ports as public links"；hints/badges 同义）。

- [ ] **Step 4: typecheck**

Run: `cd PHONE && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
cd PHONE && git add src/app/navigation/types.ts src/store/types.ts src/data/platformModels.ts src/services/platformTransport.ts src/api/platformState.ts src/i18n/locales/vibecoding/zh.json src/i18n/locales/vibecoding/en.json
git commit -m "types+i18n: 端口转发标记/公网映射状态贯通与双语文案"
```

### Task 10: 创建页真开关

**Files:**
- Modify: `src/screens/vibecoding/CreateVibeCodingScreen.tsx`（占位面板 :761-772、state 区 ~:120、handleCreate :185）
- Test: `__tests__/CreateVibeCodingScreen.test.tsx`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `__tests__/CreateVibeCodingScreen.test.tsx` 追加（复用文件内现有 `wrap`/mock 手法；mockDevices 需补 `capabilities: ['http_tunnel_v1', 'websocket_tunnel_v1']` 与 `tunnelAvailable: true` 字段——通过 `mockStoreState` 注入，或直接改 `mockDevices` 数组）：

```typescript
it('port mapping toggle: disabled when tunnel unavailable', async () => {
  // device 无 tunnel 能力/tunnelAvailable=false
  // 断言 testID=port-mapping-row 不可点（TouchableOpacity disabled）且出现 disabledHint 文案
});

it('port mapping toggle: flips ON and passes exposePreviewPort into draftConfig', async () => {
  // tunnel-capable device
  // act: 找到 testID=port-mapping-toggle 的 TouchableOpacity 并 onPress
  // 断言 StatusChip 文案变 'ON'
  // act: 触发 START VIBECODING（title 含 'START VIBECODING' 的按钮 onPress）
  // 断言 mockReplace 收到的 draftConfig.exposePreviewPort === true
});

it('port mapping toggle: default OFF', async () => {
  // 不触碰开关，直接 START，断言 draftConfig.exposePreviewPort === false
});
```

> 执行者注意：现测试文件对 `TouchableOpacity` 的遍历方式以其现有用例为准（`renderer.root.findAllByProps({testID: ...})` 手法）；若现有 mockDevices 不含 `capabilities` 字段，补上（`asStringArray` 对 undefined 安全，但门控需要真实数组）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd PHONE && npx jest __tests__/CreateVibeCodingScreen.test.tsx`
Expected: 新用例 FAIL

- [ ] **Step 3: 实现**

1. state 区（其他 useState 旁）加：

```typescript
  const [exposePreviewPort, setExposePreviewPort] = useState(false);
  const tunnelCapable = Boolean(
    device?.status === 'online' &&
      device?.capabilities?.includes('http_tunnel_v1') &&
      device?.capabilities?.includes('websocket_tunnel_v1') &&
      device?.tunnelAvailable,
  );
```

（`device` 类型若缺 `tunnelAvailable`，确认 Task 9 的 PlatformDeviceSnapshot 改动已覆盖其类型来源。）

2. 替换占位面板（:761-772 整块）为：

```tsx
        {/* Port mapping: auto-expose agent-reported preview ports as public links. */}
        <GlassPanel style={styles.optionPanel}>
          <TouchableOpacity
            testID="port-mapping-toggle"
            disabled={!tunnelCapable}
            onPress={() => setExposePreviewPort(v => !v)}
          >
            <View style={[styles.optionRow, !tunnelCapable ? { opacity: 0.4 } : null]}>
              <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                {t('createScreen.permissions.portMapping.title')}
              </Text>
              <StatusChip
                label={!tunnelCapable
                  ? t('createScreen.permissions.portMapping.comingSoon')
                  : exposePreviewPort ? 'ON' : 'OFF'}
                type={!tunnelCapable ? 'neutral' : exposePreviewPort ? 'success' : 'neutral'}
              />
            </View>
          </TouchableOpacity>
          <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant, marginTop: 4 }]}>
            {t(!tunnelCapable
              ? 'createScreen.permissions.portMapping.disabledHint'
              : exposePreviewPort
                ? 'createScreen.permissions.portMapping.onHint'
                : 'createScreen.permissions.portMapping.offHint')}
          </Text>
        </GlassPanel>
```

3. `handleCreate` 的 draftConfig（:200-211）`canRun,` 后加：

```typescript
        exposePreviewPort,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd PHONE && npx jest __tests__/CreateVibeCodingScreen.test.tsx`
Expected: PASS（新旧全绿）

- [ ] **Step 5: Commit**

```bash
cd PHONE && git add src/screens/vibecoding/CreateVibeCodingScreen.tsx __tests__/CreateVibeCodingScreen.test.tsx
git commit -m "create: 端口映射占位开关接通为真功能（能力+隧道可用性门控）"
```

### Task 11: 发送链路 payload 贯通

**Files:**
- Modify: `src/screens/vibecoding/VibeCodingSessionScreen.tsx:1067`（draft 首发调 startAgentSession）
- Modify: `src/store/slices/aiSessionSlice.ts:155`（createAiSession input）
- Modify: `src/api/sessions.ts:374`（createAiSession 入参类型）
- Test: `__tests__/sessionStore.test.ts`（追加；若该文件不含 startAgentSession 用例，按其现有 harness 追加 describe）

- [ ] **Step 1: 写失败测试**

```typescript
it('startAgentSession forwards expose_preview_port when input flag set', async () => {
  // 用该文件现有 transport mock 手法捕获 createAiSession 入参；
  // 输入 { exposePreviewPort: true, ...最小合法 StartAgentInput }
  // 断言收到的 payload.expose_preview_port === true；
  // 再跑一次不带 flag，断言 === false。
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd PHONE && npx jest __tests__/sessionStore.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现（三处一行/一参数）**

1. `api/sessions.ts` createAiSession 入参类型 `canRun?: boolean;` 后加：

```typescript
  /**
   * Create-flow flag: the server auto-exposes agent-reported preview ports as
   * public tunnel mappings for this session (24h TTL). Wire field is snake_case.
   */
  expose_preview_port?: boolean;
```

2. `aiSessionSlice.ts` createAiSession 调用（`canRun: input.canRun,` 行后）加：

```typescript
          expose_preview_port: input.exposePreviewPort === true,
```

3. `VibeCodingSessionScreen.tsx` draft 发送（`canRun: draftConfig.canRun,` 附近，~:1067 起）加：

```typescript
          exposePreviewPort: draftConfig.exposePreviewPort === true,
```

- [ ] **Step 4: 跑测试 + typecheck**

Run: `cd PHONE && npx jest __tests__/sessionStore.test.ts && npx tsc --noEmit`
Expected: PASS / 0 errors

- [ ] **Step 5: Commit**

```bash
cd PHONE && git add src/screens/vibecoding/VibeCodingSessionScreen.tsx src/store/slices/aiSessionSlice.ts src/api/sessions.ts __tests__/sessionStore.test.ts
git commit -m "session: expose_preview_port 随首条消息上行到 createAiSession"
```

### Task 12: store 收 `preview.updated`

**Files:**
- Modify: `src/store/controlCenterStore.ts:1262`（preview.ready case 旁加 preview.updated case）
- Test: `__tests__/platformTransport.test.ts`（追加 preview.updated 映射用例；注意该文件**现有用例里没有 preview.ready 可照抄**——socketHandler dispatch harness 直接复用，按现有 case 的写法新起）；store 级合并用例放 `__tests__/sessionStore.test.ts` 或按现有 store 测试文件归属

- [ ] **Step 1: 写失败测试**

platformTransport.test.ts：

```typescript
it('maps preview.updated WS message to preview.updated transport event with mapping fields', () => {
  // 复用现有 preview.ready 映射用例的调用手法，message.type='preview.updated'，
  // preview 带 public_url/port_mapping_id/mapping_status；
  // 断言产出 { type: 'preview.updated', preview: { publicUrl, portMappingId, mappingStatus } }。
});
```

store 测试：

```typescript
it('preview.updated merges previewLinks without flipping run status', () => {
  // 预置一个 previewLink + 一个已 idle 的 run（sessionId 相同）；
  // 派发 preview.updated（同 id、带 publicUrl）；
  // 断言 previewLinks 更新且 run.status 仍为 'idle'（不被翻成 preview_ready）。
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd PHONE && npx jest __tests__/platformTransport.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`controlCenterStore.ts` 在 `case 'preview.ready': {...}` 后加：

```typescript
            case 'preview.updated': {
              // Auto port-forwarding convergence: only the link record changes
              // (publicUrl/mappingStatus). Deliberately NOT flipping run status
              // here — preview.ready already did that, and a late mapping result
              // must not resurrect a settled run.
              const updated = transportEvent.preview;
              set(state => ({
                previewLinks: [
                  { ...updated, expiresIn: updated.expiresIn ?? '' },
                  ...state.previewLinks.filter(p => p.id !== updated.id),
                ],
              }));
              return;
            }
```

> 类型对齐：`transportEvent.preview` 为 `PlatformPreviewSnapshot`，`previewLinks` 元素为 `PreviewLink`（platformModels）——字段名一致，直接展开即可；如 tsc 报 access/expiresIn 类型差，就地映射（`access: updated.access as PreviewLink['access']`，照 :1270 既有手法）。

- [ ] **Step 4: 跑测试 + typecheck**

Run: `cd PHONE && npx jest __tests__/platformTransport.test.ts __tests__/sessionStore.test.ts && npx tsc --noEmit`
Expected: PASS / 0 errors

- [ ] **Step 5: Commit**

```bash
cd PHONE && git add src/store/controlCenterStore.ts __tests__/platformTransport.test.ts
git commit -m "store: preview.updated 只合并链接记录，不翻 run 状态"
```

### Task 13: preview 卡片公网 UI（含子组件抽取）

**Files:**
- Create: `src/screens/vibecoding/SessionPreviewCard.tsx`
- Modify: `src/screens/vibecoding/VibeCodingSessionScreen.tsx:2371`（卡片替换为子组件）
- Test: `__tests__/vibecoding/SessionPreviewCard.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

```typescript
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import { SessionPreviewCard } from '../../src/screens/vibecoding/SessionPreviewCard';

const basePreview = {
  id: 'prev_1', sessionId: 'ai_s1', port: 3000,
  shortUrl: 'http://lan:3000', targetUrl: 'http://127.0.0.1:3000',
  access: 'private' as const, expiresIn: '24h',
};

const t = (key: string) => key;

const wrap = async (ui: React.ReactElement) => {
  let r: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => { r = ReactTestRenderer.create(ui); });
  return r!;
};

describe('SessionPreviewCard', () => {
  it('shows public URL with copy/open/revoke when mapped', async () => {
    const onRevoke = jest.fn();
    const r = await wrap(
      <SessionPreviewCard
        preview={{ ...basePreview, publicUrl: 'https://abc.tunnel.test', portMappingId: 'pm_1', mappingStatus: 'mapped' }}
        t={t} onRevoke={onRevoke}
      />,
    );
    expect(JSON.stringify(r.toJSON())).toContain('https://abc.tunnel.test');
    const buttons = r.root.findAllByType(TouchableOpacity);
    expect(buttons.length).toBeGreaterThanOrEqual(3); // card + copy + open (+ revoke)
    // 触发 revoke 按钮呈现确认回调
  });

  it('hides action buttons and shows revoked chip when revoked', async () => {
    const r = await wrap(
      <SessionPreviewCard
        preview={{ ...basePreview, publicUrl: 'https://abc.tunnel.test', mappingStatus: 'revoked' }}
        t={t} onRevoke={jest.fn()}
      />,
    );
    expect(JSON.stringify(r.toJSON())).toContain('sessionPreview.revoked');
  });

  it('shows neutral failure notice for failed/unavailable without error styling', async () => {
    const r = await wrap(
      <SessionPreviewCard
        preview={{ ...basePreview, mappingStatus: 'unavailable', mappingError: 'agent_offline' }}
        t={t} onRevoke={jest.fn()}
      />,
    );
    expect(JSON.stringify(r.toJSON())).toContain('sessionPreview.failed');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd PHONE && npx jest __tests__/vibecoding/SessionPreviewCard.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现子组件**

`src/screens/vibecoding/SessionPreviewCard.tsx`：

```tsx
/**
 * Session preview card with optional auto-created public tunnel mapping.
 * Pure presentational: data in via `preview`, actions out via callbacks.
 * - mapped:    公网 badge + publicUrl + copy/open/revoke buttons
 * - failed/unavailable: neutral notice line (agent shortUrl unaffected)
 * - revoked:   grey chip, action buttons removed (already-copied links may
 *              resolve until gateway expiry — that's the user's copy, not ours)
 */
import React, { useState } from 'react';
import { Alert, Clipboard, Linking, Text, TouchableOpacity, View } from 'react-native';
import type { PreviewLink } from '../../data/platformModels';
import { GlassPanel, StatusChip } from '../../components/ui'; // 以屏幕现有导入路径为准
import { useTheme } from '../../theme/ThemeContext';

interface Props {
  preview: PreviewLink;
  t: (key: string) => string;
  onNavigate: () => void;
  onRevoke: () => Promise<void>;
}

export function SessionPreviewCard({ preview, t, onNavigate, onRevoke }: Props) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const mapped = preview.mappingStatus === 'mapped' && preview.publicUrl;
  const failed = preview.mappingStatus === 'failed' || preview.mappingStatus === 'unavailable';
  const revoked = preview.mappingStatus === 'revoked';

  return (
    <View>
      <TouchableOpacity activeOpacity={0.75} onPress={onNavigate}>
        <GlassPanel glowColor="primary" style={undefined as never}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
              Preview ready
            </Text>
            <StatusChip label={`${preview.port}`} type="info" />
          </View>
          <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
            {preview.shortUrl}
          </Text>
          {mapped ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <StatusChip label={t('sessionPreview.publicBadge')} type="success" />
                <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                  {preview.publicUrl}
                </Text>
              </View>
            </>
          ) : null}
          {failed ? (
            <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant, marginTop: 4 }]}>
              {`${t('sessionPreview.failed')}${preview.mappingError ? ` · ${preview.mappingError}` : ''}`}
            </Text>
          ) : null}
          {revoked ? (
            <View style={{ marginTop: 4 }}>
              <StatusChip label={t('sessionPreview.revoked')} type="neutral" />
            </View>
          ) : null}
          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            {preview.access.toUpperCase()} / expires in {preview.expiresIn}
          </Text>
        </GlassPanel>
      </TouchableOpacity>

      {mapped ? (
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
          <TouchableOpacity
            testID="preview-copy-public"
            onPress={() => {
              Clipboard.setString(preview.publicUrl ?? '');
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}>
            <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
              {copied ? t('sessionPreview.copied') : t('sessionPreview.copy')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="preview-open-public"
            onPress={() => { void Linking.openURL(preview.publicUrl ?? ''); }}>
            <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
              {t('sessionPreview.open')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="preview-revoke"
            onPress={() => {
              Alert.alert(t('sessionPreview.revokeTitle'), t('sessionPreview.revokeBody'), [
                { text: 'Cancel', style: 'cancel' },
                { text: t('sessionPreview.revoke'), style: 'destructive', onPress: () => { void onRevoke(); } },
              ]);
            }}>
            <Text style={[theme.typography.labelSm, { color: theme.colors.error }]}>
              {t('sessionPreview.revoke')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
```

> 执行者注意：真实导入路径为本仓既有：`import { GlassPanel } from '../../components/shared/GlassPanel'`、`import { StatusChip } from '../../components/shared/StatusChip'`、`import { useTheme } from '../../theme/useTheme'`（以 `VibeCodingSessionScreen.tsx` 现有卡片代码 :2371-2406 的实际导入为准照抄）；`styles.previewCard` 等样式随组件迁移或以 props 传入；上面 `undefined as never` 占位处替换为真实样式。`Clipboard` 从 `react-native` 取（同 PortMappingsScreen 手法）。

- [ ] **Step 4: 会话屏接线**

`VibeCodingSessionScreen.tsx` 原 `{preview && (<TouchableOpacity ...>...</TouchableOpacity>)}` 块（:2371-2407）替换为：

```tsx
          {preview && (
            <SessionPreviewCard
              preview={preview}
              t={t}
              onNavigate={() => navigation.navigate('Preview', { previewId: preview.id })}
              onRevoke={async () => {
                if (!preview.portMappingId) return;
                try {
                  await revokePortMapping(preview.portMappingId);
                  // Server also flips + broadcasts preview.updated (DELETE 联动);
                  // the WS merge converges this card to 'revoked'.
                } catch {
                  // 静默：下一次轮询/事件会纠正状态
                }
              }}
            />
          )}
```

import `SessionPreviewCard` 与 `revokePortMapping`（from `../../api/portMappings`）。`Alert` 若会话屏已有确认弹窗组件则换用现有组件。

- [ ] **Step 5: 跑测试 + typecheck + 相关回归**

Run: `cd PHONE && npx jest __tests__/vibecoding/SessionPreviewCard.test.tsx __tests__/PreviewScreen.test.tsx && npx tsc --noEmit`
Expected: PASS / 0 errors

- [ ] **Step 6: Commit**

```bash
cd PHONE && git add src/screens/vibecoding/SessionPreviewCard.tsx src/screens/vibecoding/VibeCodingSessionScreen.tsx __tests__/vibecoding/SessionPreviewCard.test.tsx
git commit -m "session: preview 卡片公网地址展示/复制/打开/撤销（子组件抽取）"
```

### Task 14: 端到端冒烟 + 收尾

**Files:**
- Modify: `SERVER/scripts/tunnel-e2e.mjs`（追加 preview 链路段，**视 harness 能力**）
- Modify: `SERVER` 侧如无，则 PHONE 仓 `docs/superpowers/specs/` 同级补验证记录（可选）

- [ ] **Step 1: 评估 harness 注入点**

读 `SERVER/scripts/tunnel-e2e.mjs`：确认脚本如何驱动 agent（真 Go agent 由脚本起、经 WS 连脚本内 server）。查找是否有「脚本模拟 agent 下行/上行消息」的既有机制（如 fake agent WS client）。
- 若脚本内已有可注入 agent 消息的通道（fake/pipeline），继续 Step 2；
- 若只能走真 agent（真 CLI 才会发 preview.ready），**本任务降级为记录性收尾**：在 e2e 输出加一行 `preview-mapping: covered by unit/integration tests (previewMapping.test.ts + previewMappingHook.test.ts)`，跳到 Step 4。

- [ ] **Step 2: 追加 e2e 段（可注入时）**

在既有断言链（建映射→公网命中→WS echo→撤销→410）后追加：

```js
// --- preview-driven auto mapping ---
// 1. POST /api/ai/sessions {device_id, expose_preview_port:true, message:'preview smoke'}
// 2. 注入 agent 消息 {type:'preview.ready', session_id, port:<demo-target 端口>, ...}
// 3. 轮询 GET /api/ai/sessions/:id 直到快照 preview_links[0].mapping_status==='mapped'（10s 上限）
//    （或直接 GET /api/previews 断言 public_url）
// 4. HTTP GET 公网 short_url 断言 200 且 Host 改写（复用既有公网请求助手）
// 5. DELETE /api/port-mappings/:mapping_id → 断言 preview_links[0].mapping_status==='revoked'
// 6. 再次注入同 port 的 preview.ready → 断言新建了第二个 mapping（去重复核 404→重建）
console.log('preview-mapping: ok');
```

Run: `cd SERVER && npm run build && node scripts/tunnel-e2e.mjs`
Expected: 既有 `tunnel-e2e: ok` + `preview-mapping: ok`

- [ ] **Step 3: 全量回归（两仓）**

Run: `cd SERVER && npx tsc -p server/tsconfig.json --noEmit && npx vitest run`
Run: `cd PHONE && npx tsc --noEmit && npx jest`
Expected: 两仓全绿（phone 基线外零新增失败；已知 terminal 基线 flake 如出现不计）

- [ ] **Step 4: Commit（如改了脚本）**

```bash
cd SERVER && git add scripts/tunnel-e2e.mjs
git commit -m "e2e: tunnel 冒烟追加 preview 驱动自动映射链路"
```

---

## 验收清单（全部完成后逐项核对）

- [ ] SERVER `npx vitest run` 全绿、`npx tsc -p server/tsconfig.json --noEmit` 0 errors
- [ ] PHONE `npx jest` 全绿（基线外零新增失败）、`npx tsc --noEmit` 0 errors
- [ ] 手动核对（可选，部署后）：创建页开关在 tunnel-enabled 部署下可开；AI 起 dev server 后 preview 卡片出现公网徽标与地址；撤销后刷新不复活
- [ ] 未动 agent 仓与网关仓（`git -C alianggate status` 干净）
