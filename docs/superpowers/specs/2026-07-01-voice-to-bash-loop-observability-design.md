# Voice→Bash Loop Observability + Skill Prompts — Design

> Status: design (pending plan). Owner: server + phone. Go agent unchanged.

## Goal

Make the existing voice→bash command-generation pipeline **observable and smarter**, without changing its execution contract:

1. The LLM tool-calling loop becomes **visible in real time** — every step (LLM decision, read-only tool call, tool result) streams live to the phone **and** is persisted for the admin.
2. The system prompt is upgraded to a **skill-grade expert document** (`SKILL.md`), with an explicit termination policy so the model actively converges instead of waiting for the timeout safety net.
3. The phone capture UX becomes **hold-to-talk** with a transcript **edit/confirm** step before the text is sent to the AI.

The command still runs through the existing `sendToTerminal` path after a human confirm. The agent is not touched (its `file.list` / `file.read` / `git.status` / `env.info` handlers already exist).

## Background — what exists today

- **Flow works**: long-press NEW TERM → `VoiceToBashModal` → `POST /api/ai/command-gen` → `orchestrator.generateCommand` runs an LLM tool-calling loop (read-only tools proxied to the Go agent via `requestAgentPayload`) until the LLM emits a final bash string → phone confirms → `DeviceTerminal` auto-runs `cmd\r`.
- **Concurrency is already safe**: each `POST` is an independent request with a local `messages` array and a `request_id`-correlated agent RPC channel. Users cannot observe or pollute each other's state. Shared resources are only the per-user rate limiter and the multiplexed agent connection. **No new isolation work is required**; this design must not break that invariant.
- **Loop is opaque**: the only artifacts today are sparse `rememberAudit` logs (`command_gen.tool`, `command_gen.final`). The phone shows only `recording → transcribing → confirming`; the whole loop happens server-side in the dark.
- **Modal auto-records** on open (`phase` defaults to `recording` + an auto-start effect). There is no hold-to-talk and no transcript-edit step; only the final bash command is editable.
- **Prompt** (`DEFAULT_COMMAND_GEN.promptTemplate`) is detailed on safety/output but says nothing about *when to stop calling tools and return the final command* — loop exit relies entirely on the model's discretion, with `maxToolCalls`/`timeoutMs` as a passive safety net.

## Non-goals

- Mid-loop **user intervention** (cancel a tool call, redirect the AI mid-turn). Observation only; the single confirm gate remains at the end, as today.
- A **skill-routing system** (loading different skills per request intent). The domain is narrow — one well-crafted skill is enough (YAGNI).
- Reusing an off-the-shelf bash skill. Research confirmed the official `anthropics/skills` repo has only document/creative skills; no terminal/bash-generation skill exists to adopt.
- Go-agent changes. Its read-only tool handlers are sufficient.
- Making the real-time WS channel authoritative. REST remains the source of truth for the final command.

## Architecture — refined end-to-end flow

```
① Long-press NEW TERM (or in-terminal voice FAB) → open modal at `idle`
② Hold-to-talk on the modal's mic pad:
   onPressIn → voiceStt.start() (live partial transcript)
   onPressOut → voiceStt.stop() → STT finalizes
③ `transcribing` → final transcript lands in `review` state (editable)
④ User edits (optional) → 确认发送  →  POST /api/ai/command-gen {text,deviceId,cwd,mode,sessionId?}
   └ server assigns runId, pushes commandGen.runStarted{runId} over WS
⑤ Server orchestrator runs the loop (per-user independent instance):
   system prompt = SKILL.md (terminal-command-composer) + {os}/{cwd}/{mode}/{request}
   loop (≤ maxToolCalls, until LLM returns final):
     LLM decision ─┬─ tool_call → proxy to agent (list_dir/read_file/git_status/env_info)
                   │             └ result fed back to LLM, continue
                   └─ final (single bash) → exit
   EACH step: WS-push commandGen.step to phone  +  persist to command_gen_steps (for admin)
⑥ Phone renders the step timeline live inside the modal ("read ./package.json ✓ → git status ✓ → generating…")
⑦ Converge → final bash shown in `confirming` (editable; danger → 2nd confirm) → user confirms
⑧ DeviceTerminal (create terminal first if no terminalId) → auto-inject cmd\r (existing sendToTerminal)
```

## Component designs

### A. Phone — hold-to-talk modal state machine

Decouple the two gestures: **long-press FAB only opens the modal** (finger lifts); **hold-to-talk happens on the modal's own mic pad** (a fresh touch target). This sidesteps the React Native touch-responder problem — a capturing `Modal` cannot track a finger that started on the FAB, so we do not try to transfer the touch.

```
idle ──hold mic pad──▶ recording ──release──▶ transcribing ──▶ review ──确认──▶ generating ──▶ confirming ──运行──▶ terminal
                          │  重录                  │  重录                 │  重录/取消
                          └───────────────────────▶                        │
```

- **`idle`** (new; replaces auto-record): modal opens here. Shows "按住说话，松手结束" + a large mic pad. The auto-start-on-open effect is removed.
- **`recording`**: `onPressIn → voiceStt.start()` (reuse the proven `VoiceTextInput` hold-to-talk pattern, line 223-224: `onPressIn`/`onPressOut` on a `Pressable`). Live partial transcript refreshes locally.
- **`transcribing`**: `onPressOut → voiceStt.stop()`; await `onComplete`.
- **`review`** (new — the "edit or confirm" step): the final transcript is placed in an **editable `TextInput`**. Two actions: 「确认发送」(→ POST to AI) and 「重录」(→ back to `idle`). This edits *what the user said*, distinct from `confirming` which edits *what runs*.
- **`generating`**: AI loop running; the live step timeline (Component C) renders here.
- **`confirming`** (existing, repurposed): final bash editable + danger 2nd-confirm + 「运行」/「重录」/「取消」.

Reuses: `useVoiceStt()` (no args; `start({onComplete,sessionId,projectPath})` / `stop()` / `cancel()`), the `onPressIn`/`onPressOut` gesture from `VoiceTextInput`, and the existing `sendToTerminal` execution path.

### B. Server — orchestrator emits step events + persists

`generateCommand(input)` gains two side effects per loop iteration, both **best-effort** (a failure to push/persist must not abort generation):

1. **Emit** a `commandGen.step` WS event (Component C).
2. **Persist** a `command_gen_steps` row (Component D), and finalize the `command_gen_runs` row on converge/fail.

A `runId` is assigned at the top of `generateCommand` (server-generated, e.g. `cgr_<nanoid>`), threaded through every emit/persist, and returned in the HTTP response body alongside `{command, dangerous}`. REST is authoritative, so a phone that missed the WS stream still receives the final command and its `runId` from the HTTP response — no separate phone-scoped fetch endpoint is needed (the run-detail GETs in Component F are admin-only).

### C. WS streaming — best-effort, REST authoritative

- Reuse the **existing mobile WS** channel (same path as `ai.delta` / structured-ai-events / `terminal.output`).
- New event types, addressed to `(userId, deviceId)`:
  - `commandGen.runStarted { runId, text, cwd, mode, model, ts }`
  - `commandGen.step { runId, seq, kind, toolName?, toolArgs?, snippet?, durationMs, ts }` — `kind ∈ {llm_thought, tool_call, tool_result, final}`
  - `commandGen.runFinished { runId, status, finalCommand, dangerous, ts }`
  - `commandGen.failed { runId, reason, ts }`
- **Correlation**: the phone obtains `runId` from `commandGen.runStarted` (pushed the instant the run begins) and groups subsequent same-`runId` `step` events into the timeline. The HTTP response remains `{ command, dangerous, runId }`.
- **Reliability contract**: WS is a *real-time enhancement only*. If the WS is down or drops packets, the phone simply does not see the intermediate steps, but the POST still returns the final command and the feature works. Zero correctness dependency on WS delivery. (Deliberately avoids converting the endpoint to a streaming/SSE contract — REST stays authoritative, matching the existing `ai.done`/refresh-recovery philosophy.)

### D. Data model — loop observability (sqlite + pg mirror)

Two new tables, mirrored across both DB drivers (the established pattern). Append-only step rows; bounded run retention.

- **`command_gen_runs`** (one row per request):
  `runId` (pk) · `userId` · `deviceId` · `sessionId?` · `cwd` · `mode` · `status` (`running`/`converged`/`failed`) · `finalCommand` · `dangerous` · `llmModel` · `stepCount` · `createdAt` · `convergedAt`
- **`command_gen_steps`** (one row per step, belongs to a run):
  `runId` (fk) · `seq` · `kind` (`llm_thought`/`tool_call`/`tool_result`/`final`) · `toolName?` · `toolArgs?` (json) · `resultSnippet?` (truncated to a cap, e.g. 2 KB, to prevent bloat) · `durationMs` · `createdAt`
- **Retention**: keep the most recent N runs per user (e.g. 50); older runs + their steps are pruned. Pruning runs as a side check on run finalize (cheap, bounded) — no background sweeper needed. Pruning queries/sorts by `(userId, createdAt DESC)`, so create the index that way up front.
- Both DB drivers implement the same methods (`insertCommandGenRun`, `updateCommandGenRunStatus`, `insertCommandGenStep`, `listCommandGenRunsByUser`, `getCommandGenRunWithSteps`).

### E. Skill loading

- New file **`server/skills/terminal-command-composer/SKILL.md`**, format aligned to the open [Agent Skills standard](https://agentskills.io) / [anthropics/skills](https://github.com/anthropics/skills):
  - YAML frontmatter: `name`, `description`, `triggers`.
  - Structured body: **Role → Decision policy → Termination → Safety → Good patterns / do-don't → Output contract**.
- **Termination section** (the key addition — currently missing): explicitly tells the model
  - "Once you have enough information, **stop calling tools** and return the final single bash command with **no tool call** — that final message is the exit signal."
  - "Budget: at most ~`{maxToolCalls}` tool calls; usually 0–2 suffice. Do not loop for the sake of it."
  - "If the request is unsafe or unclear, exit immediately with a single `echo` command — do not keep calling tools."
  The hard caps (`maxToolCalls`, `timeoutMs`) remain as a safety net, but the model is now an **active convergence participant** rather than a passive one.
- **Wiring**: at seed/default time, `DEFAULT_COMMAND_GEN.promptTemplate` is populated from the `SKILL.md` body. The existing admin-editable `promptTemplate` field (PUT `/api/admin/settings` → `command_gen.promptTemplate`, already shipped) becomes the **override**; the file is the versioned default. So the skill is both file-versioned and admin-editable, with **no new mechanism**.
- **Hot-reload**: re-read the file when its mtime changes (cheap stat on config read), so edits to the committed file take effect without a restart. Admin-overridden `promptTemplate` always wins over the file.
- Runtime-context placeholders (`{request}`/`{os}`/`{cwd}`/`{mode}`) are injected at the top of the assembled system prompt, unchanged from today. Injection is plain string-replace, so the SKILL.md body must avoid literal `{...}` sequences outside these four known placeholders (use a different bracket style for any illustrative braces).

### F. Admin — command-gen runs viewer

In the admin web (VibeCoding tab), add a **「命令生成」(Command Gen)** section:
- List recent `command_gen_runs` (user, device, status, command, step count, time). Click a run → step timeline (reuse the `PipelineStepper` styling already used for turn pipelines): each step shows `kind`/`toolName`/`snippet`/`duration`.
- New endpoints: `GET /api/admin/command-gen/runs` (paginated, filterable by user/device) and `GET /api/admin/command-gen/runs/:runId` (run + steps).
- Read-only (no edit from this view; skill/prompt editing stays in the existing server-settings page).

## Concurrency

Per-request isolation is already correct (local `messages`, `request_id`-multiplexed agent RPC). This design adds per-run state (`runId`-keyed rows, `runId`-addressed WS events) that is **also** per-request and never cross-user. The only invariant to preserve: never introduce a module-level mutable map keyed by something coarser than `runId`/`request_id`. Rate limiting stays per-user (10/60s, existing).

## Error handling

- **LLM timeout/error**: run → `failed`; WS-push `commandGen.failed`; phone shows "生成失败 · 重试" (reuse the existing failed-session retry affordance). The `command_gen_runs` row is finalized as `failed`.
- **Agent tool timeout/error** (e.g. the recently-fixed missing-`type` bug, now patched): the step row records `error`; the error string is fed back to the LLM and the loop continues (existing `runTool` try/catch).
- **WS push failure**: swallowed (best-effort); the step is still persisted, so admin sees it and the phone recovers via the final REST response.
- **Persist failure**: swallowed (best-effort); generation still completes and returns the command. Observability is non-blocking.
- **Loop does not converge**: the existing no-tools fallback ask runs; run finalizes as `converged` with possibly a placeholder command (`echo "command generation did not converge"`), matching today.

## Testing

- **Orchestrator** (extend existing `test/commandGen/orchestrator.test.ts`): each loop iteration emits a `commandGen.step` and persists a step row; run finalizes `converged`/`failed`; best-effort failures (mocked emit/persist throwing) do not abort generation; and the HTTP response carries the new `runId` field.
- **WS contract**: the new event shapes (`commandGen.runStarted`/`step`/`runFinished`/`failed`) are addressed to the right `(userId, deviceId)` and carry `runId`/`seq`.
- **SKILL.md loader**: reads file, seeds `promptTemplate`, hot-reloads on mtime change, admin override wins, missing file falls back to an embedded default.
- **Termination behavior**: with a stubbed LLM that returns a final on turn 1, the loop exits immediately (no extra tool calls); the prompt's termination guidance is asserted in a prompt-content test.
- **DB** (sqlite + pg parity): run/step insert + list + get-with-steps + retention pruning; `resultSnippet` truncation.
- **Admin endpoints**: pagination + ownership scoping (admin sees all; future per-user scope if needed).
- **Phone**: modal state machine `idle → recording → transcribing → review → generating → confirming`; `review` pre-fills the editable transcript; hold-to-talk `onPressIn`/`onPressOut` wires start/stop; live step timeline renders grouped by `runId`. (Existing ~3 terminal-flake baseline.)

## Open questions / deferred

- Exact run retention N (proposed 50/user) — confirm during plan.
- Whether the live step timeline on phone should show **tool result snippets** or only tool **names** (snippets are more useful but noisier on a small screen). Proposed: names by default, expandable snippet.
- Single-gesture variant (long-press FAB itself is the recording gesture via a non-capturing inline overlay) is explicitly **out of scope** unless the decoupled two-gesture feel proves unsatisfactory in real-device testing.

## References

- [anthropics/skills (official repo)](https://github.com/anthropics/skills)
- [Agent Skills open standard (agentskills.io)](https://agentskills.io/home)
- [Anthropic Engineering — Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Claude Platform Docs — Agent Skills (progressive disclosure)](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
