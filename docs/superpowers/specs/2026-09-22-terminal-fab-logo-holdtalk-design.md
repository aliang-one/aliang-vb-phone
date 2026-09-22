# 终端 AI 悬浮钮——logo 化 + 「短按打字 / 长按说话(松开结束)」手势反转设计

- 日期：2026-09-22
- 状态：已与用户对齐（两决策：logo 任何状态恒定不换图标；提示词不再出现「麦克风」字样）
- 涉及仓库：仅 `AliangVibeCodingPhone`；server 与 Go agent **零改动**
- 前置：`2026-09-21-terminal-ai-suggest-bar-design.md`（常驻语音钮 + AI 建议链路）已合并 main（13a43d7 可见）。本设计在其基础上**反转手势语义并替换图标**，AI 建议数据链路（STT→commandGen→chips）不动。

## 1. 目标与非目标

**目标**
1. 终端底栏右侧 AI 悬浮钮（`TerminalVoiceFab`）图标由麦克风 SVG 换成 **aliang logo**（复用 `src/components/visual/Logo.tsx`，主题色渐变「A」标）；**任何状态（空闲/录音/生成/错误）图标恒为 logo，不切换**。
2. 手势反转：
   - **短按**（按下到松开 < 450ms）→ 打开文字输入（即原长按行为，`openTextInput()`，上方出现可编辑文本条）；
   - **长按并保持**（≥ 450ms）→ 开始 STT 录音（`startVoice()`）；**松开** → 结束录音（`stopVoice()`），沿既有链路出建议命令（即 hold-to-talk，与重命名弹窗 `VoiceTextInput` 同范式）。
3. 提示词去「麦克风」：`terminal:aiSuggest.emptyHint` 中英双语文案改写，不再出现「麦克风 / mic」字样；测试加守卫断言。

**非目标**
- 不改 `useAiCommandSuggestions` hook 的对外 API 与状态机（`startVoice/stopVoice/openTextInput` 现成够用）。
- 不改录音态/错误态的红色视觉语言、脉冲动画、顶部 `TerminalAiStatusStrip` 的展示逻辑。
- 不改 `VoiceToBashModal`（NEW TERM 长按入口）。
- 不改 STT、commandGen、chips 执行链路。

## 2. 交互状态机（`TerminalVoiceFab` 手势）

现实现是 `TouchableOpacity` 的 `onPress`/`onLongPress`——`onLongPress` 语义里**拿不到「松开」事件**，无法表达 release-to-stop。故换 **`Pressable` + 按压计时器**（与 `VoiceTextInput` 的 `onPressIn/onPressOut` 同范式）：

```
pressIn  ──→ 启动 450ms 计时器（长按阈值，常量 + 可注入便于测试）
             │
             ├─ ≥450ms 仍未松开 → 计时器到点：onHoldStart()（screen → startVoice()，进入 recording）
             │                     （此后仍按住，录音持续；live caption 在顶部状态条流式显示）
             │
pressOut ──→ 清除计时器
             ├─ 计时器已到点且 phase === 'recording' → onHoldEnd()（screen → stopVoice()，松开结束）
             └─ 计时器未到点（短按）→ onShortPress()（screen → openTextInput()）
```

**边界与防挂死**
- 手指滑出按钮 / responder 被系统抢占（滚动、来电等）→ `Pressable` 同样触发 `pressOut` → 录音中则停止。与 `VoiceTextInput` 的守卫一致：`pressActiveRef` 保证 pressOut 无配对 pressIn 时是 no-op。
- 按压中组件卸载（切终端/离开屏幕）→ cleanup 清计时器；录音由 hook 既有的 unmount cancel 兜底。
- `disabled`（`!terminalInputEnabled`）语义不变：pressIn 直接忽略。
- 录音中再次按压：`phase === 'recording'` 时 pressIn 不再重复 `startVoice`（hook 自带守卫，screen 侧同样短路）。
- `generating` 期间按住：hook `startVoice` 自带 `generating` 守卫，不会叠录音。

**阈值**：450ms 常量 `HOLD_THRESHOLD_MS`，以 prop `holdThresholdMs` 注入（默认 450），测试传 0/小值验证两条分支。

## 3. 视觉

- 图标：`Logo`（`size ≈ 24`；logo 原始比例 269:245，FAB 54×54 内水平垂直居中）。主题色随 `useTheme` 自动适配深浅色。
- 空闲/短按：现有 elevatedSurface + outline 描边不变。
- 录音态：**保留**现有红边红底 + 红色脉冲叠层动画（`pulse`）；logo 本身不变色。
- 生成态：logo 恒定，**右下角叠 12px 小号 `ActivityIndicator`**（原实现是 spinner 整体替换图标，改此法后按钮级「进行中」反馈保留）；`accessibilityState.busy` 不变。
- 错误态：红边不变（原样）。

## 4. 文案（去「麦克风」）

`src/i18n/locales/terminal/{zh,en}.json` 的 `aiSuggest.emptyHint`：

| 语言 | 旧 | 新 |
|---|---|---|
| zh | 点右侧麦克风说出命令，长按可输入文字 | 轻点输入命令，长按说出命令 |
| en | Tap the mic and speak a command — long-press to type it instead | Tap to type a command — hold to speak it |

其余 `aiSuggest.*` 键（`voiceFabLabel`「语音命令」/ `listening` 等）不含麦克风字样，不动。无障碍标签随相位播报的逻辑（录音/错误态后缀）保留。

**守卫测试**：断言 zh+en 两份 locale 的 `aiSuggest` 命名空间内任何值不含「麦克风」/「mic」（大小写不敏感、词边界），防止回潮。

## 5. 改动面

| 文件 | 改动 |
|---|---|
| `src/components/terminal/TerminalVoiceFab.tsx` | `TouchableOpacity`→`Pressable`；`MicIcon`→`Logo`；pressIn/pressOut + 计时器手势状态机；props `{phase, disabled, onShortPress, onHoldStart, onHoldEnd, holdThresholdMs?}`（替换 `onPress`/`onLongPress`）；生成态小 spinner 叠加 |
| `src/screens/devices/DeviceTerminalScreen.tsx` | FAB 接线三行：`onShortPress → openTextInput`、`onHoldStart → startVoice`、`onHoldEnd → stopVoice`（分流判 phase 的逻辑从原 onPress 里平移过来） |
| `src/i18n/locales/terminal/zh.json` `en.json` | `aiSuggest.emptyHint` 各一行 |

`useAiCommandSuggestions.ts`、`TerminalAiStatusStrip.tsx`、`TerminalSuggestionRow.tsx`、server、agent：**零改动**。

## 6. 测试（TDD）

新增（jest，遵守 worktree 内 `--testPathIgnorePatterns="/node_modules/"` 调用惯例）：

1. **手势状态机**（`TerminalVoiceFab.test.tsx`）
   - 短按（pressIn→pressOut，未到阈值）→ `onShortPress` 恰一次，`onHoldStart/onHoldEnd` 不触发；
   - 长按（pressIn→推进 fake timers ≥阈值→pressOut）→ `onHoldStart` 一次 + `onHoldEnd` 一次，`onShortPress` 不触发；
   - 阈值内松开不触发 hold；pressOut 无 pressIn 配对 → 全部 no-op；
   - 按压中卸载 → 不触发任何回调、无计时器泄漏；
   - `disabled` → pressIn/pressOut 均不产生回调。
2. **渲染断言**：录音/生成/错误各相位下 logo 存在（testID）且不随相位消失；生成态出现小 spinner；录音态脉冲叠层存在。
3. **i18n 守卫**：`aiSuggest` 命名空间 zh+en 全值扫描，不含「麦克风」/`mic`。
4. **screen 接线**（如既有 screen 测试基建允许）：`onHoldStart` 调 `startVoice`、`onHoldEnd` 调 `stopVoice`、`onShortPress` 调 `openTextInput`。

回归：既有全量 jest 基线（terminal 相关既有 flake 为已知基线）；`tsc --noEmit` 0 错。

## 7. 验收（真机）

1. 空闲点一下 → 文字输入条弹出；输入描述 → 建议 chips 照旧。
2. 按住 ≥ 半秒 → 顶部状态条出现实时字幕（正在聆听…），**松手** → 录音结束 → 生成建议。
3. 按住后手指滑出按钮 → 录音停止，无挂死。
4. 按钮任何状态下显示的都是 aliang logo（深/浅色主题各看一眼）。
5. 底部空态提示文案不再出现「麦克风」。
