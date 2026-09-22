# 语音设备固定（Voice Device Pin）设计

- 日期：2026-09-22
- 状态：已与用户对齐（四决策：App 会话内生命周期 / 强制锁定忽略 AI 换设备 / 面板高亮+FAB 角标 / tap 仍弹面板）
- 涉及仓库：仅 `AliangVibeCodingPhone`；server/agent **零改动**

## 1. 现状（精确事实）

`VibeCodingListScreen` 终端 tab 的 NEW TERM 胶囊（+ FAB）：
- **长按 ≥900ms**（`handleNewTermPressIn` → `NEW_TERM_HOLD_MS`）→ `openVoiceModal(newTerminalDevice)` 打开 `VoiceToBashModal`（initial 模式）。`newTerminalDevice = terminalDeviceChoices[0]`——**目标设备是"第一个在线设备"，即用户所说的"不确定"**。
- **短按** → 切换 `terminalDevicePickerOpen`：ONLINE TARGETS 设备面板；**tap 设备行** → `handleCreateTerminal(device)`（新建终端并跳转）。
- `VoiceToBashModal`（initial 模式）confirm 步渲染 `DevicePicker`（`selectableDevices` = 在线+终端可用）；AI 可经 server `select_device` 工具换设备（结果 `deviceId/cwd` 回传），用户也可在 picker 改选；`onConfirm(finalCommand, chosenDeviceId, chosenCwd)` → screen 导航到新终端注入命令。

## 2. 目标交互

设备面板里**长按某设备行** = 把该设备**固定（pin）进会话上下文**并立即进入语音识别；此后的语音→命令生成→执行都强制落在 pinned 设备上，直到解除/换绑。

## 3. 已确认决策

1. **生命周期**：App 会话内（内存态，杀 App 即失效；不持久化）。
2. **强制锁定**：pin 后忽略 AI `select_device` 的换设备，confirm 界面设备锁死为 pinned（零 server 改动）。
3. **展示/解除**：面板内 pinned 行高亮 + 图钉标；+ FAB 上角标显示 pinned 设备名；解除 = 点 pinned 行的图钉；换绑 = 长按另一台设备。
4. **tap + 行为不变**：仍弹设备面板（pinned 行高亮）——保留换绑/解除入口。

## 4. 设计

### 4.1 `devicePinStore`（新文件 `src/store/devicePinStore.ts`）
独立 zustand 内存 store（不进 controlCenterStore）：
```ts
interface DevicePinState {
  pinned: { id: string; name: string } | null;
  pin(device: { id: string; name: string }): void;
  unpin(): void;
}
```
只存 `id + name` 快照；在线态等实时信息由消费方从既有 `terminalDeviceChoices` 派生，不进 store。

### 4.2 `VibeCodingListScreen`
- **面板设备行**（`Pressable testID="new-term-device-{id}"`）新增 `onLongPress`：`pin(device)` → 关面板 → `openVoiceModal(device)`。RN `onLongPress` 触发后 `onPress` 不再触发，tap 建终端语义不受影响。
- **pinned 行渲染**：该行边框高亮（primary 实色）+ 行尾图钉内联 SVG（`testID="new-term-device-pin-{id}"`，点击 = `unpin()`，需 `stopPropagation` 语义——放在行内独立 Touchable）；面板 subhead 提示文案在 pinned 时切换为「Voice locked to {name}」。
- **FAB 角标**：pinned 时 FAB 上显示小型 chip（图钉 + 设备名，`numberOfLines={1}` 截断；`testID="new-term-fab-pin-badge"`）。
- **FAB 长按目标**：`openVoiceModal(pinnedDevice ?? newTerminalDevice)`；`pinnedDevice` = store.pinned 且仍存在于 `terminalDeviceChoices`（否则视为 null）。
- **自动清 pin**：screen effect——`pinned` 存在但 id 不在 `terminalDeviceChoices`（离线/解绑）→ `unpin()`（行为退化为默认 choices[0]，无额外 toast；modal 打开中掉线由 modal 既有错误态兜底）。
- `handleVoiceConfirm` 无需改：modal 锁定时回传的就是 pinned 设备 id/cwd。

### 4.3 `VoiceToBashModal`
- 新 prop `lockedDevice?: DevicePickerEntry`。**打开 modal 时的一次性快照**（screen 传入当时值，modal 内不随 store 后续变化）——生成中途 pinned 设备掉线/自动 unpin 不会把锁定翻转为解锁，中途掉线由既有错误态兜底（§5）。
- confirm 步：`lockedDevice` 存在 → **不渲染 DevicePicker**，渲染锁定 chip（图钉 SVG + 设备名 + platform，`testID="v2b-locked-device"`，旁注「已锁定」文案）。
- 生成完成后的设备裁决：`lockedDevice` 存在 → `chosenDeviceId/chosenCwd` 强制取 `lockedDevice.id/cwd`，**忽略 result.deviceId/deviceName/cwd（即 AI select_device 的换设备被丢弃）**。
- `onConfirm` 调用不变（回传的就是锁定值）。

### 4.4 i18n（`vibecoding` namespace，en+zh）
`devicePin.locked`（Locked/已锁定）、`devicePin.panelHint`（Voice locked to {{name}} / 语音已锁定到 {{name}}）、`devicePin.pinHint`（Long-press a device to lock voice to it / 长按设备可将语音固定到该设备）——面板 subhead 未 pinned 时的引导替换现有英文写死的 "Pick a live machine for the new shell"（顺带 i18n 化，保持向后兼容文案 en 不变）。
⚠ 命名空间接线：`devicePin.locked` 渲染在 `VoiceToBashModal` 内，而该 modal 用的是 `useTranslation('terminal')`——modal 侧必须显式跨命名空间 `t('vibecoding:devicePin.locked')`（或该处挂第二个 hook），否则原样吐 key。

### 4.5 布局与动效
- FAB 角标不改变 FAB 本体尺寸（绝对定位于胶囊上缘），复用 `useReduceMotion` 无动画约定（纯静态 chip）。
- 面板行高亮为纯样式，无新增动画。

## 5. 错误与边界

| 场景 | 行为 |
|---|---|
| pinned 设备离线/解绑 | effect 自动 `unpin()`，FAB 角标消失，语音回退 choices[0] |
| modal 打开中设备掉线 | 既有 commandGen 错误态兜底（错误条+重试） |
| 长按面板行 | 行必在线（面板只列在线目标），无需额外检查 |
| App 被杀 | pin 自然消失（内存态） |
| 终端内语音 FAB（DeviceTerminalScreen） | 不受 pin 影响（绑定当前终端设备） |

## 6. 测试计划（TDD）

- `devicePinStore` 单测：pin/unpin/换绑（覆盖旧 pin）。
- `VibeCodingListScreen` 面板交互：长按行 → pin + 面板关 + voice modal 开（mock hook/断言既有 voiceModal 态）；pinned 行高亮与图钉存在；点图钉 → unpin；tap 行为不变（仍建终端）；tap + 仍弹面板；FAB 角标出现/消失；pinned 设备从 choices 消失 → 自动 unpin + 角标消失。
- `VoiceToBashModal`：`lockedDevice` 时 confirm 步无 DevicePicker、有锁定 chip；AI 结果换设备被忽略（mock generateCommand 返回不同 deviceId，onConfirm 收到 lockedDevice.id/cwd）；无 `lockedDevice` 时行为与现状完全一致（回归）。⚠ 仓库坑：不要用 `jest.requireActual('react-native')` 去 mock Modal（DevMenu TurboModule 会崩）；本仓 jest preset 已让可见 Modal 渲染 children，直接断言即可。
- i18n：新键 en/zh 齐平。

## 7. 部署

纯 phone 侧：合并 main 后 rebuild APK；server/agent 零改动。
