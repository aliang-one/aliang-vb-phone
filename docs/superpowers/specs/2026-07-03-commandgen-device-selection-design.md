# commandGen: AI-selected target device (initial mode)

> **Status:** Design (brainstormed 2026-07-03). Spans server (`AliangPhoneServer/server`) + phone (`AliangVibeCodingPhone`). Go agent unchanged.

## Goal

In the **initial** (new-terminal) voice→bash flow, let the commandGen AI discover the user's online devices and choose which device the generated command should run on. The phone then creates a terminal on the AI-chosen device (user can override via an in-modal device picker) and runs the command.

## Background / current state

- Two voice→bash entry points, both via `VoiceToBashModal`:
  - **initial** (`VibeCodingListScreen`): user pre-picks `voiceTargetDevice`; on confirm, navigates to `DeviceTerminal` with `{deviceId, directory, initialCommand}` → `POST /api/terminal/sessions` creates the terminal.
  - **live** (`DeviceTerminalScreen`): an existing terminal; the confirmed command is injected into the live pty.
- commandGen is scoped to **one** device: the phone passes `deviceId`+`cwd`; the orchestrator proxies all 5 read-only tools (`list_dir`, `read_file`, `git_status`, `env_info`, `recent_commands`) to that single device. The AI never sees other devices.
- Terminal creation = `POST /api/terminal/sessions` (server) → `term_xxx` + `terminal.create` to agent.
- Device list available server-side: `listUserDevices(userId)` + `publicDevice()` (id, name, platform, online via `isAgentConnected`, `authorized_directories`, `remote_terminal_enabled`, host, …).

## Non-goals

- **Live mode is untouched** — the user is already on a device in a running terminal; re-targeting is out of scope.
- No HTTP request-body change to `POST /api/ai/command-gen` (`deviceId`/`cwd` remain as the **default target**; the AI overrides via tool). "请求体" in the request refers to the **LLM request body** (system prompt + tools + messages), which does change.
- No independent cwd/project picker in v1 (cwd follows the selected device's `authorized_directories[0]`, or the AI's choice for the default device). A project picker is a possible follow-up.
- Go agent is not modified (the existing path guard + `terminal.create` already do what's needed).

## Decisions (locked with user)

1. **Scope**: initial mode only.
2. **Mechanism**: two tools — `list_devices` (discover) + `select_device` (commit; switches the proxy target).
3. **Terminal creation**: phone creates on confirm (orchestrator returns the chosen target; no eager terminal creation → no dangling terminals).
4. **Modal picker**: collapsible device row in the confirm step — AI's pick pre-selected, user can tap to expand an inline radio list and override.

## Architecture & data flow

```
Phone (initial mode; pre-picked device = DEFAULT target)
  │  POST /api/ai/command-gen {text, deviceId(default), cwd(default), mode:'initial'}
  ▼
Orchestrator tool-loop   (targetDeviceId/targetCwd initialized to the default)
  │  AI may call:
  │    list_devices         → user's online + remote_terminal_enabled devices (local, no agent RPC)
  │    select_device(id,cwd)→ validates + sets targetDeviceId/targetCwd (local, no agent RPC)
  │    list_dir/read_file/git_status/env_info → routed to targetDeviceId, project_path=targetCwd
  │  AI returns the final command
  ▼
GenResult {command, dangerous, runId, deviceId, deviceName?, cwd}
  │  (deviceId/cwd = AI's choice, or the default if select_device was never called)
  ▼
Phone confirm step: device picker shows AI's choice pre-selected; user may override
  │  on confirm → navigate DeviceTerminal {deviceId(chosen), directory(cwd), initialCommand}
  ▼
existing POST /api/terminal/sessions creates the terminal on the chosen device
```

**Core mechanism**: `select_device` flips `targetDeviceId`/`targetCwd` in the orchestrator; every subsequent read-only tool RPC goes to that target instead of the original `input.deviceId`. Default = the phone's pre-pick, so a request that names no device behaves exactly as today.

## Server changes

### `commandGen/tools.ts` — two new tools

- **`list_devices`** (no args). Description: *"List the user's online devices you can run a command on. Each has id, name, platform/os, host, and authorized project directories. Call this before choosing a target."*
- **`select_device`** `{device_id: string, cwd?: string}`. Description: *"Select the device (and optionally a cwd from its authorized_directories) where the final command will run. Subsequent inspection tools run on this device. The selected device's platform overrides the initial OS — emit the final command in that platform's shell syntax. Call list_devices first if unsure."*

Both are appended to `COMMAND_GEN_TOOLS`.

### `commandGen/orchestrator.ts`

- Add mutable loop state: `let targetDeviceId = input.deviceId; let targetCwd = input.cwd;` (also `targetPlatform`/`targetName` for the result + OS override).
- `runTool`:
  - `list_devices` → served **locally** from `listUserDevices(input.userId)`, filtered to `isAgentConnected(d.id) && d.remoteTerminalEnabled`. Returns a compact JSON array: `[{id, name, platform, host, authorized_directories}]`. Empty array if none.
  - `select_device` → **local** validation: device exists, belongs to `input.userId`, `isAgentConnected`, `remoteTerminalEnabled`, and (if `cwd` given) `cwd` is under an authorized dir (reuse `authorizedRemoteExecutionPath` semantics). On success: set `targetDeviceId`/`targetCwd`/`targetPlatform`/`targetName`; return `{ok:true, device_id, name, platform, cwd}`. On failure: return an `error: …` string (AI retries or falls back). Last call wins.
  - `list_dir`/`read_file`/`git_status`/`env_info` → `requestAgentPayload(input.userId, targetDeviceId, …, {project_path: targetCwd, …})` (was `input.deviceId`/`input.cwd`).
  - `recent_commands` → unchanged (live-mode, session-bound; not reached in initial mode).
- **`GenResult`** += `deviceId: string`, `deviceName?: string`, `cwd: string` (the resolved target).
- OS override is handled in-prompt (see SKILL.md), not by re-rolling the system message: the `select_device` tool result carries `platform`, and the SKILL instructs the AI that this overrides `{os}`.
- Note: the dialect guard (`validateCommandDialect`) stays a **no-op in initial mode** — `input.shell` is `undefined` in initial mode (the route only sets `shell` for live sessions), so the guard short-circuits today and still does after a device switch. OS-correctness relies on the SKILL instruction; **do not** wire a synthetic shell.

### `commandGen/route.ts`

No change. `input.deviceId`/`input.cwd` remain the default target; `input.os` stays the initial prompt OS (overridden by `select_device` per the SKILL).

### SKILL.md (`skills/terminal-command-composer/SKILL.md`)

- Add `list_devices`, `select_device` to "Available read-only tools".
- New **"Target device selection"** section:
  - If the request names a machine/server/environment, call `list_devices` to see the user's online devices, then `select_device(device_id, cwd?)`.
  - After `select_device`, inspection tools run on that device and the final command must match **that device's platform** (may differ from `{os}`).
  - If no device is named, the default target is already set — just produce the command.
- Tweak "OS awareness": `select_device`'s platform overrides `{os}`.

## Phone changes (initial mode only; live untouched)

### `api/commandGen.ts`

Result type += `deviceId?: string`, `deviceName?: string`, `cwd?: string`.

### `VoiceToBashModal.tsx`

- New optional prop `selectableDevices?: DevicePickerEntry[]` where `DevicePickerEntry = {id, name, platform, online, cwd}` (online + enabled devices, mapped from the phone's synced device list). `online` maps from the phone device's synced `status === 'online'` (i.e. `agent_connected`), matching the server's `isAgentConnected`. Passed only by the initial-mode caller.
- Confirm step gains a **collapsible device selector** (only when `mode === 'initial'` and `selectableDevices` has ≥1 entry):
  - Collapsed: tappable row — online dot + selected device name + cwd + `▾`.
  - Expanded: inline radio list of `selectableDevices`; selecting one updates the selection and collapses the list. `<2 devices → row shown but not expandable (nothing to switch to)`.
  - Initial selection = the AI's `result.deviceId` (fallback: the first entry / the pre-picked default).
  - Changing the device resets cwd to that device's `authorized_directories[0]` (shown as info, not independently selectable in v1).
- `onConfirm` signature: `(command: string, deviceId?: string, cwd?: string) => void` — passes the (possibly user-overridden) target. The live-mode caller ignores the extras.

### `VibeCodingListScreen.tsx`

- Maps its online+enabled devices to `DevicePickerEntry[]`, passes as `selectableDevices`.
- `handleVoiceConfirm(command, deviceId, cwd)` → navigate `DeviceTerminal` with the AI's/user's `deviceId` + `cwd` (fallback to the pre-picked `voiceTargetDevice`).

### `DeviceTerminalScreen.tsx`

Unchanged (live mode; `onConfirm(command)` ignores the new optional args).

### Timeline

`list_devices`/`select_device` surface as normal step rows via the existing `StepRow` (the `select_device` result snippet shows the chosen device name). No extra UI work.

## Security

- `list_devices`/`select_device` are scoped to the requesting **user's own** devices (`input.userId`). Cannot see or select another user's device.
- `select_device` enforces online + `remote_terminal_enabled` + cwd-authorized. The agent-side project guard still applies within the chosen cwd.
- No secrets are newly exposed; `list_devices` returns no credentials.

## Error handling

- AI never calls `select_device` → target stays the default; fully backward-compatible.
- `list_devices` returns `[]` (no online devices) → AI emits a safe `echo` per the existing "unclear/unsafe → echo" policy.
- `select_device` with an invalid/offline/unauthorized target → error string → AI retries or falls back to default.
- User overrides device → command stays as generated (the user owns that choice; no auto-rewriting for a different OS in v1).

## Testing

**Server (vitest):**
- `tools.ts`: both tools present in `COMMAND_GEN_TOOLS`.
- `orchestrator.test.ts`:
  - `list_devices` returns the user's online+enabled devices (mock `listUserDevices`); offline/disabled excluded.
  - `select_device` with a valid device sets the target; a subsequent `list_dir` RPC is routed to the **new** `deviceId` with the new `project_path` (assert `requestAgentPayload` args).
  - `select_device` rejects offline / non-owned / unauthorized-cwd (returns error string; target unchanged).
  - `GenResult` carries `deviceId`+`cwd` (default when no `select_device`; chosen when called).
- `skillLoader.test.ts`: resolved SKILL.md mentions both tools.

**Phone (jest):**
- `VoiceToBashModal`: confirm step renders the device picker; AI's `deviceId` pre-selected; tapping a different device updates the selection; `onConfirm` receives the selected `deviceId`+`cwd`. Live mode renders no picker.
- `VibeCodingListScreen` (long-press test): `handleVoiceConfirm` navigates to the AI's/user's device.

## Out of scope / future

- Project/cwd picker within a device (v1 uses `authorized_directories[0]`).
- Live-mode re-targeting.
- Auto-rewriting the command when the user overrides to a different-OS device.
