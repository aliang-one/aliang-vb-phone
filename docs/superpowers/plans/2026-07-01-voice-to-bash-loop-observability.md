# Voice→Bash Loop Observability + Skill Prompts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the voice→bash command-gen loop observable in real time (stream each step to the phone + persist for admin), upgrade its prompt to a skill-grade `SKILL.md` with an explicit termination policy, and rework the phone capture UX to hold-to-talk with a transcript edit/confirm step.

**Architecture:** Server-side, the orchestrator gains a per-run `runId` and emits best-effort `commandGen.*` WS events (reusing `publishToMobiles`) plus append-only `command_gen_runs`/`command_gen_steps` rows (sqlite + pg mirror, modeled on `ai_structured_events`). REST stays authoritative — WS is a real-time enhancement only. The prompt is sourced from a new `SKILL.md` file (hot-reloaded, admin-overridable). Phone-side, `VoiceToBashModal` becomes a 6-phase state machine (`idle→recording→transcribing→review→generating→confirming`) with hold-to-talk (reusing `VoiceTextInput`'s `onPressIn`/`onPressOut`) and a transient WS subscriber for the live step timeline. Go agent unchanged.

**Tech Stack:** Node/Express + vitest (server, tsconfig NodeNext, relative `.js` imports); React Native 0.85.3 + jest (phone); Vite single-file `App.tsx` (admin web). Reused infra: `publishToMobiles`, the sqlite/pg union DB, `useVoiceStt`, `sendToTerminal`.

**Spec:** `docs/superpowers/specs/2026-07-01-voice-to-bash-loop-observability-design.md`

**Repos:** Server at `AliangPhoneServer/server` (+ `AliangPhoneServer/web`); phone at `AliangVibeCodingPhone`. Commit per repo. **Go agent untouched.**

---

## File Structure

### Server (`AliangPhoneServer/server/src/`)
| File | Responsibility | Action |
|---|---|---|
| `commandGen/types.ts` (new) | `CommandGenRun`, `CommandGenStep`, `CommandGenEvent` shared types + row mappers | Create |
| `database.ts` | sqlite DDL for the two tables + CRUD methods (sync) | Modify |
| `postgresDatabase.ts` | pg DDL mirror + CRUD methods (async) | Modify |
| `commandGen/runStore.ts` (new) | best-effort persist helpers (`startRun`/`addStep`/`finishRun`) wrapping the DB union | Create |
| `commandGen/events.ts` (new) | event-payload builders + `publishCommandGenEvent` (wraps `publishToMobiles`, best-effort) | Create |
| `commandGen/orchestrator.ts` | assign `runId`, emit+persist each step, return `runId` in result | Modify |
| `commandGen/route.ts` | resolve prompt via skill loader; forward `runId` | Modify |
| `commandGen/skillLoader.ts` (new) | read `SKILL.md` (mtime cache), `resolvePromptTemplate` | Create |
| `skills/terminal-command-composer/SKILL.md` (new) | the skill content (open-standard format + Termination section) | Create |
| `modelConfig.ts` | `DEFAULT_COMMAND_GEN.promptTemplate` → `''` (empty = inherit skill file) | Modify |
| `modules/routes/admin.ts` | `GET /api/admin/command-gen/runs` + `/:runId` | Modify |

### Admin web (`AliangPhoneServer/web/src/`)
| File | Responsibility | Action |
|---|---|---|
| `App.tsx` | 「命令生成」section: runs list + step timeline (PipelineStepper style) | Modify |

### Phone (`AliangVibeCodingPhone/src/`)
| File | Responsibility | Action |
|---|---|---|
| `services/commandGenEvents.ts` (new) | transient subscriber registry fed by websocket dispatch | Create |
| `services/websocket.ts` | dispatch `commandGen.*` to the registry | Modify |
| `api/commandGen.ts` | `CommandGenResult` gains `runId` | Modify |
| `components/terminal/VoiceToBashModal.tsx` | 6-phase state machine: hold-to-talk + review + live timeline | Modify |

---

## Conventions for every task
- **Server tests:** run from `AliangPhoneServer/` as `npx vitest run <path-filter>` (vitest include is `server/test/**`); author in `AliangPhoneServer/server/test/commandGen/` (or `server/test/modules/...`). **Server tsc:** `cd AliangPhoneServer/server && npx tsc --noEmit` (authoritative — LSP/gopls desync is normal; trust tsc).
- **Phone tests:** run from `AliangVibeCodingPhone/` as `npx jest <path>`; **phone tsc:** `cd AliangVibeCodingPhone && npx tsc --noEmit`.
- NodeNext: relative imports in `src/` MUST end in `.js`.
- The DB is a `SQLiteDatabase | PostgresDatabase` union — `await` works for both (sync sqlite returns resolved). Mirror every method in both drivers.
- Best-effort rule: a failure to publish/persist MUST NOT abort command generation (try/catch, log, continue).

---

## Phase 1 — Server data model

### Task S1: `command_gen_runs` + `command_gen_steps` types, sqlite DDL, and row mapper

**Files:**
- Create: `AliangPhoneServer/server/src/commandGen/types.ts`
- Modify: `AliangPhoneServer/server/src/database.ts` (add DDL in `initializeSchema()`, near the `ai_structured_events` block ~line 349)
- Test: `AliangPhoneServer/server/test/commandGen/types.test.ts`

- [ ] **Step 1: Write the failing test** (`server/test/commandGen/types.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { rowToCommandGenRun, rowToCommandGenStep, type StoredCommandGenRun, type StoredCommandGenStep } from '../../src/commandGen/types.js';

describe('commandGen row mappers', () => {
  it('maps a command_gen_runs row (json fields decoded)', () => {
    const row = { run_id: 'cgr_1', user_id: 'u', device_id: 'd', session_id: 's', cwd: '/r', mode: 'live', status: 'converged', final_command: 'ls', dangerous: 1, llm_model: 'glm-5.2', step_count: 3, created_at: '1', converged_at: '2' };
    const r = rowToCommandGenRun(row);
    expect(r.runId).toBe('cgr_1');
    expect(r.dangerous).toBe(true);
    expect(r.status).toBe('converged');
  });
  it('maps a command_gen_steps row (toolArgs json decoded, nulls tolerated)', () => {
    const row = { run_id: 'cgr_1', seq: 1, kind: 'tool_call', tool_name: 'list_dir', tool_args: '{"path":"."}', result_snippet: 'pkg', duration_ms: 12, created_at: '1' };
    const s = rowToCommandGenStep(row);
    expect(s.toolName).toBe('list_dir');
    expect(s.toolArgs).toEqual({ path: '.' });
  });
  it('tolerates null tool_args / tool_name / snippet', () => {
    const s = rowToCommandGenStep({ run_id: 'cgr_1', seq: 0, kind: 'llm_thought', tool_name: null, tool_args: null, result_snippet: null, duration_ms: 5, created_at: '1' });
    expect(s.toolArgs).toBeUndefined();
    expect(s.toolName).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`cd AliangPhoneServer && npx vitest run server/test/commandGen/types.test.ts`). Expected: module not found.

- [ ] **Step 3: Implement** `server/src/commandGen/types.ts`:

```ts
export type CommandGenRunStatus = 'running' | 'converged' | 'failed';
export type CommandGenStepKind = 'llm_thought' | 'tool_call' | 'tool_result' | 'final';

export interface StoredCommandGenRun {
  runId: string; userId: string; deviceId: string; sessionId?: string;
  cwd: string; mode: 'initial' | 'live'; status: CommandGenRunStatus;
  finalCommand?: string; dangerous: boolean; llmModel?: string;
  stepCount: number; createdAt: string; convergedAt?: string;
}
export interface StoredCommandGenStep {
  runId: string; seq: number; kind: CommandGenStepKind;
  toolName?: string; toolArgs?: Record<string, unknown>;
  resultSnippet?: string; durationMs: number; createdAt: string;
}

const parseJsonObj = (v: unknown): Record<string, unknown> | undefined => {
  if (!v || typeof v !== 'string') return undefined;
  try { const p = JSON.parse(v); return p && typeof p === 'object' && !Array.isArray(p) ? p : undefined; } catch { return undefined; }
};

export function rowToCommandGenRun(row: any): StoredCommandGenRun {
  return {
    runId: String(row.run_id), userId: String(row.user_id), deviceId: String(row.device_id),
    sessionId: row.session_id ? String(row.session_id) : undefined,
    cwd: String(row.cwd ?? ''), mode: row.mode === 'live' ? 'live' : 'initial',
    status: (['running', 'converged', 'failed'].includes(row.status) ? row.status : 'running') as CommandGenRunStatus,
    finalCommand: row.final_command ? String(row.final_command) : undefined,
    dangerous: Boolean(row.dangerous),
    llmModel: row.llm_model ? String(row.llm_model) : undefined,
    stepCount: Number(row.step_count ?? 0),
    createdAt: String(row.created_at), convergedAt: row.converged_at ? String(row.converged_at) : undefined,
  };
}
export function rowToCommandGenStep(row: any): StoredCommandGenStep {
  return {
    runId: String(row.run_id), seq: Number(row.seq ?? 0),
    kind: ((['llm_thought', 'tool_call', 'tool_result', 'final'].includes(row.kind) ? row.kind : 'llm_thought')) as CommandGenStepKind,
    toolName: row.tool_name ? String(row.tool_name) : undefined,
    toolArgs: parseJsonObj(row.tool_args),
    resultSnippet: row.result_snippet ? String(row.result_snippet) : undefined,
    durationMs: Number(row.duration_ms ?? 0), createdAt: String(row.created_at),
  };
}
```

- [ ] **Step 4: Add sqlite DDL** in `database.ts` `initializeSchema()` (append near the `ai_structured_events` CREATE block):

```sql
CREATE TABLE IF NOT EXISTS command_gen_runs (
  run_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  cwd TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'initial',
  status TEXT NOT NULL DEFAULT 'running',
  final_command TEXT,
  dangerous INTEGER NOT NULL DEFAULT 0,
  llm_model TEXT NOT NULL DEFAULT '',
  step_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  converged_at TEXT
);
CREATE TABLE IF NOT EXISTS command_gen_steps (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  tool_name TEXT,
  tool_args TEXT,
  result_snippet TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_command_gen_runs_user ON command_gen_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_command_gen_steps_run ON command_gen_steps(run_id, seq);
```

- [ ] **Step 5: Run test — expect PASS.** Then `cd AliangPhoneServer/server && npx tsc --noEmit` → EXIT 0.

- [ ] **Step 6: Commit** `git add server/src/commandGen/types.ts server/src/database.ts server/test/commandGen/types.test.ts && git commit -m "feat(server): command_gen runs/steps 类型 + sqlite 表"`

---

### Task S2: Postgres DDL mirror

**Files:**
- Modify: `AliangPhoneServer/server/src/postgresDatabase.ts` (constructor schema array, near `ai_structured_events` ~line 317)
- Test: covered by S3 parity test (pg methods exercised via the same interface).

- [ ] **Step 1: Add the same two CREATE TABLE + two indexes** to the pg schema array in `postgresDatabase.ts` (identical SQL; pg uses `IF NOT EXISTS` already). Use `TEXT`/`INTEGER` as above (JSON columns are stored as `TEXT`, consistent with the existing pattern — NOT JSONB).

- [ ] **Step 2: `cd AliangPhoneServer/server && npx tsc --noEmit`** → EXIT 0 (no new methods yet; DDL only).

- [ ] **Step 3: Commit** `git add server/src/postgresDatabase.ts && git commit -m "feat(server): command_gen 表 postgres 镜像"`

---

## Phase 2 — Server persistence layer

### Task S3: DB CRUD methods (both drivers) + runStore best-effort wrapper

**Files:**
- Modify: `AliangPhoneServer/server/src/database.ts` (add methods to `SQLiteDatabase`)
- Modify: `AliangPhoneServer/server/src/postgresDatabase.ts` (mirror on `PostgresDatabase`)
- Create: `AliangPhoneServer/server/src/commandGen/runStore.ts`
- Test: `AliangPhoneServer/server/test/commandGen/runStore.test.ts`

- [ ] **Step 1: Write the failing test** (uses sqlite in-memory — mirror existing test setup in `server/test/` that constructs a `SQLiteDatabase`; if none, test `runStore` against a fake DB object verifying call shapes).

```ts
import { describe, it, expect, vi } from 'vitest';
import { startRun, addStep, finishRun } from '../../src/commandGen/runStore.js';

const now = () => new Date('2026-07-01T00:00:00Z').toISOString();

describe('runStore (best-effort)', () => {
  it('starts a run, adds steps, finishes; swallows DB errors', async () => {
    const db = {
      insertCommandGenRun: vi.fn(),
      insertCommandGenStep: vi.fn(),
      updateCommandGenRunStatus: vi.fn(),
    };
    await startRun(db as any, { runId: 'cgr_1', userId: 'u', deviceId: 'd', cwd: '/r', mode: 'live', model: 'glm-5.2', now });
    expect(db.insertCommandGenRun).toHaveBeenCalledWith(expect.objectContaining({ runId: 'cgr_1', status: 'running' }));
    await addStep(db as any, { runId: 'cgr_1', seq: 1, kind: 'tool_call', toolName: 'list_dir', toolArgs: { path: '.' }, durationMs: 3, now });
    expect(db.insertCommandGenStep).toHaveBeenCalledWith(expect.objectContaining({ runId: 'cgr_1', seq: 1 }));
    await finishRun(db as any, { runId: 'cgr_1', status: 'converged', finalCommand: 'ls', dangerous: false, stepCount: 1, now });
    expect(db.updateCommandGenRunStatus).toHaveBeenCalledWith(expect.objectContaining({ runId: 'cgr_1', status: 'converged' }));
  });
  it('does NOT throw when the DB throws (best-effort)', async () => {
    const db = { insertCommandGenStep: vi.fn().mockImplementation(() => { throw new Error('db down'); }) };
    await expect(addStep(db as any, { runId: 'x', seq: 1, kind: 'tool_result', durationMs: 1, now })).resolves.toBeUndefined();
  });
  it('truncates resultSnippet to the cap', async () => {
    const db = { insertCommandGenStep: vi.fn() };
    const big = 'x'.repeat(5000);
    await addStep(db as any, { runId: 'x', seq: 1, kind: 'tool_result', resultSnippet: big, durationMs: 1, now });
    expect((db.insertCommandGenStep.mock.calls[0][0] as any).resultSnippet.length).toBeLessThanOrEqual(2048);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`cd AliangPhoneServer && npx vitest run server/test/commandGen/runStore.test.ts`).

- [ ] **Step 3: Add sqlite CRUD** to `SQLiteDatabase` in `database.ts` (sync; mirror the `upsertStructuredEvent` style):

```ts
insertCommandGenRun(r: StoredCommandGenRun): void {
  this.prepare(`INSERT INTO command_gen_runs (run_id,user_id,device_id,session_id,cwd,mode,status,final_command,dangerous,llm_model,step_count,created_at,converged_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)
    ON CONFLICT(run_id) DO NOTHING`).run(r.runId, r.userId, r.deviceId, r.sessionId ?? '', r.cwd, r.mode, r.status, r.finalCommand ?? null, r.dangerous ? 1 : 0, r.llmModel ?? '', r.stepCount, r.createdAt);
}
insertCommandGenStep(s: StoredCommandGenStep): void {
  this.prepare(`INSERT INTO command_gen_steps (run_id,seq,kind,tool_name,tool_args,result_snippet,duration_ms,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(s.runId, s.seq, s.kind, s.toolName ?? null, s.toolArgs ? JSON.stringify(s.toolArgs) : null, s.resultSnippet ?? null, s.durationMs, s.createdAt);
}
updateCommandGenRunStatus(runId: string, status: string, finalCommand: string | null, dangerous: boolean, stepCount: number, convergedAt: string): void {
  this.prepare(`UPDATE command_gen_runs SET status=?, final_command=?, dangerous=?, step_count=?, converged_at=? WHERE run_id=?`)
    .run(status, finalCommand, dangerous ? 1 : 0, stepCount, convergedAt, runId);
}
listCommandGenRunsByUser(userId: string, limit = 50): StoredCommandGenRun[] {
  return this.prepare('SELECT * FROM command_gen_runs WHERE user_id=? ORDER BY created_at DESC LIMIT ?').all(userId, limit).map(rowToCommandGenRun);
}
getCommandGenRunWithSteps(runId: string): { run: StoredCommandGenRun; steps: StoredCommandGenStep[] } | undefined {
  const runRow = this.prepare('SELECT * FROM command_gen_runs WHERE run_id=?').get(runId);
  if (!runRow) return undefined;
  const steps = this.prepare('SELECT * FROM command_gen_steps WHERE run_id=? ORDER BY seq ASC').all(runId).map(rowToCommandGenStep);
  return { run: rowToCommandGenRun(runRow), steps };
}
pruneCommandGenRuns(userId: string, keepN = 50): void {
  const ids = this.prepare('SELECT run_id FROM command_gen_runs WHERE user_id=? ORDER BY created_at DESC LIMIT -1 OFFSET ?').all(userId, keepN).map((r: any) => r.run_id);
  if (!ids.length) return;
  const del = this.prepare('DELETE FROM command_gen_steps WHERE run_id=?');
  const delRun = this.prepare('DELETE FROM command_gen_runs WHERE run_id=?');
  for (const id of ids) { del.run(id); delRun.run(id); }
}
```
Import `StoredCommandGenRun/Step, rowToCommandGenRun/rowToCommandGenStep` from `./commandGen/types.js` at the top of `database.ts` (follow the existing import style; use the relative path that matches the file's location).

- [ ] **Step 4: Mirror on PostgresDatabase** in `postgresDatabase.ts` — same methods, `async`, using the class's `this.exec` / `this.all(rowMapper, sql, params)` / `this.one(rowMapper, sql, params)` helpers (mirror `upsertStructuredEvent`/`getStructuredEventsBySession`). SQL uses `?` placeholders (the pg driver rewrites them — match existing methods). `pruneCommandGenRuns` uses the same `LIMIT -1 OFFSET ?` form if the existing code does; otherwise fetch ids then delete in a loop (match whatever `deleteAiSession`-style code uses).

- [ ] **Step 5: Implement** `server/src/commandGen/runStore.ts`:

```ts
import type { SQLiteDatabase } from '../database.js';
import type { PostgresDatabase } from '../postgresDatabase.js';
import type { CommandGenRunStatus, CommandGenStepKind, StoredCommandGenRun, StoredCommandGenStep } from './types.js';

export type CommandGenDb = SQLiteDatabase | PostgresDatabase | undefined;
const SNIPPET_CAP = 2048;
const truncate = (s?: string) => (s && s.length > SNIPPET_CAP ? s.slice(0, SNIPPET_CAP) : s);

export async function startRun(db: CommandGenDb, input: { runId: string; userId: string; deviceId: string; sessionId?: string; cwd: string; mode: 'initial' | 'live'; model?: string; now: () => string }): Promise<void> {
  if (!db) return;
  const run: StoredCommandGenRun = { runId: input.runId, userId: input.userId, deviceId: input.deviceId, sessionId: input.sessionId, cwd: input.cwd, mode: input.mode, status: 'running', dangerous: false, llmModel: input.model, stepCount: 0, createdAt: input.now() };
  try { await db.insertCommandGenRun(run); } catch (e) { /* best-effort */ }
}
export async function addStep(db: CommandGenDb, input: { runId: string; seq: number; kind: CommandGenStepKind; toolName?: string; toolArgs?: Record<string, unknown>; resultSnippet?: string; durationMs: number; now: () => string }): Promise<void> {
  if (!db) return;
  const step: StoredCommandGenStep = { runId: input.runId, seq: input.seq, kind: input.kind, toolName: input.toolName, toolArgs: input.toolArgs, resultSnippet: truncate(input.resultSnippet), durationMs: input.durationMs, createdAt: input.now() };
  try { await db.insertCommandGenStep(step); } catch (e) { /* best-effort */ }
}
export async function finishRun(db: CommandGenDb, input: { runId: string; status: CommandGenRunStatus; finalCommand?: string; dangerous: boolean; stepCount: number; now: () => string }): Promise<void> {
  if (!db) return;
  try { await db.updateCommandGenRunStatus(input.runId, input.status, input.finalCommand ?? null, input.dangerous, input.stepCount, input.now()); } catch (e) { /* best-effort */ }
}
export async function pruneCommandGenRuns(db: CommandGenDb, userId: string, keepN = 50): Promise<void> {
  if (!db) return;
  try { await db.pruneCommandGenRuns(userId, keepN); } catch (e) { /* best-effort */ }
}
```

- [ ] **Step 6: Run test — expect PASS.** `cd AliangPhoneServer/server && npx tsc --noEmit` → EXIT 0. (If tsc reports the union DB type mismatch on `db.insertCommandGenRun`, ensure both drivers expose identical method signatures; the union call is valid only if both implement it.)

- [ ] **Step 7: Commit** `git add server/src/database.ts server/src/postgresDatabase.ts server/src/commandGen/runStore.ts server/test/commandGen/runStore.test.ts && git commit -m "feat(server): command_gen runs/steps 持久化(sqlite+pg) + best-effort runStore"`

---

## Phase 3 — Server WS event contract

### Task S4: `commandGen.*` event builders + best-effort publisher

**Files:**
- Create: `AliangPhoneServer/server/src/commandGen/events.ts`
- Test: `AliangPhoneServer/server/test/commandGen/events.test.ts`

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../src/shared/realtime/publish.js', () => ({ publishToMobiles: vi.fn().mockResolvedValue(undefined), __esModule: true }));
import { publishToMobiles } from '../../src/shared/realtime/publish.js';
import { publishCommandGenEvent } from '../../src/commandGen/events.js';

describe('publishCommandGenEvent', () => {
  it('publishes a commandGen.step addressed to (userId, deviceId), best-effort', async () => {
    await publishCommandGenEvent({ userId: 'u', deviceId: 'd' }, { type: 'commandGen.step', runId: 'cgr_1', seq: 1, kind: 'tool_call', toolName: 'list_dir', durationMs: 3, ts: 't' });
    expect(publishToMobiles).toHaveBeenCalledWith('u', expect.objectContaining({ type: 'commandGen.step', runId: 'cgr_1' }), expect.objectContaining({ deviceId: 'd' }));
  });
  it('swallows publish failures (best-effort)', async () => {
    (publishToMobiles as any).mockRejectedValueOnce(new Error('ws down'));
    await expect(publishCommandGenEvent({ userId: 'u', deviceId: 'd' }, { type: 'commandGen.runStarted', runId: 'cgr_1', ts: 't' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `server/src/commandGen/events.ts`:

```ts
import { publishToMobiles } from '../shared/realtime/publish.js';
import type { CommandGenRunStatus, CommandGenStepKind } from './types.js';

export type CommandGenEvent =
  | { type: 'commandGen.runStarted'; runId: string; text: string; cwd: string; mode: 'initial' | 'live'; model?: string; ts: string }
  | { type: 'commandGen.step'; runId: string; seq: number; kind: CommandGenStepKind; toolName?: string; toolArgs?: Record<string, unknown>; snippet?: string; durationMs: number; ts: string }
  | { type: 'commandGen.runFinished'; runId: string; status: CommandGenRunStatus; finalCommand?: string; dangerous: boolean; ts: string }
  | { type: 'commandGen.failed'; runId: string; reason: string; ts: string };

export async function publishCommandGenEvent(target: { userId: string; deviceId: string }, event: CommandGenEvent): Promise<void> {
  try { await publishToMobiles(target.userId, event, { deviceId: target.deviceId }); } catch { /* best-effort */ }
}
```

- [ ] **Step 4: Run test — expect PASS.** tsc EXIT 0.

- [ ] **Step 5: Commit** `git add server/src/commandGen/events.ts server/test/commandGen/events.test.ts && git commit -m "feat(server): commandGen.* WS 事件契约 + best-effort 发布"`

---

## Phase 4 — Server orchestrator integration

### Task S5: orchestrator emits events + persists steps, returns `runId`

**Files:**
- Modify: `AliangPhoneServer/server/src/commandGen/orchestrator.ts`
- Test: `AliangPhoneServer/server/test/commandGen/orchestrator.test.ts` (extend)

- [ ] **Step 1: Add failing tests** to `orchestrator.test.ts`:

```ts
// New imports at top:
import { publishToMobiles } from '../../src/shared/realtime/publish.js';
// add vi.mock for '../../src/shared/realtime/publish.js' (publishToMobiles: vi.fn()) and for runStore? NO — do NOT mock runStore; instead assert via the mocked DB.
// NOTE: runId and now() are intentionally non-deterministic inside generateCommand — do NOT mock or fix them. Assert runId with a regex (expect.stringMatching(/^cgr_/)), not an exact value.
```

Add a helper to grab the new deps. Strategy: the orchestrator will import `runStore` + `events` + generate `runId` + `now`. Mock the DB via the existing `getDatabase` mock pattern; assert `publishToMobiles` was called with `commandGen.runStarted`/`step`/`runFinished`, that the result includes `runId`, and that a thrown DB does not abort.

```ts
it('assigns a runId, publishes runStarted + steps + runFinished, returns runId', async () => {
  (callLlm as any)
    .mockResolvedValueOnce({ kind: 'tool_calls', calls: [{ id: 'c1', name: 'env_info', args: {} }] })
    .mockResolvedValueOnce({ kind: 'final', text: 'git status --short' });
  (requestAgentPayload as any).mockResolvedValue({ os: 'darwin' });
  const r = await generateCommand(baseInput());
  expect(r.runId).toEqual(expect.stringMatching(/^cgr_/));
  const types = (publishToMobiles as any).mock.calls.map((c: any[]) => c[1].type);
  expect(types).toContain('commandGen.runStarted');
  expect(types).toContain('commandGen.step');
  expect(types).toContain('commandGen.runFinished');
});

it('best-effort: a publish failure does not abort generation', async () => {
  (publishToMobiles as any).mockRejectedValue(new Error('ws down'));
  (callLlm as any).mockResolvedValueOnce({ kind: 'final', text: 'pwd' });
  const r = await generateCommand(baseInput());
  expect(r.command).toBe('pwd');
});

it('marks the run failed and publishes commandGen.failed on LLM throw', async () => {
  (callLlm as any).mockRejectedValue(new Error('llm_http_500: boom'));
  const r = await generateCommand(baseInput()).catch((e) => { throw e; });
  // generation rethrows on LLM error (existing behavior preserved); the failed publish happens before throw
  const types = (publishToMobiles as any).mock.calls.map((c: any[]) => c[1].type);
  expect(types).toContain('commandGen.failed');
});
```

- [ ] **Step 2: Run — expect FAIL** (`runId` not present; events not published).

- [ ] **Step 3: Implement** in `orchestrator.ts`. Update `GenResult` and rework `generateCommand`:

```ts
export type GenResult = { command: string; dangerous: boolean; runId: string };
```

Inside `generateCommand`, before the loop: generate `const runId = 'cgr_' + randomId();` (add a tiny id helper or reuse an existing nanoid if present; else `Math.random().toString(36).slice(2)` is acceptable here — it is not a security token). Thread `now = () => new Date().toISOString()`.

Wrap the whole body so that:
- On start: `await publishCommandGenEvent({userId, deviceId}, { type:'commandGen.runStarted', runId, text: input.request, cwd, mode, model, ts: now() })` and `await startRun(getDatabase(), { runId, userId, deviceId, sessionId, cwd, mode, model, now })`.
- Maintain `let seq = 0;` Each LLM response: if it has assistant text content → emit a `commandGen.step{kind:'llm_thought', seq: seq++}`. For each tool call: emit `commandGen.step{kind:'tool_call', seq: seq++, toolName, toolArgs}` BEFORE running; after `runTool` returns, emit `commandGen.step{kind:'tool_result', seq: seq++, toolName, snippet: out.slice(0,512), durationMs}`. Mirror each emitted step with `addStep(getDatabase(), {...})`.
- On converge (`kind:'final'`): emit `commandGen.step{kind:'final', seq: seq++, snippet: text}`; `await finishRun(getDatabase(), {runId, status:'converged', finalCommand: text, dangerous, stepCount: seq, now})`; `await publishCommandGenEvent(..., {type:'commandGen.runFinished', runId, status:'converged', finalCommand: text, dangerous, ts: now()})`; `await pruneCommandGenRuns(getDatabase(), userId)`; return `{ command: text, dangerous, runId }`.
- On the no-converge fallback path: same `runFinished` with the fallback command.
- On any thrown error (LLM/network): `await publishCommandGenEvent(..., {type:'commandGen.failed', runId, reason: err.message, ts: now()})` and `await finishRun(getDatabase(), {runId, status:'failed', stepCount: seq, now})` (best-effort, in a `finally` or catch), then rethrow.

Add imports: `import { publishCommandGenEvent } from './events.js'; import { startRun, addStep, finishRun, pruneCommandGenRuns } from './runStore.js'; import { getDatabase } from '../store.js';` (getDatabase already imported; `pruneCommandGenRuns` was exported from `runStore.ts` in S3).

- [ ] **Step 4: Run tests — expect PASS** (existing + new). `cd AliangPhoneServer/server && npx tsc --noEmit` → EXIT 0.

- [ ] **Step 5: Commit** `git add server/src/commandGen/orchestrator.ts server/src/commandGen/runStore.ts server/test/commandGen/orchestrator.test.ts && git commit -m "feat(server): orchestrator 每步发事件+持久化,返回 runId"`

---

## Phase 5 — Server route + skill loader

### Task S6: route resolves prompt from skill loader; response carries `runId`

**Files:**
- Modify: `AliangPhoneServer/server/src/commandGen/route.ts`
- Create: `AliangPhoneServer/server/src/commandGen/skillLoader.ts`
- Create: `AliangPhoneServer/server/skills/terminal-command-composer/SKILL.md`
- Modify: `AliangPhoneServer/server/src/modelConfig.ts` (`DEFAULT_COMMAND_GEN.promptTemplate = ''`)
- Test: `AliangPhoneServer/server/test/commandGen/skillLoader.test.ts`, extend `server/test/commandGen/route.test.ts`

- [ ] **Step 1: Write the failing skillLoader test:**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolvePromptTemplate, __resetSkillCache } from '../../src/commandGen/skillLoader.js';

describe('resolvePromptTemplate', () => {
  beforeEach(() => __resetSkillCache());
  it('uses admin override when non-empty', () => {
    expect(resolvePromptTemplate({ promptTemplate: 'CUSTOM' })).toBe('CUSTOM');
  });
  it('falls back to skill file body when promptTemplate empty (whitespace trimmed)', () => {
    const resolved = resolvePromptTemplate({ promptTemplate: '   ' });
    expect(resolved.length).toBeGreaterThan(50);
    expect(resolved).toContain('Termination'); // the new section exists
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create the SKILL.md** at `server/skills/terminal-command-composer/SKILL.md`. Use the open Agent Skills format (YAML frontmatter + structured body). Content (this is the authoritative skill text — keep placeholders to the four known ones):

```markdown
---
name: terminal-command-composer
description: Turn a spoken request into exactly ONE safe bash command for an interactive terminal, inspecting the environment first with read-only tools.
triggers:
  - user asks to run/inspect/search/diagnose something in a terminal
  - voice→bash command generation
---

# Vibe Terminal Command Composer

You are the server-side planner for a phone-controlled remote terminal. Turn a spoken
request into exactly ONE safe, useful bash command for an interactive shell.

## Runtime context
- User request: {request}
- Operating system: {os}
- Working directory: {cwd}
- Mode: {mode} (initial = a fresh shell; live = an existing terminal where recent history may matter)

## Available read-only tools
env_info, git_status, list_dir, read_file, recent_commands (live mode only).

## Decision policy
- For info/status/inspection/diagnostics/search/small safe ops: produce a command that answers it.
- For a broad task that cannot be one safe command: produce an `echo` stating the next safe step.
- When the request implies choosing among files/packages/branches/scripts: inspect first.
- In live mode, call recent_commands when pronouns/context appear ("again", "that", "the last one").
- Prefer existing project scripts over guessing raw commands.
- Do not invent paths, package names, ports, branch names, or filenames that can be inspected.

## Termination (IMPORTANT — you decide when to exit)
- The instant you have enough information, STOP calling tools and return the final single bash
  command with NO tool call. That final message is the loop-exit signal.
- Budget: at most ~6 tool calls (the operator-configured cap); usually 0–2 suffice. Do NOT loop for the sake of it.
- If the request is unsafe or unclear, exit immediately with a single `echo` command — do not keep calling tools.

## Good command patterns
- Orientation: pwd, ls -la, git status --short, git branch --show-current.
- Project scripts (after inspection): npm test, npm run lint, pnpm test, go test ./..., pytest, cargo test.
- Search/inspection: rg, find, sed -n, cat (non-sensitive small files), git diff --stat.

## Safety rules
- Never output destructive, privileged, irreversible, or network-exfiltrating commands.
- No rm -rf, sudo, mkfs, disk erase, shutdown/reboot, killall broad targets, credential/secret reads, or upload pipes.
- Never read/print secrets: .env*, private keys, tokens, .npmrc, .netrc, cloud/db/git credentials.
- No package installs, global config changes, git-history rewrites, deletes, force push, or permission changes.
- If the spoken request is unsafe: output a single `echo` explaining the safer alternative.
- Quote paths safely. Use `&&` only when each step is necessary and safe.

## Output contract
- Return ONLY the raw bash command. Single line. No fences, labels, bullets, comments, or explanations.
- If you must answer in prose, wrap it in `echo "..."`.
```

- [ ] **Step 4: Implement** `server/src/commandGen/skillLoader.ts`:

```ts
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// NOTE: the server is ESM ("type": "module" + NodeNext). `__dirname` is a CJS
// global and is UNDEFINED under ESM — it throws at runtime, and tsc will NOT
// catch it (@types/node still declares it). Use the repo's own pattern
// (index.ts:104, database.ts:5): path.dirname(fileURLToPath(import.meta.url)).
const SKILL_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'terminal-command-composer', 'SKILL.md');
const EMBEDDED_DEFAULT = 'You convert a spoken request into ONE safe bash command. Inspect with read-only tools first. When ready, return ONLY the raw single-line bash command with no tool call — that ends the loop. Avoid destructive/privileged/secret commands. Context — os: {os}, cwd: {cwd}, mode: {mode}.'; // ultimate fallback if file missing

let cachedBody: string | null = null;
let cachedMtimeMs: number | null = null;

function stripFrontmatter(src: string): string {
  if (!src.startsWith('---')) return src;
  const end = src.indexOf('\n---', 3);
  return end < 0 ? src : src.slice(end + 4).replace(/^\s*\n/, '');
}

function readSkillBody(): string | null {
  try {
  const st = statSync(SKILL_FILE);
  const mtime = st.mtimeMs;
  if (cachedBody !== null && cachedMtimeMs === mtime) return cachedBody;
  const body = stripFrontmatter(readFileSync(SKILL_FILE, 'utf8')).trim();
  if (!body) return null;
  cachedBody = body; cachedMtimeMs = mtime;
  return body;
  } catch { return null; }
}

export function loadSkillPrompt(): string {
  return readSkillBody() ?? EMBEDDED_DEFAULT;
}

export function resolvePromptTemplate(settings: { promptTemplate?: string }): string {
  const override = (settings.promptTemplate ?? '').trim();
  return override ? settings.promptTemplate! : loadSkillPrompt();
}

export function __resetSkillCache(): void { cachedBody = null; cachedMtimeMs = null; } // test-only
```

- [ ] **Step 5: Run skillLoader test — expect PASS.**

- [ ] **Step 6: Wire route + modelConfig.** In `route.ts`, import `resolvePromptTemplate` and change the `generateCommand({...})` call to pass `promptTemplate: resolvePromptTemplate(cfg)` (instead of `cfg.promptTemplate`). In `modelConfig.ts`, set `DEFAULT_COMMAND_GEN.promptTemplate: ''` (empty = inherit skill file); update `normalizeCommandGenSettings` so an empty/whitespace `promptTemplate` stays empty (do NOT substitute the legacy hardcoded default — instead leave `''` so `resolvePromptTemplate` supplies the skill). Keep the legacy-string reset only to convert old stored values to `''`:

```ts
// inside normalizeCommandGenSettings, replace the promptTemplate block with:
const rawPrompt = typeof merged.promptTemplate === 'string' ? merged.promptTemplate : '';
const promptTemplate =
  rawPrompt === LEGACY_COMMAND_GEN_PROMPT_TEMPLATE || rawPrompt === PREVIOUS_COMMAND_GEN_PROMPT_TEMPLATE
    ? ''   // migrate old hardcoded prompts → inherit skill file
    : rawPrompt;
```
and in the returned object set `promptTemplate` (now possibly `''`).

- [ ] **Step 7: Extend `route.test.ts`** — assert the response body includes `runId` (`expect(result.runId).toEqual(expect.stringMatching(/^cgr_/))`) and that an empty `promptTemplate` in settings still yields a command (skill default applied). (The route test mocks `generateCommand`, so also add a route-level test that `resolvePromptTemplate` is invoked — or assert via a spy.)

- [ ] **Step 8: Run all commandGen tests + tsc.** `cd AliangPhoneServer && npx vitest run commandGen` → all green. `cd AliangPhoneServer/server && npx tsc --noEmit` → EXIT 0.

- [ ] **Step 9: Commit** `git add server/src/commandGen/route.ts server/src/commandGen/skillLoader.ts server/skills/terminal-command-composer/SKILL.md server/src/modelConfig.ts server/test/commandGen/skillLoader.test.ts server/test/commandGen/route.test.ts && git commit -m "feat(server): SKILL.md 提示词(含 Termination)+ 空模板继承 skill + 路由回传 runId"`

---

## Phase 6 — Server admin endpoints

### Task S7: `GET /api/admin/command-gen/runs` + `/:runId`

**Files:**
- Modify: `AliangPhoneServer/server/src/modules/routes/admin.ts`
- Test: `AliangPhoneServer/server/test/commandGen/admin-runs.test.ts` (or extend an admin test)

- [ ] **Step 1: Write the failing test** (mock `getDatabase()` to return list/get objects; mock admin auth per existing admin-route tests):

```ts
it('GET /api/admin/command-gen/runs returns the user run list', async () => {
  // seed getDatabase().listCommandGenRunsByUser → [{runId:'cgr_1',...}]
  const res = await app.inject({ method: 'GET', url: '/api/admin/command-gen/runs?userId=u' });
  expect(res.statusCode).toBe(200);
  expect(res.json().runs).toEqual(expect.arrayContaining([expect.objectContaining({ runId: 'cgr_1' })]));
});
it('GET /api/admin/command-gen/runs/:runId returns run + steps', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/command-gen/runs/cgr_1' });
  expect(res.json()).toEqual(expect.objectContaining({ run: expect.objectContaining({ runId: 'cgr_1' }), steps: expect.any(Array) }));
});
```
(Use the exact admin-route test harness already used in `server/test/` — match its auth/app-injection style.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** in `admin.ts` (follow the existing admin handler style — `requireAdmin`/auth guard used by sibling routes; `getDatabase()` for reads):

```ts
router.get('/api/admin/command-gen/runs', (req, res, next) => {
  try {
    const userId = String(req.query.userId ?? '');
    const runs = userId ? (getDatabase()?.listCommandGenRunsByUser(userId) ?? []) : [];
    res.json({ runs });
  } catch (e) { next(e); }
});
router.get('/api/admin/command-gen/runs/:runId', (req, res, next) => {
  try {
    const got = getDatabase()?.getCommandGenRunWithSteps(String(req.params.runId));
    if (!got) throw new ApiError(404, 'run_not_found');
    res.json(got);
  } catch (e) { next(e); }
});
```
(If list/get are async on pg, `await` them — make the handlers `async`. Mirror the existing admin handler async style.)

- [ ] **Step 4: Run test — expect PASS.** tsc EXIT 0.

- [ ] **Step 5: Commit** `git add server/src/modules/routes/admin.ts server/test/commandGen/admin-runs.test.ts && git commit -m "feat(server): admin 命令生成 runs/steps 查看端点"`

---

## Phase 7 — Admin web viewer

### Task S8: 「命令生成」 section in App.tsx

**Files:**
- Modify: `AliangPhoneServer/web/src/App.tsx`

- [ ] **Step 1: Add UI** — in the VibeCoding tab (or a new sub-section), add a 「命令生成」 panel: a fetch of `/api/admin/command-gen/runs?userId=:u` → list rows (user/device/status/command/stepCount/time); clicking a row fetches `/api/admin/command-gen/runs/:runId` → renders the step timeline reusing the `PipelineStepper` styling. Follow the existing data-fetch + tab-panel patterns in `App.tsx`. Keep it read-only.

- [ ] **Step 2: Build + smoke.** `cd AliangPhoneServer && npx vite build` → EXIT 0. Manual smoke: open admin, select a user with a prior command-gen run, confirm the list + step timeline render.

- [ ] **Step 3: Commit** `git add web/src/App.tsx && git commit -m "feat(web): admin 命令生成 runs/steps 查看器"`

---

## Phase 8 — Phone WS subscription + api

### Task P1: commandGen event subscriber registry + websocket dispatch

**Files:**
- Create: `AliangVibeCodingPhone/src/services/commandGenEvents.ts`
- Modify: `AliangVibeCodingPhone/src/services/websocket.ts`
- Test: `AliangVibeCodingPhone/__tests__/services/commandGenEvents.test.ts`

- [ ] **Step 1: Write the failing test:**

```ts
import { subscribeCommandGenEvents, dispatchCommandGenEvent } from '../../src/services/commandGenEvents';

describe('commandGenEvents registry', () => {
  it('delivers commandGen.* events to subscribers and filters non-commandGen types', () => {
    const seen: any[] = [];
    const unsub = subscribeCommandGenEvents((e) => seen.push(e));
    dispatchCommandGenEvent({ type: 'commandGen.step', runId: 'cgr_1', seq: 1, kind: 'tool_call', durationMs: 3, ts: 't' });
    dispatchCommandGenEvent({ type: 'ai.delta' } as any); // ignored at dispatch site (websocket filters), but registry only gets commandGen.*
    expect(seen).toHaveLength(1);
    expect(seen[0].runId).toBe('cgr_1');
    unsub();
    dispatchCommandGenEvent({ type: 'commandGen.step', runId: 'cgr_1', seq: 2, kind: 'tool_result', durationMs: 1, ts: 't' } as any);
    expect(seen).toHaveLength(1); // unsubscribed
  });
  it('a throwing listener does not break others', () => {
    subscribeCommandGenEvents(() => { throw new Error('boom'); });
    let got = false;
    subscribeCommandGenEvents(() => { got = true; });
    dispatchCommandGenEvent({ type: 'commandGen.runStarted', runId: 'x', ts: 't' } as any);
    expect(got).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`cd AliangVibeCodingPhone && npx jest commandGenEvents`).

- [ ] **Step 3: Implement** `src/services/commandGenEvents.ts`:

```ts
export type CommandGenLiveEvent =
  | { type: 'commandGen.runStarted'; runId: string; text?: string; cwd?: string; mode?: string; model?: string; ts?: string }
  | { type: 'commandGen.step'; runId: string; seq: number; kind: string; toolName?: string; toolArgs?: Record<string, unknown>; snippet?: string; durationMs?: number; ts?: string }
  | { type: 'commandGen.runFinished'; runId: string; status: string; finalCommand?: string; dangerous?: boolean; ts?: string }
  | { type: 'commandGen.failed'; runId: string; reason?: string; ts?: string };

type Listener = (e: CommandGenLiveEvent) => void;
const listeners = new Set<Listener>();

export function subscribeCommandGenEvents(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
export function dispatchCommandGenEvent(e: CommandGenLiveEvent): void {
  for (const l of listeners) {
    try { l(e); } catch { /* a bad listener must not break others */ }
  }
}
```

- [ ] **Step 4: Wire websocket.ts.** In the `onmessage` handler (around line 125 where `parsed` is available), before/alongside the existing `this.handler(parsed)` dispatch, add:

```ts
if (parsed && typeof parsed.type === 'string' && parsed.type.startsWith('commandGen.')) {
  dispatchCommandGenEvent(parsed as CommandGenLiveEvent);
}
```
(import `dispatchCommandGenEvent` + type from `./commandGenEvents`.)

- [ ] **Step 5: Run test — expect PASS.** `cd AliangVibeCodingPhone && npx tsc --noEmit` → EXIT 0.

- [ ] **Step 6: Commit** `git add src/services/commandGenEvents.ts src/services/websocket.ts __tests__/services/commandGenEvents.test.ts && git commit -m "feat(phone): commandGen.* WS 事件订阅注册表"`

---

### Task P2: api/commandGen.ts carries `runId`

**Files:**
- Modify: `AliangVibeCodingPhone/src/api/commandGen.ts`
- Test: `AliangVibeCodingPhone/__tests__/api/commandGen.test.ts` (extend)

- [ ] **Step 1: Add failing assertion** to the existing `commandGen.test.ts`: the resolved result includes `runId` (string). Update the mock resolved values to include `runId: 'cgr_1'`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — add `runId: string` to `CommandGenResult` in `api/commandGen.ts` (and the mock). No request-shape change.

- [ ] **Step 4: Run test — expect PASS.** phone tsc EXIT 0.

- [ ] **Step 5: Commit** `git add src/api/commandGen.ts __tests__/api/commandGen.test.ts && git commit -m "feat(phone): commandGen 结果带 runId"`

---

## Phase 9 — Phone modal rework

### Task P3: `idle` + hold-to-talk recording (replace auto-record)

**Files:**
- Modify: `AliangVibeCodingPhone/src/components/terminal/VoiceToBashModal.tsx`
- Test: `AliangVibeCodingPhone/__tests__/components/VoiceToBashModal.test.tsx` (new or extend)

- [ ] **Step 1: Write the failing test** — modal opens at `idle` (shows "按住说话", no recording until press); pressing the mic pad (`onPressIn`) starts recording; releasing (`onPressOut`) stops. Use the existing VoiceToBashModal test harness if present; mock `useVoiceStt`.

```tsx
it('opens at idle and starts recording only on press-in', () => {
  const { getByTestId, queryByText } = render(<VoiceToBashModal {...baseProps} />);
  expect(getByTestId('v2b-mic-pad')).toBeTruthy();
  expect(queryByText('识别中')).toBeNull();
  // onPressIn → recording; onPressOut → stop
  fireEvent(getByTestId('v2b-mic-pad'), 'onPressIn');
  fireEvent(getByTestId('v2b-mic-pad'), 'onPressOut');
  // useVoiceStt.start + stop called (assert via mock)
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Change the phase type to `'idle' | 'recording' | 'transcribing' | 'review' | 'generating' | 'confirming' | 'error'`; default `'idle'`. **Remove the auto-start effect** (the one that calls `startRecording` when `visible && phase==='recording'`). Add a mic-pad `Pressable` (`testID="v2b-mic-pad"`) with `onPressIn={startRecording}` / `onPressOut={stopRecording}` (copy the `onPressIn`/`onPressOut` wiring from `VoiceTextInput.tsx:223-224`). Render the `idle` body ("按住说话，松手结束" + the pad). Keep `recording`/`transcribing` bodies. The `confirming` body stays (used later). `startRecording`/`stopRecording` already exist — reuse them (they call `voiceStt.start`/`stop`).

- [ ] **Step 4: Run test — expect PASS.** phone tsc EXIT 0.

- [ ] **Step 5: Commit** `git add src/components/terminal/VoiceToBashModal.tsx __tests__/components/VoiceToBashModal.test.tsx && git commit -m "feat(phone): VoiceToBash 改 hold-to-talk(idle 起手)"`

---

### Task P4: `review` phase — editable transcript + 确认/重录

**Files:**
- Modify: `AliangVibeCodingPhone/src/components/terminal/VoiceToBashModal.tsx`
- Test: extend `VoiceToBashModal.test.tsx`

- [ ] **Step 1: Write the failing test:** after `onComplete` fires with `"show git status"`, the modal is at `review` with the text pre-filled in an editable `TextInput` (`testID="v2b-transcript"`); editing changes it; 「确认发送」 calls `onConfirm`-equivalent that triggers `generateCommand` with the (possibly edited) text; 「重录」 returns to `idle`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Add a `transcript` state. In `onComplete`, set `transcript` and `setPhase('review')`. Render the `review` body: a `TextInput` (`testID="v2b-transcript"`, `value=transcript`, `onChangeText=setTranscript`, `multiline`, `autoFocus`) + footer 「重录」(`onPress=resetToIdle`) and 「确认发送」(`onPress=handleSend`). `handleSend` calls the same `generateCommand` send path the modal already uses (now feeding `transcript` as the `text`), transitions to `generating`. Do NOT call the AI from `review` until 确认 is pressed.

- [ ] **Step 4: Run test — expect PASS.** phone tsc EXIT 0.

- [ ] **Step 5: Commit** `git add src/components/terminal/VoiceToBashModal.tsx __tests__/components/VoiceToBashModal.test.tsx && git commit -m "feat(phone): VoiceToBash review 阶段(转写可编辑+确认/重录)"`

---

### Task P5: `generating` phase — live step timeline from WS subscription + wire `confirming`

**Files:**
- Modify: `AliangVibeCodingPhone/src/components/terminal/VoiceToBashModal.tsx`
- Test: extend `VoiceToBashModal.test.tsx`

- [ ] **Step 1: Write the failing test:** in `generating`, dispatching `commandGen.runStarted{runId:'cgr_1'}` then `commandGen.step{runId:'cgr_1',seq:1,kind:'tool_call',toolName:'list_dir'}` via `dispatchCommandGenEvent` renders a timeline row ("list_dir"); when `generateCommand` resolves with `{command:'ls',dangerous:false,runId:'cgr_1'}`, the modal moves to `confirming` with the command pre-filled (`testID="v2b-command"`).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** In `handleSend` (after firing `generateCommand`), `setPhase('generating')` and set up a subscription:

```tsx
useEffect(() => {
  if (phase !== 'generating') return;
  const unsub = subscribeCommandGenEvents((e) => {
    if (e.runId && (activeRunIdRef.current === null)) activeRunIdRef.current = e.runId; // capture from runStarted
    if (activeRunIdRef.current && e.runId !== activeRunIdRef.current) return;
    setSteps((prev) => [...prev, e]);
  });
  return unsub;
}, [phase]);
```

Render `generating` body: the step timeline (names by default; `kind==='final'` → "生成中…"; `tool_call` → toolName; `tool_result` → "✓ toolName"). When `generateCommand` resolves, store the result (command + runId) and `setPhase('confirming')`. The existing `confirming` body (editable command `testID="v2b-command"`, danger warning, run/rerecord/cancel) is reused unchanged — just ensure `command` state is seeded from the result and `onConfirm`/run navigates to `DeviceTerminal` with `initialCommand` (existing path).

- [ ] **Step 4: Run test — expect PASS.** phone tsc EXIT 0. Run full phone suite to confirm the ~3 terminal-flake baseline is unchanged: `cd AliangVibeCodingPhone && npx jest 2>&1 | tail -5`.

- [ ] **Step 5: Commit** `git add src/components/terminal/VoiceToBashModal.tsx __tests__/components/VoiceToBashModal.test.tsx && git commit -m "feat(phone): VoiceToBash generating 阶段实时步骤时间线 + 衔接 confirming"`

---

## Final verification

- [ ] **Server:** `cd AliangPhoneServer && npx vitest run` (all green, was 364) + `cd AliangPhoneServer/server && npx tsc --noEmit` (EXIT 0) + `cd AliangPhoneServer && npx vite build` (EXIT 0).
- [ ] **Phone:** `cd AliangVibeCodingPhone && npx tsc --noEmit` (EXIT 0) + `npx jest` (green modulo the known ~3 terminal flakes).
- [ ] **End-to-end smoke (real device, after rebuild/redeploy):** long-press NEW TERM → modal at idle → hold mic pad → speak → release → review (edit if needed) → 确认 → watch live step timeline → confirm command → terminal runs it. Admin 「命令生成」 shows the run + steps.

## Notes for the implementer
- **`now()`**: orchestrator must not call `new Date()` in a way that breaks resume/serialization — passing `() => new Date().toISOString()` inline is fine (this is a live request, not a workflow artifact).
- **runId format**: `cgr_` prefix + random. `Math.random()` is acceptable (not a security token); if an existing nanoid util exists in the repo, prefer it.
- **Do not** introduce a module-level mutable map keyed coarser than `runId` (concurrency invariant — see spec §Concurrency).
- **SKILL.md braces**: the body uses `{request}/{os}/{cwd}/{mode}` placeholders injected by string-replace; avoid other literal `{...}` in the body.
- **Best-effort everywhere**: publish/persist failures are swallowed; generation never aborts on an observability failure.
- **Out of scope** (per spec): mid-loop user intervention, skill routing, SSE/streaming conversion, Go-agent changes, single-gesture long-press recording.
