# commandGen AI-Selected Device Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the initial (new-terminal) voice→bash flow, let the commandGen AI discover the user's online devices and choose the target device via two tools (`list_devices` + `select_device`); the phone shows an in-modal device picker (AI pre-selects, user can override) and creates the terminal on the chosen device on confirm.

**Architecture:** The orchestrator gains mutable `targetDeviceId`/`targetCwd` state (default = the phone's pre-pick). `list_devices`/`select_device` are served locally (no agent RPC); `select_device` validates + flips the target so subsequent read-only tools route to the chosen device. `GenResult` carries the resolved target. The phone modal's confirm step gains a collapsible device picker; `onConfirm` passes the chosen `deviceId`/`cwd`; terminal creation stays on-confirm via the existing `POST /api/terminal/sessions`.

**Tech Stack:** Node/Express + vitest (server, ESM/NodeNext — relative src imports MUST end in `.js`); React Native + jest (phone). Spec: `docs/superpowers/specs/2026-07-03-commandgen-device-selection-design.md`.

---

## File map

**Server** (`AliangPhoneServer/server/`):
- Modify `src/commandGen/tools.ts` — add 2 tool defs to `COMMAND_GEN_TOOLS`.
- Modify `src/commandGen/orchestrator.ts` — target state, `runTool` branching, `GenResult`.
- Modify `src/commandGen/types.ts` — (only if a step-result type needs it; likely no change).
- Modify `skills/terminal-command-composer/SKILL.md` — device-selection section + tool list.
- Modify `test/commandGen/orchestrator.test.ts` — new cases.

**Phone** (`AliangVibeCodingPhone/`):
- Modify `src/api/commandGen.ts` — result type.
- Create `src/components/terminal/DevicePicker.tsx` — collapsible device selector.
- Modify `src/components/terminal/VoiceToBashModal.tsx` — picker in confirm step + `onConfirm` signature + `selectableDevices` prop.
- Modify `src/screens/vibecoding/VibeCodingListScreen.tsx` — pass `selectableDevices`, use AI device in `handleVoiceConfirm`.
- Create `__tests__/DevicePicker.test.tsx` + extend `__tests__/VoiceToBashModal.test.tsx`.

---

## Phase 1 — Server

### Task S1: Add `list_devices` + `select_device` tool definitions

**Files:** Modify `src/commandGen/tools.ts`.

- [ ] **Step 1: append the two tool defs to `COMMAND_GEN_TOOLS`** (after `recent_commands`):

```ts
  { type: 'function', function: { name: 'list_devices', description: 'List the user\'s ONLINE devices you can run a command on. Each has id, name, platform/os, host, and authorized project directories. Call this before choosing a target device.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'select_device', description: 'Select the device (and optionally a cwd from its authorized_directories) where the final command will run. Subsequent inspection tools (list_dir/read_file/git_status/env_info) then run on that device, and the final command must match THAT device\'s platform (it may differ from the initial OS). Call list_devices first if unsure which device.', parameters: { type: 'object', properties: { device_id: { type: 'string' }, cwd: { type: 'string', description: 'Optional working directory; must be under an authorized_directory of the device. Defaults to the first authorized directory.' } }, required: ['device_id'] } } },
```

- [ ] **Step 2: verify** — `npx tsc --noEmit` (server, from `AliangPhoneServer/server`). Exit 0.

- [ ] **Step 3: commit** — `feat(commandGen): add list_devices + select_device tool defs`.

### Task S2: Orchestrator target state + tool routing + GenResult

**Files:** Modify `src/commandGen/orchestrator.ts`. Reuses `listUserDevices` (`modules/user/stats.ts`), `isAgentConnected` (`shared/ws/registry.ts`), `authorizedRemoteExecutionPath` (`modules/project/authorization.ts`).

- [ ] **Step 1: write failing tests** in `test/commandGen/orchestrator.test.ts`:
  - `list_devices` returns the user's online+`remoteTerminalEnabled` devices (mock `listUserDevices` + `isAgentConnected`); offline/disabled excluded; shape `{id,name,platform,host,authorized_directories}`.
  - `select_device` with a valid online device sets the target; the NEXT `list_dir` RPC is routed to the new `deviceId` with `project_path` = chosen cwd (assert `requestAgentPayload` called with the new id + new cwd).
  - `select_device` rejects an offline / non-owned device id (returns an `error:` string; a following `list_dir` still routes to the default device).
  - `GenResult` carries `deviceId` + `cwd` = the default when `select_device` was never called, and the chosen target when it was.

  Mocks needed: `listUserDevices` (mock `../../src/modules/user/stats`), `isAgentConnected` (mock `../../src/shared/ws/registry`), `authorizedRemoteExecutionPath` (mock `../../src/modules/project/authorization.js`) — alongside the existing `callLlm`/`requestAgentPayload`/`publishToMobiles` mocks. For the routing assertion, drive two tool-call rounds: round 1 `select_device` → round 2 `list_dir`, then final.

- [ ] **Step 2: run tests → FAIL** (`npx vitest run test/commandGen/orchestrator.test.ts`).

- [ ] **Step 3: implement.**
  - New imports: `listUserDevices` from `../modules/user/stats.js`, `isAgentConnected` from `../shared/ws/registry.js`, `authorizedRemoteExecutionPath` from `../modules/project/authorization.js`.
  - Extend `GenResult`: `export type GenResult = { command: string; dangerous: boolean; runId: string; deviceId: string; deviceName?: string; cwd: string };`
  - In `generateCommand`, after `const target = {...}`: add mutable target state:
    ```ts
    let targetDeviceId = input.deviceId;
    let targetCwd = input.cwd;
    let targetName: string | undefined;
    let targetPlatform: string | undefined;
    ```
  - In `runTool` (make it close over the target state — convert to an inner function or pass a mutable holder), add cases BEFORE the `switch (name)` proxy cases:
    - `case 'list_devices':` → serve locally:
      ```ts
      const list = listUserDevices(input.userId)
        .filter(d => isAgentConnected(d.id) && d.remoteTerminalEnabled)
        .map(d => ({ id: d.id, name: d.name, platform: d.platform, host: d.host ?? null, authorized_directories: d.authorizedDirectories ?? [] }));
      return JSON.stringify({ devices: list });
      ```
    - `case 'select_device':` → validate locally:
      ```ts
      const did = String(args.device_id ?? '').trim();
      const dev = listUserDevices(input.userId).find(d => d.id === did);
      if (!dev) return 'error: device_not_found';
      if (!isAgentConnected(dev.id)) return 'error: device_offline';
      if (!dev.remoteTerminalEnabled) return 'error: remote_terminal_disabled';
      try {
        const cwd = authorizedRemoteExecutionPath(dev, args.cwd ? String(args.cwd) : undefined);
        targetDeviceId = dev.id; targetCwd = cwd; targetName = dev.name; targetPlatform = dev.platform;
        return JSON.stringify({ ok: true, device_id: dev.id, name: dev.name, platform: dev.platform, cwd });
      } catch {
        return 'error: cwd_not_authorized';
      }
      ```
    - In the existing `list_dir`/`read_file`/`git_status`/`env_info` cases, replace `input.userId`→keep, `input.deviceId`→`targetDeviceId`, `input.cwd`→`targetCwd` (the `project_path`/`cwd` fields).
  - At both `return { command, dangerous, runId }` sites (converged + non-converged), add `deviceId: targetDeviceId, deviceName: targetName, cwd: targetCwd`.

  **Note on closure:** `runTool` is currently a module-level function taking `input`. To mutate target state it must close over it — either move it INSIDE `generateCommand` (preferred — it already only uses `input`), or pass a `{targetDeviceId, targetCwd, ...}` holder object by reference. Moving it inside is cleanest; keep `stringify` module-level.

- [ ] **Step 4: run tests → PASS.** Then `npx tsc --noEmit` (server) exit 0; `npx vitest run test/commandGen` green.

- [ ] **Step 5: commit** — `feat(commandGen): orchestrator picks target device via list_devices/select_device`.

### Task S3: SKILL.md — device selection section

**Files:** Modify `skills/terminal-command-composer/SKILL.md`.

- [ ] **Step 1:** In "Available read-only tools", append `list_devices, select_device` (and note they are served locally, not from the device).
- [ ] **Step 2:** Add a new section after "Decision policy":
  ```markdown
  ## Target device selection (initial mode)
  - The default target device is already set (the one the terminal was opened from).
  - If the request names a specific machine / server / environment, call `list_devices` to see
    the user's online devices, then `select_device(device_id, cwd?)` to commit the target.
  - After `select_device`, `list_dir` / `read_file` / `git_status` / `env_info` run on THAT device,
    and your final command MUST match THAT device's platform — it may differ from {os}.
    `select_device` returns the chosen `platform`; honor it.
  - If the request names no device, do not call these tools — just produce the command.
  ```
- [ ] **Step 3:** In "OS awareness", append: "If you called `select_device`, its returned `platform` overrides `{os}` and `{shell}` for the final command."
- [ ] **Step 4:** `npx vitest run test/commandGen/skillLoader.test.ts` green (assert the resolved template mentions both tools). Commit — `feat(commandGen): SKILL device-selection guidance`.

### Task S4: Server verify + integration sanity

- [ ] `npx tsc --noEmit` exit 0; `npx vitest run` (server) green vs baseline. Commit any fixups.

---

## Phase 2 — Phone

### Task P1: `api/commandGen.ts` result type

**Files:** Modify `src/api/commandGen.ts`.

- [ ] **Step 1:** extend `CommandGenResult`:
  ```ts
  export interface CommandGenResult {
    command: string;
    dangerous: boolean;
    runId: string;
    deviceId?: string;
    deviceName?: string;
    cwd?: string;
  }
  ```
- [ ] **Step 2:** `npx tsc --noEmit` exit 0. Commit — `feat(commandGen): result carries chosen device`.

### Task P2: `DevicePicker` component

**Files:** Create `src/components/terminal/DevicePicker.tsx`.

- [ ] **Step 1:** write `__tests__/DevicePicker.test.tsx`:
  - renders collapsed row with the selected device's name + online dot + cwd;
  - tapping the row expands the radio list of all entries;
  - tapping an entry calls `onSelect(id)` and collapses;
  - `<2 entries` → row not expandable (onPress no-op / disabled).
- [ ] **Step 2:** implement. Props:
  ```ts
  export type DevicePickerEntry = { id: string; name: string; platform?: string; online: boolean; cwd: string };
  export interface DevicePickerProps {
    entries: DevicePickerEntry[];
    selectedId: string | undefined;
    onSelect: (entry: DevicePickerEntry) => void;
  }
  ```
  Collapsible: `const [open, setOpen] = useState(false)`. Collapsed = one `Pressable` row (online dot + name + cwd + `▾`, disabled when `entries.length < 2`). Expanded = map entries to radio rows (`●`/`○`), each `Pressable` → `onSelect(entry)` then `setOpen(false)`. Use `useTheme()` + `theme.typography`/`colors` like `VoiceToBashModal`.
- [ ] **Step 3:** tests green; `npx tsc --noEmit` exit 0. Commit — `feat(terminal): DevicePicker collapsible selector`.

### Task P3: VoiceToBashModal — picker in confirm step + `onConfirm` signature

**Files:** Modify `src/components/terminal/VoiceToBashModal.tsx`.

- [ ] **Step 1:** import `DevicePicker` + `DevicePickerEntry`. Add prop `selectableDevices?: DevicePickerEntry[]`. Widen `onConfirm: (command: string, deviceId?: string, cwd?: string) => void`.
- [ ] **Step 2:** track the AI/user-chosen target: after the POST resolves, store `result.deviceId`/`result.deviceName`/`result.cwd` in state (e.g. `const [chosenDeviceId, setChosenDeviceId] = useState<string|undefined>()` + `chosenCwd`). Set them in the `.then` alongside `setCommand`.
- [ ] **Step 3:** in the `confirming` phase JSX, between the command `TextInput` and the footer, render the picker (only when `mode === 'initial' && selectableDevices && selectableDevices.length >= 1`):
  ```tsx
  {mode === 'initial' && selectableDevices && selectableDevices.length >= 1 && (
    <View>
      <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>运行于</Text>
      <DevicePicker
        entries={selectableDevices}
        selectedId={chosenDeviceId ?? selectableDevices[0]?.id}
        onSelect={(e) => { setChosenDeviceId(e.id); setChosenCwd(e.cwd); }}
      />
    </View>
  )}
  ```
  Also surface a one-line "将在 {deviceName} 上运行" hint if the AI returned a `deviceName`.
- [ ] **Step 4:** `handleConfirmPress` passes the target: `onConfirm(finalCommand, chosenDeviceId, chosenCwd)`.
- [ ] **Step 5:** reset chosen device/cwd in `resetToRecording`.
- [ ] **Step 6:** extend `__tests__/VoiceToBashModal.test.tsx` — in `mode='initial'` with `selectableDevices` provided, after the POST resolves the confirm step renders the picker with the AI's `deviceId` pre-selected; tapping another entry then confirm calls `onConfirm` with that entry's id+cwd. Existing live-mode tests stay green (no `selectableDevices` → no picker; `onConfirm(command)` still works).
- [ ] **Step 7:** tests green; `npx tsc --noEmit` exit 0. Commit — `feat(voice-bash): device picker in confirm step`.

### Task P4: VibeCodingListScreen wires the picker + AI target

**Files:** Modify `src/screens/vibecoding/VibeCodingListScreen.tsx`.

- [ ] **Step 1:** map `terminalDeviceChoices` (already online+enabled-filtered) to `DevicePickerEntry[]` (`{id, name, platform, online: true, cwd: authorizedDirectories?.[0] ?? '~'}`), memoized.
- [ ] **Step 2:** pass `selectableDevices={...}` to `<VoiceToBashModal>`.
- [ ] **Step 3:** widen `handleVoiceConfirm(command, deviceId?, cwd?)`: navigate `DeviceTerminal` with `deviceId ?? targetDevice.id` and `directory: cwd ?? targetDevice.authorizedDirectories?.[0] ?? '~'` + `initialCommand: command`.
- [ ] **Step 4:** `npx tsc --noEmit` exit 0; `npx jest VibeCodingListScreen` green vs baseline. Commit — `feat(voice-bash): initial mode uses AI-chosen device`.

### Task P5: Phone verify

- [ ] `npx tsc --noEmit` exit 0; `npx jest` green vs baseline (3 known terminal flakes). Commit fixups if any.

---

## Sequencing & commits

Phase 1 (server) ships first — it's independently testable and the phone changes are inert until the server returns `deviceId`. Each task = its own commit. After S4 + P5, both repos are done (uncommitted→committed per task; deploy/rebuild is the user's separate step).
