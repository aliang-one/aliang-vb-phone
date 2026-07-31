# 创建 vibecoding 权限区做成真功能 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把创建 vibecoding 页的 4 个装饰性权限开关改成 per-session 真功能:审批策略三档(放行/逐项/只读)+ Read/Modify/Run 能力开关 + 端口映射置灰展示,服务器真强制。

**Architecture:** 服务器在现有 path 级策略解析里合并"该 (device,path) 当前活跃会话"的覆盖(agent 零改)。会话表加可空列(approval_scheme + can_read/can_modify/can_run,null=继承)。纯函数 `applySessionOverride` 负责把覆盖叠加成 `ApprovalPolicy`(deny-first)。创建页 UI 替换 4 个死开关,选择经 `draftConfig` → 首条消息建会话写入新列。

**Tech Stack:** TypeScript (Node/Express server + React Native phone), better-sqlite3 + pg, zod schemas, i18next, jest/vitest。

**Spec:** `AliangVibeCodingPhone/docs/superpowers/specs/2026-07-31-vibecoding-create-permissions-real-design.md`

**跨仓说明:** Task 1–7 在 `AliangPhoneServer`,Task 8–12 在 `AliangVibeCodingPhone`。每个 task 的 commit 进各自仓库,只 add 本特性的文件。两仓当前都有与本文无关的预存未提交改动,**不要**碰它们。

---

## 文件结构

### 服务端 (`AliangPhoneServer`)
| 文件 | 责任 | 动作 |
|------|------|------|
| `server/src/modules/approval/sessionPolicy.ts` | **新**。纯函数:`SessionApprovalScheme` 类型、工具集常量、`applySessionOverride(base, override)`。 | Create |
| `server/src/modules/approval/policy.ts` | 复用 `ApprovalPolicy`/`ApprovalRule`/`computePolicyHash`。 | (不改,只引用) |
| `server/src/types.ts` | `AiSession` 接口加 4 字段;新增 `SessionPermissionOverride` 导入。 | Modify |
| `server/src/schemas.ts` | 建/派发会话的 zod schema 加可选字段。 | Modify |
| `server/src/database.ts` | `ai_sessions` 建表 + `ensureColumn` + INSERT(:168) + 行映射;`resolveSessionApprovalPolicy(deviceId,path)`;`findActiveSessionByPath`。 | Modify |
| `server/src/postgresDatabase.ts` | 镜像:建表/迁移/INSERT/行映射。 | Modify |
| `server/src/modules/agent/routes.ts` | `handleAgentApprovalPolicy`(:38)/`…Hash`(:62) 改调 `resolveSessionApprovalPolicy`。 | Modify |
| `server/src/modules/agent/handler.ts` | approval 解析(:965 附近)按 `approval.session_id` 解析 session 覆盖。 | Modify |
| 建会话写入路径(`dispatchUserAiMessage` / POST sessions) | 透传新字段到 INSERT。 | Modify |
| `server/test/modules/approval/sessionPolicy.test.ts` | **新**。纯函数测试矩阵。 | Create |
| `server/test/.../resolveSession.test.ts` | **新**。resolver 回退/合并测试。 | Create |

### 手机端 (`AliangVibeCodingPhone`)
| 文件 | 责任 | 动作 |
|------|------|------|
| `src/app/navigation/types.ts` | `draftConfig`(:32) 加 `approvalScheme?` + `canRead?/canModify?/canRun?`。 | Modify |
| `src/screens/vibecoding/CreateVibeCodingScreen.tsx` | 替换 permissions 区:审批 chip 行 + 能力 toggle + 置灰端口映射;修编号;remember-last。 | Modify |
| `src/screens/vibecoding/VibeCodingSessionScreen.tsx` | 建会话分派(:1217) 带新字段。 | Modify |
| `src/locales/*/vibecoding.json`(及 en 镜像) | i18n key。 | Modify |
| `__tests__/CreateVibeCodingScreen.test.tsx` | **新**或扩。UI 行为测试。 | Create/Modify |

---

## Task 1: 服务端 — 纯函数 `applySessionOverride` (TDD 核心)

**Files:**
- Create: `AliangPhoneServer/server/src/modules/approval/sessionPolicy.ts`
- Test: `AliangPhoneServer/server/test/modules/approval/sessionPolicy.test.ts`

- [ ] **Step 1: 写失败测试(矩阵)**

```ts
// server/test/modules/approval/sessionPolicy.test.ts
import { describe, it, expect } from 'vitest';
import { applySessionOverride, type SessionPermissionOverride } from '../../../src/modules/approval/sessionPolicy';
import { balancedPolicy, allowAllPolicy } from '../../../src/modules/approval/policy';

const base = balancedPolicy(); // default_decision=require_approval,有 file-mutation auto_approve 等

describe('applySessionOverride', () => {
  it('无覆盖返回 base 不变', () => {
    expect(applySessionOverride(base, {})).toEqual(base);
  });

  it('allow_all: default=auto_approve,保留 dangerous-bash', () => {
    const p = applySessionOverride(base, { approvalScheme: 'allow_all' });
    expect(p.default_decision).toBe('auto_approve');
    expect(p.rules.some(r => r.id === 'dangerous-bash')).toBe(true);
  });

  it('ask_all: default=require_approval,去掉 auto_approve 规则', () => {
    const p = applySessionOverride(base, { approvalScheme: 'ask_all' });
    expect(p.default_decision).toBe('require_approval');
    expect(p.rules.every(r => r.decision !== 'auto_approve')).toBe(true);
  });

  it('read_only: 写/执行 auto_deny,读仍可用', () => {
    const p = applySessionOverride(base, { approvalScheme: 'read_only' });
    const deny = p.rules.filter(r => r.decision === 'auto_deny');
    const deniedTools = deny.flatMap(r => r.match.tool ?? []);
    expect(deniedTools).toEqual(expect.arrayContaining(['Write','Edit','MultiEdit','NotebookEdit','Bash']));
    expect(deniedTools).not.toContain('Read');
    // deny 规则排在最前(deny-first)
    expect(p.rules.findIndex(r => r.decision==='auto_deny')).toBeLessThan(
      p.rules.findIndex(r => r.decision==='auto_approve'));
  });

  it('canModify=false 单独: 写 auto_deny,其余不变', () => {
    const p = applySessionOverride(base, { canModify: false });
    const deniedTools = p.rules.filter(r=>r.decision==='auto_deny').flatMap(r=>r.match.tool??[]);
    expect(deniedTools).toEqual(['Write','Edit','MultiEdit','NotebookEdit']);
    expect(p.default_decision).toBe(base.default_decision); // 未改 default
  });

  it('canRun=false: Bash auto_deny', () => {
    const p = applySessionOverride(base, { canRun: false });
    const deniedTools = p.rules.filter(r=>r.decision==='auto_deny').flatMap(r=>r.match.tool??[]);
    expect(deniedTools).toEqual(['Bash']);
  });

  it('canRead=false: 读 auto_deny', () => {
    const p = applySessionOverride(base, { canRead: false });
    const deniedTools = p.rules.filter(r=>r.decision==='auto_deny').flatMap(r=>r.match.tool??[]);
    expect(deniedTools).toEqual(expect.arrayContaining(['Read','Grep','Glob','LS']));
  });

  it('组合: ask_all + canRun=false → 写 require(ask)、Bash deny', () => {
    const p = applySessionOverride(base, { approvalScheme:'ask_all', canRun:false });
    expect(p.default_decision).toBe('require_approval');
    const bashRule = p.rules.find(r => r.match.tool?.includes('Bash') && r.decision==='auto_deny');
    expect(bashRule).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd AliangPhoneServer && npx vitest run server/test/modules/approval/sessionPolicy.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 写实现**

```ts
// server/src/modules/approval/sessionPolicy.ts
import type { ApprovalPolicy, ApprovalRule } from './policy.js';
import { computePolicyHash } from './policy.js';

// 会话级 scheme(与 project/device 的 'balanced'|'allow_all'|'custom' 分开)。
// null/undefined = 继承项目策略。
export type SessionApprovalScheme = 'allow_all' | 'ask_all' | 'read_only';

export interface SessionPermissionOverride {
  approvalScheme?: SessionApprovalScheme | null;
  canRead?: boolean | null;
  canModify?: boolean | null;
  canRun?: boolean | null;
}

// 工具集与 policy.ts 的 balanced 规则一致(文件改写 / 执行 / 只读)。
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const EXEC_TOOLS = ['Bash'];
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'LS'];

const hasCapabilityOff = (o: SessionPermissionOverride) =>
  o.canRead === false || o.canModify === false || o.canRun === false;

// 把会话覆盖叠加到 base 策略。纯函数。deny-first:auto_deny 规则排在所有
// allow/require 规则之前(policy.ts:43-46 既定约定)。
export function applySessionOverride(
  base: ApprovalPolicy,
  override: SessionPermissionOverride,
): ApprovalPolicy {
  const scheme = override.approvalScheme ?? null;
  if (!scheme && !hasCapabilityOff(override)) return base;

  const modifyOff = scheme === 'read_only' || override.canModify === false;
  const runOff = scheme === 'read_only' || override.canRun === false;
  const readOff = override.canRead === false; // read_only 保留读

  const denyRules: ApprovalRule[] = [];
  if (modifyOff) denyRules.push({ id: 'session-deny-write', match: { tool: WRITE_TOOLS }, decision: 'auto_deny', reason: '本会话已关闭修改文件' });
  if (runOff)    denyRules.push({ id: 'session-deny-exec',  match: { tool: EXEC_TOOLS },  decision: 'auto_deny', reason: '本会话已关闭命令执行' });
  if (readOff)   denyRules.push({ id: 'session-deny-read',  match: { tool: READ_TOOLS },  decision: 'auto_deny', reason: '本会话已关闭读文件' });

  let defaultDecision = base.default_decision;
  let rules = base.rules;

  if (scheme === 'allow_all') {
    defaultDecision = 'auto_approve';
    // 保留 base 规则(dangerous-bash 仍 escalate),仅 default 放行未匹配项。
  } else if (scheme === 'ask_all') {
    defaultDecision = 'require_approval';
    rules = base.rules.filter(r => r.decision !== 'auto_approve'); // 去掉自动放行,万物 escalate
  } else if (scheme === 'read_only') {
    defaultDecision = 'require_approval'; // 读由 base 的 readonly-tools auto_approve;其余 escalate
    rules = base.rules; // 保留(含读的 auto_approve);写/执行已被 deny 规则盖过
  }

  const merged: ApprovalPolicy = {
    ...base,
    default_decision: defaultDecision,
    rules: [...denyRules, ...rules],
  };
  merged.hash = computePolicyHash(merged);
  return merged;
}
```

> 若 `computePolicyHash` 签名要求去掉 `hash` 字段再传入,按 `policy.ts` 现有用法对齐(参考 `balancedPolicy()` 怎么算 hash)。实现者读 `policy.ts:165-200` 确认。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd AliangPhoneServer && npx vitest run server/test/modules/approval/sessionPolicy.test.ts`
Expected: PASS(8/8)。若 read_only 断言失败,调整实现使其满足测试语义(写/执行 deny、读可用、deny-first),**以测试为准**。

- [ ] **Step 5: 提交**

```bash
git -C AliangPhoneServer add server/src/modules/approval/sessionPolicy.ts server/test/modules/approval/sessionPolicy.test.ts
git -C AliangPhoneServer commit -m "feat(approval): 会话级策略覆盖纯函数 applySessionOverride + 测试矩阵"
```

---

## Task 2: 服务端 — 类型与 schema

**Files:**
- Modify: `AliangPhoneServer/server/src/types.ts`(找到 `interface AiSession`)
- Modify: `AliangPhoneServer/server/src/schemas.ts`

- [ ] **Step 1: AiSession 加字段**

在 `types.ts` 的 `interface AiSession` 内(含 `effort`/`risk`/`provider` 等字段处)加:
```ts
  approvalScheme?: SessionApprovalScheme | null; // null=继承项目
  canRead?: boolean | null;
  canModify?: boolean | null;
  canRun?: boolean | null;
```
并在文件顶 import:`import type { SessionApprovalScheme } from './modules/approval/sessionPolicy.js';`
(若循环依赖,把 `SessionApprovalScheme` 类型字面量内联或挪到 types.ts 定义、sessionPolicy.ts 再 import。)

- [ ] **Step 2: 建/派发会话的 zod schema 加可选字段**

`schemas.ts` 找到建会话/首条消息的 schema(`createAiSessionSchema` 类似名,围绕 `schemas.ts:58-85` 的注释区)。加:
```ts
  approvalScheme: z.enum(['allow_all','ask_all','read_only']).optional(),
  canRead: z.boolean().optional(),
  canModify: z.boolean().optional(),
  canRun: z.boolean().optional(),
```

- [ ] **Step 3: typecheck**

Run: `cd AliangPhoneServer && npx tsc -p server/tsconfig.json -noEmit`(或仓库现有 typecheck 命令;参考已 commit 的 `tsc -0` 约定)
Expected: 0 error(本特性不引入新错)。

- [ ] **Step 4: 提交**

```bash
git -C AliangPhoneServer add server/src/types.ts server/src/schemas.ts
git -C AliangPhoneServer commit -m "feat(approval): AiSession 加会话级 approvalScheme/canRead/canModify/canRun 字段"
```

---

## Task 3: 服务端 — DB 建表/迁移/行映射/INSERT (sqlite)

**Files:**
- Modify: `AliangPhoneServer/server/src/database.ts`

- [ ] **Step 1: CREATE TABLE 加列**

`database.ts` 的 `ai_sessions` CREATE TABLE(围绕 `:365-400`)末尾加:
```sql
  approval_scheme TEXT,
  can_read INTEGER,
  can_modify INTEGER,
  can_run INTEGER,
```
(均 nullable,默认 null=继承。)

- [ ] **Step 2: ensureColumn 迁移**

在 `initializeSchema`/`ensureColumn` 区(`:1007`、`:1031` 那批 ensureColumn 附近)加:
```ts
this.ensureColumn('ai_sessions', 'approval_scheme', 'TEXT');
this.ensureColumn('ai_sessions', 'can_read', 'INTEGER');
this.ensureColumn('ai_sessions', 'can_modify', 'INTEGER');
this.ensureColumn('ai_sessions', 'can_run', 'INTEGER');
```

- [ ] **Step 3: INSERT 语句加列**

`database.ts:168` 的 `INSERT INTO ai_sessions (...)` 列表 + VALUES 加 4 列。找到对应 `upsert`/`create` 方法,把 `session.approvalScheme`/`canRead`/`canModify`/`canRun` 写入(用 `?? null`)。

- [ ] **Step 4: 行映射加字段**

`rowToAiSession`(搜 `function rowToAiSession` 或类似)加:
```ts
  approvalScheme: (row.approval_scheme as SessionApprovalScheme | null) ?? null,
  canRead: row.can_read == null ? null : !!row.can_read,
  canModify: row.can_modify == null ? null : !!row.can_modify,
  canRun: row.can_run == null ? null : !!row.can_run,
```

- [ ] **Step 5: typecheck + 已有测试不破**

Run: `cd AliangPhoneServer && npx tsc -p server/tsconfig.json -noEmit && npx vitest run server/test/modules/approval/policy.test.ts`
Expected: 0 error;policy 测试仍绿。

- [ ] **Step 6: 提交**

```bash
git -C AliangPhoneServer add server/src/database.ts
git -C AliangPhoneServer commit -m "feat(approval): ai_sessions 加 approval_scheme/can_read/can_modify/can_run 列+迁移+映射"
```

---

## Task 4: 服务端 — PG 镜像

**Files:**
- Modify: `AliangPhoneServer/server/src/postgresDatabase.ts`

- [ ] **Step 1: 镜像 sqlite 三处**

照 `postgresDatabase.ts` 现有模式(`:571` 附近 projects approval_scheme 的 ADD COLUMN、INSERT、行映射),对 `ai_sessions` 做:
- `CREATE TABLE IF NOT EXISTS ai_sessions` 加 4 列 + `ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS …`(4 条)。
- INSERT 语句加列。
- 行映射加字段(同 sqlite)。

- [ ] **Step 2: typecheck**

Run: `cd AliangPhoneServer && npx tsc -p server/tsconfig.json -noEmit`
Expected: 0 error。

- [ ] **Step 3: 提交**

```bash
git -C AliangPhoneServer add server/src/postgresDatabase.ts
git -C AliangPhoneServer commit -m "feat(approval): postgresDatabase 镜像 ai_sessions 会话级权限列"
```

---

## Task 5: 服务端 — resolver `resolveSessionApprovalPolicy` (TDD)

**Files:**
- Modify: `AliangPhoneServer/server/src/database.ts`
- Create: `AliangPhoneServer/server/test/modules/approval/resolveSession.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// server/test/modules/approval/resolveSession.test.ts
import { describe, it, expect } from 'vitest';
// 用仓库现有的内存/临时 sqlite 构造 DB 的方式(参考其它 database 测试怎么 new SQLiteDatabase)
// 这里用伪代码,实现者对齐现有测试搭建习惯。
describe('resolveSessionApprovalPolicy', () => {
  it('无活跃会话 → 回退项目策略', () => { /* base 不变 */ });
  it('活跃会话无覆盖 → 回退项目策略', () => { /* session 字段全 null */ });
  it('活跃会话带 read_only → 写/执行 deny', () => {});
  it('同 path 多会话 → 取 last_active_at 最大那条', () => {});
  it('closed 会话不计入活跃', () => {});
});
```
> 实现者参考 `server/test/modules/approval/policy.test.ts` 和任意 database 测试的 DB 搭建方式补全 setup。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd AliangPhoneServer && npx vitest run server/test/modules/approval/resolveSession.test.ts`
Expected: FAIL(方法不存在)。

- [ ] **Step 3: 实现**

在 `database.ts` 的 SQLiteDatabase 类内,`resolveProjectApprovalPolicyByPath`(`:1331`)旁加:
```ts
  // (device,path) 上最近活跃且未 closed 的 vibe 会话;无则 undefined。
  findActiveSessionByPath(deviceId: string, path: string): AiSession | undefined {
    const row = this.prepare(
      `SELECT * FROM ai_sessions
       WHERE device_id = ? AND project_path = ? AND closed_at IS NULL
       ORDER BY datetime(last_active_at) DESC LIMIT 1`,
    ).get(deviceId, normalizeRemotePath(path)) as Record<string, unknown> | undefined;
    return row ? rowToAiSession(row) : undefined;
  }

  resolveSessionApprovalPolicy(deviceId: string, path: string): ApprovalPolicy {
    const base = this.resolveProjectApprovalPolicyByPath(deviceId, path);
    const session = this.findActiveSessionByPath(deviceId, path);
    if (!session) return base;
    const hasOverride = session.approvalScheme ||
      session.canRead != null || session.canModify != null || session.canRun != null;
    if (!hasOverride) return base;
    return applySessionOverride(base, {
      approvalScheme: session.approvalScheme ?? null,
      canRead: session.canRead ?? null,
      canModify: session.canModify ?? null,
      canRun: session.canRun ?? null,
    });
  }
```
(对齐 `normalizeRemotePath` / `rowToAiSession` 的实际可访问性;若 `rowToAiSession` 是模块私有,在同一文件内直接调用即可。)

- [ ] **Step 4: 跑测试确认通过**

Run: `cd AliangPhoneServer && npx vitest run server/test/modules/approval/resolveSession.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git -C AliangPhoneServer add server/src/database.ts server/test/modules/approval/resolveSession.test.ts
git -C AliangPhoneServer commit -m "feat(approval): resolveSessionApprovalPolicy 合并活跃会话覆盖(path-as-session-proxy)"
```

---

## Task 6: 服务端 — 接线 agent 策略端点 + approval 解析

**Files:**
- Modify: `AliangPhoneServer/server/src/modules/agent/routes.ts`
- Modify: `AliangPhoneServer/server/src/modules/agent/handler.ts`

- [ ] **Step 1: 策略拉取端点改调 session resolver**

`agent/routes.ts:49-51` 与 `:73-75`,把
```ts
const policy = projectPath ? await db.resolveProjectApprovalPolicyByPath(device.id, projectPath) : balancedPolicy();
```
改为
```ts
const policy = projectPath ? db.resolveSessionApprovalPolicy(device.id, projectPath) : balancedPolicy();
```
(确认 `resolveSessionApprovalPolicy` 是同步;PG 驱动下若为 async,加 `await`。两个端点都改。)

- [ ] **Step 2: approval 解析按 session_id**

`handler.ts:965` 附近(`resolveProjectApprovalPolicy(approvalProject)` 处),改为:若有 `approval.sessionId`,先取该 session 的覆盖叠到 project 策略上(用 `applySessionOverride`);否则维持现状。这是 `ask_all` 兜底(服务器侧 per-session 决策)。

```ts
// 伪代码
const baseProjectPolicy = db.resolveProjectApprovalPolicy(approvalProject);
const session = approval.sessionId ? db.getAiSession(approval.sessionId) : undefined;
const policy = session && hasOverride(session)
  ? applySessionOverride(baseProjectPolicy, toOverride(session))
  : baseProjectPolicy;
// 用 policy 决定 approval 自动结果
```

- [ ] **Step 3: typecheck + 现有 agent/approval 测试不破**

Run: `cd AliangPhoneServer && npx tsc -p server/tsconfig.json -noEmit && npx vitest run server/test/modules/approval`
Expected: 0 error;approval 测试仍绿。

- [ ] **Step 4: 提交**

```bash
git -C AliangPhoneServer add server/src/modules/agent/routes.ts server/src/modules/agent/handler.ts
git -C AliangPhoneServer commit -m "feat(approval): agent 策略端点 + approval 解析接 session 级覆盖"
```

---

## Task 7: 服务端 — 建会话透传新字段

**Files:**
- Modify: `AliangPhoneServer/server/src/modules/ai/agentPublish.ts`(或实际写 ai_sessions 行的 handler)
- Modify: 建会话的 route handler(`POST /api/ai/sessions` 之类)

- [ ] **Step 1: 定位写入点**

Run: `cd AliangPhoneServer && grep -n "ai_sessions" server/src/database.ts | head -5` 确认 `:168` INSERT 所在方法名;再 `grep -rn "<那个方法名>" server/src` 找调用方(建会话 route / `dispatchUserAiMessage`)。

- [ ] **Step 2: 透传字段**

让建会话请求体(Task 2 schema 已接受)的 4 个字段流到 INSERT 调用:`session.approvalScheme`/`canRead`/`canModify`/`canRun`。若 `dispatchUserAiMessage`(`mobile/handler.ts:285`)是入口,在它构造 session 对象处带上从请求读到的值。

- [ ] **Step 3: 路由/契约测试**

补/扩一个测试:POST 建会话带 `approvalScheme:'ask_all'`,回读 session 含该字段;agent 拉策略(该 path)得到 `default_decision=require_approval`。

Run: `cd AliangPhoneServer && npx vitest run server/test -t "session"`(或相关命名)
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git -C AliangPhoneServer add <改动文件>
git -C AliangPhoneServer commit -m "feat(approval): 建会话透传 approvalScheme/canRead/canModify/canRun"
```

---

## Task 8: 手机端 — `draftConfig` 类型

**Files:**
- Modify: `AliangVibeCodingPhone/src/app/navigation/types.ts:32`

- [ ] **Step 1: 加字段**

```ts
  draftConfig?: {
    deviceId: string;
    projectId?: string;
    directory: string;
    provider: AgentProvider;
    model?: string;
    effort?: string;
    // 新增:
    approvalScheme?: 'allow_all' | 'ask_all' | 'read_only';
    canRead?: boolean;
    canModify?: boolean;
    canRun?: boolean;
  };
```

- [ ] **Step 2: typecheck**

Run: `cd AliangVibeCodingPhone && npx tsc -noEmit`
Expected: 0 error。

- [ ] **Step 3: 提交**

```bash
git -C AliangVibeCodingPhone add src/app/navigation/types.ts
git -C AliangVibeCodingPhone commit -m "feat(vibecoding): draftConfig 加会话级权限字段"
```

---

## Task 9: 手机端 — i18n key

**Files:**
- Modify: `AliangVibeCodingPhone/src/locales/en/vibecoding.json` 与 `src/locales/zh/vibecoding.json`(确认实际路径:`grep -rln "createScreen" src/locales`)

- [ ] **Step 1: 加 key(en + zh)**

`createScreen.permissions.*`:
- `title` / `approval.inherit` / `approval.allowAll` / `approval.askAll` / `approval.readOnly`
- `approval.inheritHint` / `approval.allowAllHint` / `approval.askAllHint` / `approval.readOnlyHint`
- `capability.read` / `capability.modify` / `capability.run`
- `portMapping.title` / `portMapping.comingSoon`

中文遵循 `mem:app-i18n-i18next-setup`,jest 锁 `zh`。

- [ ] **Step 2: 提交**

```bash
git -C AliangVibeCodingPhone add src/locales
git -C AliangVibeCodingPhone commit -m "feat(vibecoding): 权限区 i18n key(approval 三档/能力开关/端口映射)"
```

---

## Task 10: 手机端 — 创建页 UI 重写 (TDD)

**Files:**
- Modify: `AliangVibeCodingPhone/src/screens/vibecoding/CreateVibeCodingScreen.tsx`(`:40-45` permissions、`:122` state、`:636-672` 渲染区)
- Test: `AliangVibeCodingPhone/__tests__/CreateVibeCodingScreen.test.tsx`(扩或新建)

- [ ] **Step 1: 写失败测试**

```tsx
// 关键行为(用仓库现有 RTL 渲染 + platformTransport mock 习惯)
it('默认 approval=继承,能力全开', () => {});
it('选 只读 → Modify/Run 关且置灰,Read 开', () => {});
it('只读 下能力开关 disabled', () => {});
it('切回 放行 → 能力开关解锁', () => {});
it('点 Create → navigation.replace 收到 draftConfig.approvalScheme/canModify', () => {});
it('端口映射行置灰(不可点 / 显示 即将支持)', () => {});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd AliangVibeCodingPhone && npx jest __tests__/CreateVibeCodingScreen.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 重写组件**

替换 `:40-45` 的 `permissions` 数组与 `:122` 的 `selectedPermissions` state 为:
```tsx
type ApprovalChoice = 'inherit' | 'allow_all' | 'ask_all' | 'read_only';
const APPROVAL_OPTIONS: ApprovalChoice[] = ['inherit','allow_all','ask_all','read_only'];

// state
const [approval, setApproval] = useState<ApprovalChoice>('inherit');
const [canRead, setCanRead] = useState(true);
const [canModify, setCanModify] = useState(true);
const [canRun, setCanRun] = useState(true);
const isReadOnly = approval === 'read_only';
// 只读档快照:选中时 snap,切回时恢复全开
const chooseApproval = (next: ApprovalChoice) => {
  setApproval(next);
  if (next === 'read_only') { setCanRead(true); setCanModify(false); setCanRun(false); }
};
// 能力开关在只读下 disabled;手动开 Modify/Run 时若 approval=read_only,自动升档到 'inherit'
const toggleModify = () => {
  if (isReadOnly) return;
  setCanModify(v => !v);
};
// (Run/Read 同理)
```

渲染区(`:636` 起,段标题改成 `7. PERMISSIONS`):
- 审批 chip 行:4 个 `ApprovalChoice` chip,高亮当前。
- 能力 3 toggle 行:`disabled={isReadOnly}`(Read 可在只读下也锁为 on 不可关,或整体 disabled——按测试描述,三个都 disabled)。
- 端口映射置灰行:`<View style={{opacity:0.4}}>` + 灰锁图标 + `t('…portMapping.comingSoon')`,外层不包可点元素。

`handleCreate`(`:158`)的 `navigation.replace('VibeCodingSession', { draftConfig: { … } })` 加:
```tsx
  approvalScheme: approval === 'inherit' ? undefined : approval,
  canRead, canModify, canRun,
```
(继承 = 不传,服务器落 null。)

- [ ] **Step 4: 跑测试确认通过**

Run: `cd AliangVibeCodingPhone && npx jest __tests__/CreateVibeCodingScreen.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git -C AliangVibeCodingPhone add src/screens/vibecoding/CreateVibeCodingScreen.tsx __tests__/CreateVibeCodingScreen.test.tsx
git -C AliangVibeCodingPhone commit -m "feat(vibecoding): 创建页权限区做成真功能(审批三档+能力开关+端口置灰)"
```

---

## Task 11: 手机端 — 建会话分派带新字段

**Files:**
- Modify: `AliangVibeCodingPhone/src/screens/vibecoding/VibeCodingSessionScreen.tsx:1217`(建会话分派)

- [ ] **Step 1: 透传**

`:1217` 附近构造 create 请求处,带上 `draftConfig.approvalScheme`/`canRead`/`canModify`/`canRun`(键名对齐服务器 schema:`approvalScheme`→`approval_scheme` 或驼峰,看现有 `provider`/`model`/`effort` 的命名风格对齐)。

- [ ] **Step 2: typecheck + 测试**

Run: `cd AliangVibeCodingPhone && npx tsc -noEmit && npx jest`
Expected: 0 error;jest 不破(基线 3 个 terminal flake 允许)。

- [ ] **Step 3: 提交**

```bash
git -C AliangVibeCodingPhone add src/screens/vibecoding/VibeCodingSessionScreen.tsx
git -C AliangVibeCodingPhone commit -m "feat(vibecoding): 首条消息建会话透传会话级权限"
```

---

## Task 12: 可选 — remember-last 预设

**Files:**
- Modify: `AliangVibeCodingPhone/src/screens/vibecoding/CreateVibeCodingScreen.tsx`(复用 `rememberModel`/`useRecentModelOptions` 模式)

- [ ] **Step 1:** 抽一个 `useRememberedPermissions()` hook(或并入现有 model 记忆),把上次显式选的 `approval` + 能力组合持久化(AsyncStorage,参考 `rememberModel`)。
- [ ] **Step 2:** 进创建页预填;测试:选一次 → 重进恢复。
- [ ] **Step 3:** 提交。

> 若时间紧可跳过,默认值(继承/全开)已足够。跳过则在 PR 注明 "remember-last deferred"。

---

## 收尾验收(对齐 spec §7)

- [ ] 服务端 `cd AliangPhoneServer && npx tsc -p server/tsconfig.json -noEmit` = 0;`npx vitest run` 全绿。
- [ ] 手机 `cd AliangVibeCodingPhone && npx tsc -noEmit` = 0;`npx jest` 全绿(基线 flake 允许)。
- [ ] **真机 smoke(必查)**:逐项 `放行`/`逐项`/`只读` + `Modify=off` 各建一会话,验证 agent 行为符合档位;重点验 `只读`/`Modify=off` 下写文件被拦(spec §3.3 风险点)。
- [ ] 同 path 切到另一活跃会话,策略跟随最近活跃(spec §3.3 近似)。

## 不做(spec §8)

不重新引入路径限制(07-03);不接真隧道网关;不改项目/设备级 `ApprovalPolicyCard`;不给 agent 加 session_id 参;不在创建页暴露 balanced/custom。
