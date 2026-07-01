# Voice → Bash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user speak a request; a server-side LLM (with read-only environment tools proxied to the Go agent) generates a single bash command; the user confirms in a popup; it runs in the terminal — via two entry points (long-press NEW TERM → new terminal; in-terminal voice FAB → existing pty).

**Architecture:** Node server orchestrates an OpenAI-compatible tool-calling loop (holds config/keys/prompt in admin `ServerSettings`); each read-only tool call is proxied to the Go agent over the existing agent-RPC channel; the loop returns raw bash; the phone shows an editable confirm popup (danger-warning + second-confirm) and, on confirm, writes `cmd + '\r'` to the pty. Read/write tiering: reads auto-run (scoped + sensitive-denylist + size-cap + audit), the only write (final bash) is human-confirmed.

**Tech Stack:** TypeScript/Node (Express) server + vitest; Go agent (`aliang.one/nursorgate`) + `go test`; React Native phone + jest. OpenAI-compatible `/chat/completions` with `tools`.

**Spec:** `AliangVibeCodingPhone/docs/superpowers/specs/2026-06-30-voice-to-bash-design.md`

**Working dirs (three separate repos):**
- Server: `AliangPhoneServer/server`
- Go agent: `~/MyProgram/GoProgram/nursor/alianggate`
- Phone: `AliangVibeCodingPhone`

**Verification authorities (LSP desyncs during refactors):** server `tsc --noEmit` + `vitest`; Go `go build ./... && go vet ./...` + `go test`; phone `tsc --noEmit` + `jest`.

---

## File Structure

### Server (`AliangPhoneServer/server/src`)
- **Create** `commandGen/tools.ts` — LLM tool definitions (`list_dir`/`read_file`/`git_status`/`env_info`), `DANGEROUS_COMMANDS` regex, sensitive-path denylist, `isDangerousCommand(cmd)`, `isSensitivePath(path)`, size cap.
- **Create** `commandGen/llmClient.ts` — OpenAI-compatible `/chat/completions` caller with `tools`; returns either `{kind:'tool_calls', calls}` or `{kind:'final', text}`.
- **Create** `commandGen/orchestrator.ts` — the tool loop: LLM → proxy tool calls to agent via `requestAgentPayload` (reuse `file.list`/`file.read`; new `git.status`/`env.info`) → feed back → cap loops/timeout → return `{command, dangerous}`.
- **Create** `commandGen/route.ts` — `POST /api/ai/command-gen` handler (mounted via `modules/routes/ai.ts`).
- **Modify** `types.ts` — add `ServerSettings.commandGen` shape.
- **Modify** `database.ts` + `postgresDatabase.ts` — `command_gen` JSON column on `server_settings` (sqlite + pg mirror).
- **Modify** `modules/routes/admin.ts` — read/write `commandGen` in `GET/PUT /api/admin/settings`.
- **Modify** `modules/agent/request.ts` — add `'git.status' | 'env.info'` to the `requestType` union + result-type matcher.
- **Modify** `app/index.ts` (or wherever `aiRouter` is mounted) — ensure new route is under the existing `/api/ai/*` bearer auth.
- **Modify** `web/src/App.tsx` — admin settings page: commandGen config section.
- **Tests** `commandGen/__tests__/{tools,llmClient,orchestrator,route}.test.ts`.

### Go agent (`~/MyProgram/GoProgram/nursor/alianggate`)
- **Recon (no code yet):** confirm `app/http/services/agent_remote_ws.go` dispatch + `app/http/models/agent_protocol.go` constants + how `file.list`/`file.read` are handled (read-only, cwd-scoped).
- **Modify** `app/http/models/agent_protocol.go` — add `AgentEventGitStatus`, `AgentEventEnvInfo` (+ `.result`/`.error` counterparts).
- **Modify** `app/http/services/agent_remote_ws.go` — dispatch `git.status`/`env.info` to new handlers; add to `remoteAgentMessageRequiresEnabledDevice`.
- **Create** `app/http/services/agent_envtools.go` — `gitStatus(...)` + `envInfo(...)` read-only handlers (cwd-scoped git subcommands; whitelisted env/version probes).
- **Tests** `app/http/services/agent_envtools_test.go`.

### Phone (`AliangVibeCodingPhone/src`)
- **Create** `api/commandGen.ts` — `generateCommand({text, deviceId, cwd, mode, sessionId?, projectId?})` via `apiPost`.
- **Create** `components/terminal/VoiceToBashModal.tsx` — shared modal (record → STT → endpoint → editable confirm popup → `onConfirm`).
- **Modify** `utils/terminalSuggestions.ts` — export `isUnsafeSuggestion` + `DANGEROUS_COMMANDS`.
- **Modify** `screens/vibecoding/VibeCodingListScreen.tsx` — NEW TERM FAB `onLongPress` → modal (mode `initial`) → `onConfirm` → navigate `DeviceTerminal({initialCommand})`.
- **Modify** `app/navigation/types.ts` — add `initialCommand?: string` to `DeviceTerminal` params.
- **Modify** `screens/devices/DeviceTerminalScreen.tsx` — auto-run `initialCommand` once when pty ready (Phase 1); add in-terminal voice FAB → modal (mode `live`) → inject `cmd+'\r'` (Phase 2).
- **Tests** `__tests__/{VoiceToBashModal,VibeCodingListScreen.longpress,DeviceTerminal.initialCommand}.test.tsx`.

---

# Phase 1

## Task S1: Server `commandGen` config (ServerSettings + DB + admin route)

**Files:**
- Modify: `server/src/types.ts` (`ServerSettings`)
- Modify: `server/src/database.ts`, `server/src/postgresDatabase.ts` (`server_settings.command_gen`)
- Modify: `server/src/modules/routes/admin.ts` (`GET/PUT /api/admin/settings`)
- Modify: `web/src/App.tsx` (admin config UI)
- Test: `server/test/command-gen-settings.test.ts` (or extend `store-state.test.ts`)

- [ ] **Step 1: Write the failing test** — config round-trips through ServerSettings.

```ts
// server/test/command-gen-settings.test.ts
import { describe, it, expect } from 'vitest';
import { serverSettings } from '../src/store';

describe('commandGen settings', () => {
  it('exposes a commandGen block with defaults', () => {
    expect(serverSettings.commandGen).toBeDefined();
    expect(serverSettings.commandGen.enabled).toBe(false);
    expect(serverSettings.commandGen.maxToolCalls).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — fails** (`commandGen` undefined).
- [ ] **Step 3: Add the type.** In `types.ts` `ServerSettings`:

```ts
export type CommandGenSettings = {
  enabled: boolean;
  baseUrl: string;        // e.g. https://api.openai.com/v1
  apiKey: string;         // server-held, never sent to agent/phone
  model: string;          // e.g. gpt-4o-mini
  promptTemplate: string; // {request}/{os}/{cwd}/{mode} placeholders
  maxToolCalls: number;   // default 6
  timeoutMs: number;      // default 25000
};

// inside ServerSettings:
  commandGen: CommandGenSettings;
```

- [ ] **Step 4: Seed defaults + persistence.** In the store seed (where `serverSettings` is initialized alongside STT fields) add:

```ts
commandGen: {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: '',
  promptTemplate: [
    'You convert a spoken request into ONE bash command.',
    'You may call read-only tools to inspect the environment first.',
    'Context — os: {os}, cwd: {cwd}, mode: {mode} ({mode=initial}: fresh shell, no history; {mode=live}: existing terminal).',
    'Output ONLY the raw bash command. No markdown fences, no explanation.',
    'Avoid destructive operations (rm -rf, sudo, mkfs, ...).',
  ].join('\n'),
  maxToolCalls: 6,
  timeoutMs: 25000,
},
```

Add a `command_gen` TEXT column (JSON) to `server_settings` (sqlite `ensureColumn` + the pg mirror's `server_settings` upsert), reading/writing `JSON.parse`/`JSON.stringify` of the block — mirroring how STT fields persist but as a single JSON blob (explicit deviation per spec §4.1: 7 fields always read/written together).

- [ ] **Step 5: Admin route.** In `modules/routes/admin.ts`, extend the `GET/PUT /api/admin/settings` body with `commandGen` (read from / write back to `serverSettings.commandGen` + `scheduleStateSave()`).

- [ ] **Step 6: Admin web UI.** In `web/src/App.tsx` add a "Voice→Bash (command-gen)" section to the server-settings page: enabled toggle, baseUrl, apiKey (password field), model, promptTemplate (textarea), maxToolCalls, timeoutMs — PUT on save.

- [ ] **Step 7: Run tests — pass.** `npx vitest run command-gen-settings` + `tsc --noEmit` (server).
- [ ] **Step 8: Commit** (server repo): `feat(server): commandGen admin config + persistence`.

---

## Task S2: `llmClient` (OpenAI-compatible tool-calling)

**Files:**
- Create: `server/src/commandGen/llmClient.ts`
- Test: `server/test/commandGen/llmClient.test.ts`

- [ ] **Step 1: Failing test** (mock global `fetch`).

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callLlm } from '../llmClient';

beforeEach(() => { vi.restoreAllMocks(); });

describe('callLlm', () => {
  it('returns tool_calls when present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 'list_dir', arguments: '{"path":"."}' } }], content: null } }] }),
    } as any));
    const r = await callLlm({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', messages: [], tools: [] });
    expect(r.kind).toBe('tool_calls');
    expect(r.calls[0].name).toBe('list_dir');
  });

  it('returns final text when no tool_calls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'git status --short', tool_calls: undefined } }] }),
    } as any));
    const r = await callLlm({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', messages: [], tools: [] });
    expect(r.kind).toBe('final');
    expect(r.text).toBe('git status --short');
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' } as any));
    await expect(callLlm({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', messages: [], tools: [] })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — fails** (module missing).
- [ ] **Step 3: Implement.**

```ts
// server/src/commandGen/llmClient.ts
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
};
export type ToolDef = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type LlmResult =
  | { kind: 'tool_calls'; calls: Array<{ id: string; name: string; args: Record<string, unknown> }> }
  | { kind: 'final'; text: string };

export async function callLlm(cfg: {
  baseUrl: string; apiKey: string; model: string;
  messages: ChatMessage[]; tools: ToolDef[];
}): Promise<LlmResult> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({ model: cfg.model, messages: cfg.messages, tools: cfg.tools, tool_choice: 'auto' }),
    });
    if (!res.ok) throw new Error(`llm_http_${res.status}: ${await res.text()}`);
    const data = await res.json();
    const msg = data?.choices?.[0]?.message ?? {};
    const calls = Array.isArray(msg.tool_calls) && msg.tool_calls.length
      ? msg.tool_calls.map((tc: any) => ({ id: tc.id, name: tc.function.name, args: safeParse(tc.function.arguments) }))
      : [];
    if (calls.length) return { kind: 'tool_calls', calls };
    return { kind: 'final', text: stripFences(String(msg.content ?? '').trim()) };
  } finally {
    clearTimeout(timer);
  }
}

const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return {}; } };
// Defend against models that wrap bash in ``` fences despite instructions.
const stripFences = (s: string) => s.replace(/^```[a-zA-Z]*\n?/g, '').replace(/```$/g, '').trim();
```

- [ ] **Step 4: Run — pass.** `npx vitest run commandGen/llmClient`.
- [ ] **Step 5: Commit:** `feat(server): commandGen OpenAI-compatible tool-calling client`.

---

## Task S3: Tools, `DANGEROUS_COMMANDS`, sensitive-denylist

**Files:**
- Create: `server/src/commandGen/tools.ts`
- Test: `server/test/commandGen/tools.test.ts`

- [ ] **Step 1: Failing test.**

```ts
import { describe, it, expect } from 'vitest';
import { COMMAND_GEN_TOOLS, isDangerousCommand, isSensitivePath, MAX_READ_BYTES } from '../tools';

describe('commandGen tools', () => {
  it('flags dangerous commands', () => {
    expect(isDangerousCommand('rm -rf /')).toBe(true);
    expect(isDangerousCommand('sudo rm -rf src')).toBe(true);
    expect(isDangerousCommand('ls -la')).toBe(false);
  });
  it('flags sensitive paths', () => {
    expect(isSensitivePath('.env')).toBe(true);
    expect(isSensitivePath('id_rsa')).toBe(true);
    expect(isSensitivePath('src/index.ts')).toBe(false);
  });
  it('exposes four tools', () => {
    expect(COMMAND_GEN_TOOLS.map(t => t.function.name)).toEqual(['list_dir', 'read_file', 'git_status', 'env_info']);
  });
  it('has a read size cap', () => { expect(MAX_READ_BYTES).toBeGreaterThan(0); });
});
```

- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement.**

```ts
// server/src/commandGen/tools.ts
import type { ToolDef } from './llmClient';

export const MAX_READ_BYTES = 8 * 1024;

// Mirrors phone utils/terminalSuggestions.ts DANGEROUS_COMMANDS (kept independent per repo).
export const DANGEROUS_COMMANDS = /\b(?:rm\s+-rf|sudo\s+rm|mkfs|diskutil\s+erase|shutdown|reboot|halt|poweroff)\b/;
export const isDangerousCommand = (cmd: string) => DANGEROUS_COMMANDS.test(cmd);

export const SENSITIVE_PATH = /(?:^|[\\/])(?:\.env[^\\/]*|id_(?:rsa|dsa|ecdsa|ed25519)|[^\\/]*\.(?:pem|key)|\.git[\\/]config|[^\\/]*token[^\\/]*|[^\\/]*secret[^\\/]*|credentials[^\\/]*)$/i;
export const isSensitivePath = (p: string) => SENSITIVE_PATH.test(p);

export const COMMAND_GEN_TOOLS: ToolDef[] = [
  { type: 'function', function: { name: 'list_dir', description: 'List entries in a path (relative to cwd).', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'read_file', description: `Read a text file (relative to cwd, capped at ${MAX_READ_BYTES} bytes). Sensitive files refused.`, parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'git_status', description: 'Is cwd a git repo? Branch + short status.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'env_info', description: 'OS, shell, user, versions of node/git/python.', parameters: { type: 'object', properties: {} } } },
];
```

- [ ] **Step 4: Run — pass.**
- [ ] **Step 5: Commit:** `feat(server): commandGen tool defs + danger/sensitive guards`.

---

## Task S4: Orchestrator (tool loop, proxy to agent, `recent_commands`)

**Files:**
- Create: `server/src/commandGen/orchestrator.ts`
- Modify: `server/src/modules/agent/request.ts` (add `'git.status' | 'env.info'` to `requestType`)
- Test: `server/test/commandGen/orchestrator.test.ts`

- [ ] **Step 1: Extend the agent-RPC union.** In `modules/agent/request.ts`, add to `requestType`: `'git.status' | 'env.info'` (the result-type matcher `${requestType}.result` then expects `git.status.result` / `env.info.result`). Also add `git.status.error`/`env.info.error` to `AGENT_REQUEST_ERROR_TYPES`.

- [ ] **Step 2: Failing test** (mock `callLlm` + `requestAgentPayload` + `getDatabase`).

```ts
import { describe, it, expect, vi } from 'vitest';
import { generateCommand } from '../orchestrator';

vi.mock('../llmClient', () => ({
  callLlm: vi.fn(),
  __esModule: true,
}));
vi.mock('../../modules/agent/request', () => ({
  requestAgentPayload: vi.fn(),
  __esModule: true,
}));

import { callLlm } from '../llmClient';
import { requestAgentPayload } from '../../modules/agent/request';

describe('generateCommand', () => {
  it('loops tools then returns final bash', async () => {
    (callLlm as any)
      .mockResolvedValueOnce({ kind: 'tool_calls', calls: [{ id: 'c1', name: 'env_info', args: {} }] })
      .mockResolvedValueOnce({ kind: 'final', text: 'git status --short' });
    (requestAgentPayload as any).mockResolvedValue({ os: 'darwin' });
    const r = await generateCommand({ request: 'show git state', deviceId: 'd1', userId: 'u1', cwd: '/repo', os: 'darwin', mode: 'live' });
    expect(requestAgentPayload).toHaveBeenCalledWith('u1', 'd1', 'env.info', expect.any(Object));
    expect(r.command).toBe('git status --short');
    expect(r.dangerous).toBe(false);
  });

  it('flags dangerous final command', async () => {
    (callLlm as any).mockResolvedValueOnce({ kind: 'final', text: 'rm -rf node_modules' });
    const r = await generateCommand({ request: 'clean', deviceId: 'd1', userId: 'u1', cwd: '/r', os: 'linux', mode: 'initial' });
    expect(r.dangerous).toBe(true);
  });

  it('feeds tool error back and still produces bash', async () => {
    (callLlm as any)
      .mockResolvedValueOnce({ kind: 'tool_calls', calls: [{ id: 'c1', name: 'read_file', args: { path: '.env' } }] })
      .mockResolvedValueOnce({ kind: 'final', text: 'ls' });
    const r = await generateCommand({ request: 'x', deviceId: 'd1', userId: 'u1', cwd: '/r', os: 'linux', mode: 'live' });
    expect(r.command).toBe('ls'); // sensitive path refused client-side, error fed back
  });
});
```

- [ ] **Step 3: Run — fails.**
- [ ] **Step 4: Implement.**

```ts
// server/src/commandGen/orchestrator.ts
import { callLlm, type ChatMessage } from './llmClient';
import { COMMAND_GEN_TOOLS, isDangerousCommand, isSensitivePath, MAX_READ_BYTES } from './tools';
import { requestAgentPayload } from '../modules/agent/request';
import { getDatabase, rememberAudit } from '../store';

export type GenInput = { request: string; deviceId: string; userId: string; cwd: string; os?: string; mode: 'initial' | 'live'; sessionId?: string; projectId?: string; promptTemplate: string; baseUrl: string; apiKey: string; model: string; maxToolCalls: number; timeoutMs: number; };
export type GenResult = { command: string; dangerous: boolean };

export async function generateCommand(input: GenInput): Promise<GenResult> {
  const sys = input.promptTemplate
    .replaceAll('{request}', input.request)
    .replaceAll('{os}', input.os ?? 'unknown')
    .replaceAll('{cwd}', input.cwd)
    .replaceAll('{mode}', input.mode);
  const messages: ChatMessage[] = [
    { role: 'system', content: sys },
    { role: 'user', content: input.request },
  ];
  const deadline = Date.now() + input.timeoutMs;
  for (let i = 0; i < input.maxToolCalls && Date.now() < deadline; i++) {
    const res = await callLlm({ baseUrl: input.baseUrl, apiKey: input.apiKey, model: input.model, messages, tools: COMMAND_GEN_TOOLS });
    if (res.kind === 'final') {
      const dangerous = isDangerousCommand(res.text);
      rememberAudit({ userId: input.userId, deviceId: input.deviceId, sessionId: input.sessionId, projectId: input.projectId, eventType: 'command_gen.final', metadata: { dangerous } });
      return { command: res.text, dangerous };
    }
    // assistant tool_calls turn
    messages.push({ role: 'assistant', content: null, tool_calls: res.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
    for (const c of res.calls) {
      const out = await runTool(input, c.name, c.args);
      messages.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: out });
    }
  }
  // Did not converge: best-effort — ask once for final with no tools.
  messages.push({ role: 'user', content: 'Produce the single bash command now. No tools.' });
  const fin = await callLlm({ baseUrl: input.baseUrl, apiKey: input.apiKey, model: input.model, messages, tools: [] });
  const text = fin.kind === 'final' ? fin.text : 'echo "command generation did not converge"';
  return { command: text, dangerous: isDangerousCommand(text) };
}

async function runTool(input: GenInput, name: string, args: Record<string, unknown>): Promise<string> {
  rememberAudit({ userId: input.userId, deviceId: input.deviceId, sessionId: input.sessionId, projectId: input.projectId, eventType: 'command_gen.tool', metadata: { tool: name, args } });
  try {
    // NOTE: the reused file.list/file.read RPCs read `project_path` on the agent
    // side (confirmed: agent_detail.go resolveAgentProjectPath(remoteString(msg,"project_path")));
    // the NEW git.status/env.info handlers read `cwd` (authored fresh). Confirm in G1.
    switch (name) {
      case 'list_dir':
        return stringify(await requestAgentPayload(input.userId, input.deviceId, 'file.list', { project_path: input.cwd, path: String(args.path ?? '.') }));
      case 'read_file': {
        const path = String(args.path ?? '');
        if (isSensitivePath(path)) return 'error: sensitive_path_denied';
        const r = await requestAgentPayload(input.userId, input.deviceId, 'file.read', { project_path: input.cwd, path });
        const text = stringify(r); // agent may return base64; keep simple — cap length
        return text.slice(0, MAX_READ_BYTES);
      }
      case 'git_status':
        return stringify(await requestAgentPayload(input.userId, input.deviceId, 'git.status', { cwd: input.cwd }));
      case 'env_info':
        return stringify(await requestAgentPayload(input.userId, input.deviceId, 'env.info', { cwd: input.cwd }));
      case 'recent_commands': {
        if (input.mode !== 'live' || !input.sessionId) return 'error: no_history';
        const cmds = getDatabase()?.listTerminalCommandsBySession(input.sessionId, { limit: 8 }) ?? [];
        return cmds.map((c: any) => c.command).join('\n');
      }
      default:
        return 'error: unknown_tool';
    }
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}

const stringify = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
```

> Note: `rememberAudit` signature may differ (it accepts a shaped object) — confirm exact shape at implementation and adjust. `listTerminalCommandsBySession` exists (used by terminal route).

- [ ] **Step 5: Run — pass.**
- [ ] **Step 6: Commit:** `feat(server): commandGen tool-calling orchestrator`.

---

## Task S5: `POST /api/ai/command-gen` route

**Files:**
- Create: `server/src/commandGen/route.ts`
- Modify: `server/src/modules/routes/ai.ts` (mount `router` from route.ts)
- Test: `server/test/commandGen/route.test.ts`

- [ ] **Step 1: Failing test** (supertest/express against the ai router; mock orchestrator).

```ts
// Assert: 200 {command,dangerous} on happy path; 503 when commandGen.enabled=false; 401 without bearer; 400 on bad body.
```

- [ ] **Step 2: Implement handler.**

```ts
// server/src/commandGen/route.ts
import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../errors';
import { requireUserId } from '../shared/auth/guards';
import { getAccessibleDeviceOrThrow } from '../shared/auth/access';
import { serverSettings, rememberAudit } from '../store';
import { generateCommand } from './orchestrator';

export const commandGenRouter = Router();
const schema = z.object({
  text: z.string().min(1),
  deviceId: z.string().min(1),
  cwd: z.string(),
  mode: z.enum(['initial', 'live']),
  sessionId: z.string().optional(),
  projectId: z.string().optional(),
});

commandGenRouter.post('/api/ai/command-gen', async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const input = schema.parse(req.body);
    const cfg = serverSettings.commandGen;
    if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey || !cfg.model) throw new ApiError(503, 'command_gen_not_configured');
    const device = getAccessibleDeviceOrThrow(req, input.deviceId);
    const result = await generateCommand({
      request: input.text, deviceId: device.id, userId, cwd: input.cwd, os: device.os, mode: input.mode,
      sessionId: input.sessionId, projectId: input.projectId,
      promptTemplate: cfg.promptTemplate, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model,
      maxToolCalls: cfg.maxToolCalls, timeoutMs: cfg.timeoutMs,
    });
    res.json(result);
  } catch (e) { next(e); }
});
```

- [ ] **Step 3: Mount.** In `modules/routes/ai.ts`, `import { commandGenRouter } from '../../commandGen/route'` and `router.use(commandGenRouter)` (so it inherits the `/api/ai/*` bearer auth applied where `aiRouter` is mounted in `app/index.ts`).
- [ ] **Step 4: Run server tests + `tsc --noEmit` — pass.**
- [ ] **Step 5: Commit:** `feat(server): POST /api/ai/command-gen endpoint`.

---

## Task G1: Go agent — recon (confirm hook points)

**Repo:** `~/MyProgram/GoProgram/nursor/alianggate`. No code yet — read and record.

- [ ] **Step 1:** Read `app/http/services/agent_remote_ws.go` around the `switch msgType` (~line 359) and `remoteAgentMessageRequiresEnabledDevice` (~line 117). Record the exact handler-call shape (e.g. `s.detail.fileList(msg, writeJSON)`).
- [ ] **Step 2:** Read `app/http/models/agent_protocol.go` — record how `AgentEventFileList`/`AgentEventFileRead` (and their `.result`/`.error`) are defined, so the new `AgentEventGitStatus`/`AgentEventEnvInfo` match the convention.
- [ ] **Step 3:** Read the existing `file.list`/`file.read` Go handlers (likely `app/http/services/agent_detail.go`) — confirm they are read-only and scoped to authorized/cwd paths (so `list_dir`/`read_file` need **no Go change**, only the new `git.status`/`env.info`). Record the authorized-path helper used.
- [ ] **Step 4:** Record findings as a short note in this task; no commit.

---

## Task G2: Go agent — `git_status` + `env_info` handlers

**Files:**
- Modify: `app/http/models/agent_protocol.go`
- Create: `app/http/services/agent_envtools.go`
- Modify: `app/http/services/agent_remote_ws.go`
- Test: `app/http/services/agent_envtools_test.go`

- [ ] **Step 1: Failing test.** Test `gitStatus(msg, writeJSON)` against a temp git repo asserts a `git.status.result` message with `is_repo:true` + branch; `envInfo(...)` asserts os/shell non-empty + only whitelisted keys (no full env). Use the patterns already in `agent_service_test.go`.
- [ ] **Step 2: Add constants** in `agent_protocol.go` mirroring the file.* convention: `AgentEventGitStatus = "git.status"` (+ `git.status.result`/`git.status.error`), `AgentEventEnvInfo = "env.info"` (+ result/error).
- [ ] **Step 3: Implement** `agent_envtools.go`:
  - `gitStatus(msg, writeJSON)`: parse `cwd`; if `cwd/.git` exists → run `git rev-parse --abbrev-ref HEAD` + `git status --short` (bounded output, read-only); reply `{type:"git.status.result", request_id, is_repo, branch, status}`. On no repo → `{is_repo:false}`. Reject any cwd outside authorized dirs (use the helper found in G1).
  - `envInfo(msg, writeJSON)`: collect only whitelisted items — `runtime.GOOS`, `runtime.GOARCH`, `$SHELL`, `$USER` (or `os/user`), and probe versions via `<tool> --version` for `node`/`git`/`python3` (best-effort, short timeout, ignore failures). Reply `{type:"env.info.result", request_id, os, arch, shell, user, versions}`. **Never** dump `os.Environ()`.
  - Both must be read-only and never execute caller-controlled command text (only fixed subcommands).
- [ ] **Step 4: Wire dispatch.** In `agent_remote_ws.go`: add `case models.AgentEventGitStatus: s.envtools.gitStatus(msg, writeJSON)` and `case models.AgentEventEnvInfo: s.envtools.envInfo(msg, writeJSON)`; add both to `remoteAgentMessageRequiresEnabledDevice`.
- [ ] **Step 5: `go build ./... && go vet ./... && go test ./app/http/services/` — pass.**
- [ ] **Step 6: Commit** (Go repo): `feat(agent): git.status + env.info read-only tools`.

> **Note:** if recon (G1) shows `file.read` does NOT already block sensitive files, add a server-side denylist guard (already in orchestrator `runTool`) — the Go side stays read-only + cwd-scoped; sensitive-path denial is enforced in the orchestrator before the RPC is sent. Verify during G1.

---

## Task P1: Phone API client

**Files:**
- Create: `src/api/commandGen.ts`
- Test: `__tests__/api/commandGen.test.ts` (mock `apiPost`)

- [ ] **Step 1: Failing test** asserting `generateCommand({…})` POSTs to `/api/ai/command-gen` with the right body and returns `{command, dangerous}`.
- [ ] **Step 2: Implement.**

```ts
// src/api/commandGen.ts
import { apiPost } from './client';

export type CommandGenMode = 'initial' | 'live';
export interface CommandGenResult { command: string; dangerous: boolean }

export const generateCommand = (input: {
  text: string; deviceId: string; cwd: string; mode: CommandGenMode;
  sessionId?: string; projectId?: string;
}): Promise<CommandGenResult> =>
  apiPost<CommandGenResult>('/api/ai/command-gen', input);
```

- [ ] **Step 3: Run — pass.** `tsc --noEmit` + jest.
- [ ] **Step 4: Commit:** `feat(phone): commandGen api client`.

---

## Task P2: Export danger helpers from `terminalSuggestions`

**Files:**
- Modify: `src/utils/terminalSuggestions.ts`

- [ ] **Step 1: Test** that `isUnsafeSuggestion` and `DANGEROUS_COMMANDS` are importable.
- [ ] **Step 2: Change** `function isUnsafeSuggestion` → `export function isUnsafeSuggestion` and `const DANGEROUS_COMMANDS` → `export const DANGEROUS_COMMANDS`.
- [ ] **Step 3: Run phone tests + tsc — pass.**
- [ ] **Step 4: Commit:** `refactor(phone): export isUnsafeSuggestion + DANGEROUS_COMMANDS`.

---

## Task P3: `VoiceToBashModal` (shared)

**Files:**
- Create: `src/components/terminal/VoiceToBashModal.tsx`
- Test: `__tests__/VoiceToBashModal.test.tsx`

- [ ] **Step 1: Failing tests** (mock `useVoiceStt` + `generateCommand`):
  - `recording → stop → onConfirm(command)` happy path (initial mode).
  - `dangerous` result shows warning + requires second confirm tap.
  - local `isUnsafeSuggestion` command (user-edited to `rm -rf x`) triggers second confirm.
  - Cancel calls `useVoiceStt.cancel()`.
  - Endpoint failure → error state with retry.
- [ ] **Step 2: Implement.** State machine `recording | transcribing | confirming | error`. Props: `{ visible, mode, deviceId, cwd, deviceOs?, sessionId?, projectId?, onClose, onConfirm }`. The hook takes **no args**: `const stt = useVoiceStt();`. Wire recording with `stt.start({ onComplete: async transcript => { setStatus('transcribing'); const r = await generateCommand({ text: transcript, deviceId, cwd, mode, sessionId, projectId }); setCommand(r.command); setDangerous(r.dangerous || isUnsafeSuggestion(r.command)); setStatus('confirming'); }, sessionId, projectPath })`. Tap mic → `stt.start(...)`, tap "停止" → `stt.stop()`. Live caption from `stt.liveCaption`, errors from `stt.errorMessage`. Confirming view: editable `TextInput` (mono) + danger red text + `取消 / 重录 / 确认运行`. `onConfirm(command)`. On close/unmount: `stt.cancel()`. (Render in a `<Modal>`; reuse `GlassPanel` + theme typography for house style.)
- [ ] **Step 3: Run — pass.** (Use `jest.useFakeTimers()` + unmount in `afterEach` — `useVoiceStt` uses animated state.)
- [ ] **Step 4: Commit:** `feat(phone): VoiceToBashModal shared voice→bash confirm`.

---

## Task P4: Entry A — long-press NEW TERM

**Files:**
- Modify: `src/screens/vibecoding/VibeCodingListScreen.tsx` (the NEW TERM FAB has `onPress=handleCreateTerminal`)
- Modify: `src/app/navigation/types.ts` (`DeviceTerminal.initialCommand`)
- Test: `__tests__/VibeCodingListScreen.longpress.test.tsx`

- [ ] **Step 1: Failing test** — long-pressing the NEW TERM FAB opens `VoiceToBashModal` (initial mode, correct device/cwd); a short tap still calls `handleCreateTerminal`; `onConfirm(cmd)` navigates to `DeviceTerminal` with `initialCommand`.
- [ ] **Step 2: Add `initialCommand?: string`** to `DeviceTerminal` in `RootStackParamList`.
- [ ] **Step 3: Wire.** In `VibeCodingListScreen`: add `onLongPress` to the NEW TERM `TouchableOpacity` → set modal-visible state with `{ mode:'initial', deviceId: newTerminalDevice.id, cwd: newTerminalDevice.authorizedDirectories[0] ?? '~', deviceOs: newTerminalDevice.os }`. On `onConfirm(command)` → `navigation.navigate('DeviceTerminal', { deviceId: newTerminalDevice.id, directory: <cwd>, initialCommand: command })`. Render `<VoiceToBashModal .../>`. Guard: no-op when `!newTerminalDevice`.
- [ ] **Step 4: Run — pass.** `tsc --noEmit` + jest.
- [ ] **Step 5: Commit:** `feat(phone): long-press NEW TERM → voice→bash → new terminal`.

---

## Task P5: `DeviceTerminal` initial-command auto-run

**Files:**
- Modify: `src/screens/devices/DeviceTerminalScreen.tsx`
- Test: `__tests__/DeviceTerminal.initialCommand.test.tsx`

- [ ] **Step 1: Recon.** In `DeviceTerminalScreen`, find the EXECUTE path — `sendToTerminal(data)`, which writes via `terminalBridgeRef.current?.sendText(...)`. To run a full command you send `${command}\r`. Confirm its exact signature in recon (P5/P6 both rely on it).
- [ ] **Step 2: Failing test** — when route has `initialCommand` and the terminal becomes input-available, the send function is called once with `command + '\r'`; not called again on re-render; not called when no `initialCommand`.
- [ ] **Step 3: Implement.** Read `route.params.initialCommand`; in an effect gated on `terminalInputEnabled && initialCommand && !ranRef.current`, call the send function with `${initialCommand}\r`, then set `ranRef.current = true` and clear the param (`navigation.setParams({ initialCommand: undefined })`).
- [ ] **Step 4: Run — pass.**
- [ ] **Step 5: Commit:** `feat(phone): DeviceTerminal auto-runs initialCommand once`.

---

# Phase 2

## Task P6: Entry B — in-terminal voice FAB + pty injection

**Files:**
- Modify: `src/screens/devices/DeviceTerminalScreen.tsx` (the suggestion/input bar — `SuggestionActionBar` + command input row)
- Test: `__tests__/DeviceTerminal.voiceFab.test.tsx`

- [ ] **Step 1: Failing test** — a voice FAB renders at the right end of the suggestion/input bar; enabled only when `terminalInputEnabled`; tap opens `VoiceToBashModal` (live mode, current device/cwd); `onConfirm(cmd)` calls the pty send function with `cmd + '\r'` and closes.
- [ ] **Step 2: Implement.** Add a small voice FAB (NEW-TERM capsule styling, icon) as the last element of the suggestion/input row. On press → open modal `{ mode:'live', deviceId: terminal.deviceId, cwd: terminal.directory, deviceOs, sessionId, projectId }`. `onConfirm` → call `sendToTerminal(command + '\r')` (same path P5 uses) → close modal.
- [ ] **Step 3: Run — pass.** Full phone suite: `tsc --noEmit` + `jest` (expect baseline flake count unchanged).
- [ ] **Step 4: Commit:** `feat(phone): in-terminal voice FAB → voice→bash → pty`.

---

# Integration & Hardening

- [ ] **End-to-end smoke (manual, on device):** admin configures commandGen (baseUrl/key/model) → long-press NEW TERM → speak "show git status" → confirm → terminal runs `git status --short`. Then in-terminal FAB → speak → confirm → runs. Verify a dangerous spoken request triggers the red warning + second confirm.
- [ ] **Agent build/deploy:** rebuild Go agent (`go build ./cmd/aliang`) and redeploy (deployed binary lags source — per project memory). Phone: pod install / bundle if native audio module changed (it shouldn't here).
- [ ] **Three-repo tsc/build green:** server `tsc --noEmit` + `vitest`; Go `go build ./... && go vet ./...`; phone `tsc --noEmit` + `jest`.

---

## Notes for the implementer
- **Three repos, separate commits** — commit in each repo as you finish its tasks.
- **Go repo not in this workspace's codegraph** — use grep/read there; recon (G1) before writing Go code.
- **Reuse, don't duplicate:** `list_dir`/`read_file` reuse the existing `file.list`/`file.read` agent RPC (verify scope in G1); `recent_commands` reuses `listTerminalCommandsBySession` server-side; phone reuses `useVoiceStt`, `apiPost`, `isUnsafeSuggestion`, the terminal EXECUTE send path, `SuggestionActionBar` styling.
- **Safety invariant:** tools are auto-run only because they are read-only + cwd-scoped + sensitive-denied + size-capped + audited. Never add a write-capable tool without upgrading to the per-tool policy model (spec §14).
