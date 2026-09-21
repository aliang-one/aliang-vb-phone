# 终端底部 AI 建议命令行（语音直通 + 常驻悬浮钮 + 键盘开关）设计

- 日期：2026-09-21
- 状态：已与用户对齐（三决策：直通生成 / 1-3 条建议 / 旧推荐完全移除；方案 A + JSON 契约）
- 涉及仓库：`AliangVibeCodingPhone`（主要）、`AliangPhoneServer`（契约扩展）；Go agent **零改动**
- 前置事实：语音→命令链路已端到端存在——`VoiceToBashModal`（live 模式）→ `POST /api/ai/command-gen` → server LLM 工具循环（内嵌 `list_dir / read_file / git_status / env_info / recent_commands / select_device`）→ 单条命令 + `dangerous` 标记。

## 1. 目标与非目标

**目标**
1. 终端底部改为「AI 建议命令行」：右侧**常驻悬浮**语音钮（不随横滚消失），点按=录音→STT→直通生成→建议命令以 chips 落入建议行，用户点选执行；**长按**=弹出可编辑文本输入（同一生成链路）。
2. server 一次请求返回 **1~3 条**建议命令（JSON 契约 + 解析回退），响应向后兼容。
3. 旧推荐（历史命令 + 静态兜底，`buildTerminalSuggestions`）**完全移除**；无建议时显示空态提示文案。
4. 底部 "KB" 文字钮 → 键盘 SVG 图标，**点按切换**键盘（开→收起，关→唤起）。

**非目标**
- 不改 NEW TERM 长按入口的 `VoiceToBashModal`（initial 模式，带设备选择）——保持原样。
- 不改 agent、不改 STT 服务端、不改 commandGen 的鉴权/限流/工具集。
- 建议命令不做跨屏持久化（chips 生命周期 = 屏幕挂载期；导航离开即清空，空态提示兜底）。
- 不做建议 chips 的长按编辑（YAGNI；编辑入口 = 重新长按语音钮输入文字再生成）。

## 2. Server 契约扩展（AliangPhoneServer）

### 2.1 SKILL.md 输出契约
`server/skills/terminal-command-composer/SKILL.md` 的 *Output contract* 节改为：

- 只返回一个 JSON 对象：`{"commands": ["<cmd1>", "<cmd2>", "<cmd3>"]}`。
- 1~3 条、最相关在前；每条单行裸 shell（无围栏/标签/注释/解释）。
- 多条 = 同一请求下的合理候选（首选 + 备选），不是串联脚本；需要串联时仍用 `&&` 写在一条里。
- 不确定/不安全时返回单条 `echo`（沿既有安全规则）。
- 其余章节（工具、OS 方言、安全规则、终止策略）不动。

### 2.2 解析与回退（`orchestrator.ts`）
新增导出纯函数 `parseFinalCommands(text: string): string[]`：
1. trim；剥一层 ``` / ```json 围栏（若整体被围）；
2. `JSON.parse` 成功且为对象、`commands` 是字符串数组 → 每条 trim、丢弃空串、**上限 3 条**；
3. **任何失败（非 JSON / 缺字段 / 空数组 / 全空串）→ 回退：整段 trim 后文本作为单条命令**（老模型/异常输出不炸）。

final 分支：`commands = parseFinalCommands(res.text)`，逐条 `applyDialectGuard` + `isDangerousCommand`。不收敛兜底分支同样走 `parseFinalCommands`（保证恒 ≥1 条）。

### 2.3 响应与事件（纯加法，向后兼容）
```
GenResult = {
  command: string          // = commands[0]（保留字段，现有 modal initial 模式零改动）
  commands: string[]       // 1~3 条
  dangerous: boolean       // 聚合 = 任一条危险
  dangerousFlags: boolean[]// 与 commands 等长逐条标记
  runId, deviceId, deviceName, cwd   // 原样
}
```
- DB `final_command` 列存 `commands[0]`——**无 schema 迁移**；steps 的 final snippet 仍存原始终文。
- `commandGen.runFinished` 事件附带 `commands` / `dangerousFlags`（旧消费端只读 `finalCommand`，不受影响）。

## 3. 手机端——`useAiCommandSuggestions` hook（新文件）

逻辑核心独立成 hook（不渲染、可 renderHook 直测）。文件：`src/hooks/useAiCommandSuggestions.ts`。

**状态**：`phase: 'idle' | 'recording' | 'generating' | 'error'`；`chips: Array<{ command: string; dangerous: boolean }>`；`liveStatus: string`（生成中最近一步 tool 名）；`errorText: string`；透传 `useVoiceStt` 的 `liveCaption`。

**行为**：
- `startVoice()`：先 `Keyboard.dismiss()` → `voiceStt.start({ onComplete })`；`phase=recording`。`phase=error` 时点按同样进入 `startVoice()`（重试）。
- `stopVoice()`：`voiceStt.stop()` → onComplete 触发 `generate(text)`（**直通，无转写确认步**——编辑职责由长按文本路径承担）。
- `submitText(text)`：非空 trim 后直接 `generate(text)`。
- `retry()`：hook 内记住 `lastText`（成功后保留——retry 仅在错误态可达，保留无副作用），错误态重发同文本。
- `generate(text)`：**先订阅 `commandGenEvents`（runId 捕获过滤，同 modal 模式）再 POST** `/api/ai/command-gen`（`mode:'live'` + sessionId/projectId）；期间 step 事件驱动 `liveStatus`。成功→响应 `commands × dangerousFlags` 与本地 `isUnsafeSuggestion` 兜底**取或**→新批 chips 置顶（精确去重、总量上限 6、`phase=idle`）。失败→`commandGenErrorText` 映射（`llm_*` 码）→`phase='error'`。
- `clearChips()`、`dismissError()`；**换 `terminalId`**（屏内 `setTerminalId` 可不卸载切会话，`DeviceTerminalScreen.tsx:485-498`）与卸载时：cancel STT + 退订事件 + **清空 chips / phase 复位 idle / 清 lastText**（防 A 终端的建议被执行进 B 终端）——对齐 modal 的 cleanup 纪律。

**错误文案模块**：`commandGenErrorText` + `COMMAND_GEN_ERROR_KEYS` 从 `VoiceToBashModal.tsx` 移到独立小模块（`src/utils/commandGenErrorText.ts`——util 层而非组件层，hook 与组件都能干净引用），modal 改为 import + re-export（既有 import 路径与 modal 测试不受影响）。

## 4. 手机端——底部控制区重构（`DeviceTerminalScreen.tsx`）

```
┌──────────────────────────────────────────────┬────┐
│ 建议行(横滚): [chip][chip]… 或空态提示 chip      │ 🎤 │ ← 常驻悬浮钮（绝对定位右缘）
│ 快捷键行(横滚): [⌨][TAB|CTRL 组…]              │    │   两行 ScrollView 预留右侧 padding
└──────────────────────────────────────────────┴────┘
```

**建议行**
- 删除 `buildTerminalSuggestions` 及静态兜底/`looksLike*` 助手；`terminalSuggestions.ts` 仅保留 `isUnsafeSuggestion` / `DANGEROUS_COMMANDS` 等安全谓词（modal 仍用）。
- 空态（`chips` 空且 `phase=idle`）：单条不可点提示 chip（i18n，如「点右侧麦克风说出命令，长按可输入文字」）。
- chip 内容：单行 `numberOfLines={1}`；危险 chip 红色边框。
- **执行**：安全 chip 点按 → `sendToTerminal(`${command}\r`, { focus:false, keepKeyboardProxyFocused:true })` + 复用 `setVoiceCommandBanner`。危险 chip **两段式**：首点进入「武装态」（红底 + 「再点确认」文案，3s 超时自动复位），二点才执行——对齐 modal 的危险二次确认语义，不引入新弹窗。

**悬浮语音钮**（沿用 testID `terminal-voice-fab`）
- 内联 SVG `MicIcon`（同屏内 `TopPanelToggleIcon` 风格）；`!terminalInputEnabled` 时禁用。
- 点按：`idle→startVoice()`；`recording→stopVoice()`；`generating` 忽略；`error→startVoice()`（重试）。
- `recording` 态：红色调 + 脉冲动画（`Animated.loop`，尊重 `useReduceMotion` 既有约定）；字幕条（建议行上方/替代空态位）显示 `liveCaption`。
- `generating` 态：spinner 图标；字幕条位置显示 `liveStatus`。
- **长按**：`idle` 态 → 字幕条位置变为**可编辑 TextInput + 发送 / 取消**（发送=`submitText`）——即「输入支持编辑」路径。recording/generating 中长按无效。

**键盘开关钮**（替换 "KB" 文字钮，隐藏 proxy TextInput 原地保留）
- 内联 SVG `KeyboardIcon`；无障碍标签 i18n。
- `open = keyboardInset > 0 || keyboardProxyFocused`；open → `keyboardProxyRef.blur()` + `Keyboard.dismiss()`；closed → `focusKeyboardProxyInput()`。
- 键盘收起链路复用既有 `keyboardWillHide/DidHide → clearKeyboardInset`（顺带 `setKeyboardProxyFocused(false)`），顶栏展开/浮动条回位逻辑零改。

**i18n**：新键放 `terminal` namespace（en+zh）——屏上已有第二个 `useTranslation('terminal')` 惯例（`tReplay`，`DeviceTerminalScreen.tsx:192`），照此挂；键含：空态提示、录音中、生成中、危险确认、文本输入占位/发送/取消、键盘开关 a11y、错误前缀等。旧键清理：语音 chip 用的 `terminal.voice` 实际在 **`devices` namespace**（`devices:terminal.voice`，全仓仅被待删的 chip 引用一次），删 chip 时一并删键。

## 5. 错误处理

| 场景 | 行为 |
|---|---|
| STT 失败/断连 | `phase='error'`，字幕条显错误 + 点钮重试；已有转写文本则照 `useVoiceStt` 既有语义交付 |
| commandGen 失败（`llm_*` 码） | 错误条显 `commandGenErrorText` 映射文案，可重试（重发同文本） |
| server 不收敛 | 兜底分支保证 ≥1 条（echo），chips 至少一条 |
| 解析异常终文 | `parseFinalCommands` 回退单条 |
| 录音中退后台/卸载 | 复用 `useVoiceStt` 既有清理 + hook unmount cancel |
| 键盘开着点语音 | `startVoice` 先 `Keyboard.dismiss()`，避免双输入面 |
| 生成中再点钮 | 忽略（幂等） |

## 6. 测试计划（TDD）

**Server（vitest）**
- `parseFinalCommands`：合法数组（1/2/3 条）、>3 截断、围栏包裹、非 JSON 回退、缺 `commands` 回退、空数组/全空串回退、逐条 trim、非字符串项丢弃。
- orchestrator：`GenResult.commands/dangerousFlags` 映射、聚合 `dangerous`、dialect guard 逐条生效、`command` = 首条。
- route/集成（如有既有测试）：响应含 `commands`；旧字段不变。

**Phone（jest）**
- hook `useAiCommandSuggestions`：成功落 chips（mock api）、置顶+去重+上限 6、danger 取或、`llm_*` 错误映射、`startVoice` 先 dismiss 键盘、卸载 cancel、generating 中幂等忽略、`retry()` 重发 lastText、**换 terminalId 清空 chips/复位**。
- 建议行（抽表现组件便于测试）：空态提示、安全 chip 单点执行、危险 chip 两段式 + 3s 复位、执行时 banner 更新。
- 悬浮钮：idle 点按开始、recording 点按停止、长按出文本输入、发送走 `submitText`、禁用态。
- 键盘钮：开→dismiss+blur；关→focus proxy。
- `terminalSuggestions` util 测试更新（删除 `buildTerminalSuggestions` 断言，保留 `isUnsafeSuggestion`）。
- 回归：`VoiceToBashModal` 既有测试全绿；全量 jest 对照当前基线（已知 ~3 个 terminal 基线 flake）；`tsc` 0 错。

## 7. 部署链

server 重启生效（契约+解析）；手机 rebuild 生效；**agent 零改动**。上线顺序无硬依赖（响应字段纯加法，旧手机 + 新 server 兼容）。
