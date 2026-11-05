# 长按麦克风键：光标处实时听写（Dictation at Cursor）设计

- 日期：2026-11-05
- 范围：仅手机端（AliangVibeCodingPhone）；服务端与 STT 协议零改动
- 状态：已与用户对齐交互，待实施

## 1. 背景与目标

聊天页输入区（`MessageComposer`）左侧有一个模式切换键：文本模式下显示麦克风，
点按切换到语音模式。用户打字打到一半时，若想用语音续写，当前只能切到语音模式
再走"编辑"回填，草稿与光标位置全丢。

目标：文本模式下**长按**麦克风键，直接进入听写——识别文字**实时出现在当前光标
处**，边说边长；**松手**停止并定稿，光标落在插入文本末尾。点按行为保持不变。

用户已拍板的交互决策（2026-11-05）：

1. 结束方式 = **按住说话，松手结束**（hold-to-talk，与语音模式现有手势一致）。
2. 识别结果 = **实时填入输入框光标处**（中途改为实时，替代最初"松手才插入"）。
3. "前边问答当 STT 提示词（上下文增强）" = **本期不做**，单独立项。现有 NLS
   provider 不支持按请求上下文，需迁百炼 DashScope 流式模型才支持；仅记录，
   不实施。

## 2. 交互定义

文本模式下左侧模式切换键（`renderModeToggle`，testID `composer-toggle`）：

| 手势 | 行为 |
| --- | --- |
| 点按（tap） | 切换到语音模式（现状，不变） |
| 长按（`onLongPress`，RN 默认 ~500ms） | 进入听写：录音开始，识别文字实时插入光标处 |
| 长按后松手（`onPressOut`） | 停止录音；`stt.completed` 到达后片段定稿，光标落到插入文本末尾 |

听写期间：

- 键盘不收起（按住的是输入框外的按钮，不会触发 blur）。
- 输入框上方出现一条提示行："正在听写…松手结束" + 波形微动；状态反馈（连接
  中/录音中/错误文案）全部由该提示行承担。在途未定稿片段以**普通文本样式**
  直接呈现在输入框内——RN `TextInput` 无法对子串做样式区分，不做花哨效果。
- 模式切换键禁用（`isVoiceActive` 已有该守卫），防止按住期间误触切模式。

语音模式的全部交互（点按开始/停止、hold-to-talk、live caption、编辑回填）不动。

## 3. 技术设计

### 3.1 数据流

复用现有 `useVoiceStt`（屏幕持有单例）。听写与语音录制共用同一实例，天然互斥
（`start()` 的 status 守卫已保证不并发）。

```
长按(composer) ──onDictationPressIn──▶ screen: voiceStt.start({
                                         sessionId/projectPath/deviceId 同语音路径,
                                         onComplete: commitDictation })
liveCaption 变化(hook 已节流) ──watch──▶ screen: input = replaceSegment(
                                          input, insertCursor, segLen, liveCaption)
松手(composer) ──onDictationPressOut──▶ screen: voiceStt.stop()
stt.completed ──onComplete──▶ screen: commitDictation(text)
                               → 定稿（segLen 清零）、composerRef.setSelection(cursor+len)
stt.error / 空结果 ──▶ screen: revertSegment()（还原原文）+ 提示行显示错误
```

### 3.2 屏幕层状态机（VibeCodingSessionScreen）

新增 `dictationRef`（不进 React state，避免每个 partial 触发一次多余渲染；
插入结果本身走 `setInput`）：

```ts
{ active: boolean; cursor: number; segLen: number }
```

- `cursor`：长按瞬间输入框选区锚点（见 3.4 选区规则）。
- `segLen`：当前在途片段长度（初始 = 选区长度，见 3.4）。
- `active` 期间 watch `voiceStt.liveCaption`，用 3.3 纯函数计算新 input 并
  `setInput`；`segLen` 同步为 `liveCaption.length`。

新回调（传给 composer）：

- `handleDictationPressIn`：守卫（只读态/离线/已有录制进行中）→ 置 `active`、
  锚定 cursor、`voiceStt.start({ ..., onComplete: commitDictation })`。
- `handleDictationPressOut`：`voiceStt.stop()`（最短录音/超时兜底等既有韧性
  逻辑全部复用，不另起炉灶）。
- `commitDictation(text)`：**必须**用 `replaceSegment(input, cursor, segLen,
  text)` 把在途段整体替换为权威 final 全文（`text` 为 hook onComplete 交付的
  `full_text`/partial），再做清理。绝不能假设"片段已在位、liveCaption 已收敛"：
  liveCaption 有 120ms 节流，`finishWith` 会**丢弃未刷新的 pending caption**，
  服务端标点/ITN 归一化也可能使 `full_text` 与已显示文本不一致——跳过 splice
  会静默丢失听写尾部。替换后清 `active`/`segLen`，经 composerRef
  `setSelection(cursor+text.length)` 落光标。`text` 空 → revert + 复用
  `noSpeechDetected` 文案。
- watcher 门控：liveCaption 的 watch 效果以 `dictationRef.current.active` 判定
  是否应用。这是硬性要求——`finishWith` 在 `onComplete` 触发**之前**会把
  liveCaption 置空（还会带上从未渲染过的 pending 值），未门控的 watcher 会在
  commit/revert 之后收到尾随空更新，把已定稿片段抹掉。
- revert：与 commit 同一助手函数（`replaceSegment(input, cursor, segLen, '')`
  还原原文）。
- 失败路径：`failWith`（如 `noSpeechDetected`、captureSilent）不会触发
  onComplete → active 状态下收到 error 即 revert 原文，提示行显示
  `voiceStt.errorMessage`（下一次交互或超时消失）。`stt.error` 携带部分文本时
  hook 已走 `finishWith(partial)` → 正常 commit。

### 3.3 插入纯函数（可单测）

```ts
replaceSegment(input: string, cursor: number, segLen: number, incoming: string): string
// = input.slice(0, cursor) + incoming + input.slice(cursor + segLen)
```

覆盖场景：光标在中间、光标在末尾、空 input、片段收缩（识别改口变短）、
片段清空（partial 中间态为空字符串）。

### 3.4 选区规则

- 选区为空（`selection.start === selection.end`）：在光标处插入。
- 选区非空：`cursor = selection.start`，`segLen` 初始 = `selection.end -
  selection.start` —— 第一次 liveCaption 更新即替换整个选区，与系统键盘
  听写习惯一致。
- 输入框从未聚焦（`onSelectionChange` 一次都没触发过）：默认
  `cursor = input.length`（追加到末尾），不取 0。

### 3.5 光标落位

RN 受控 TextInput 程序化改值后光标默认跳到全文末尾；听写多为续写末尾时恰好
正确，但**光标在中间续写**时错误。因此：

- `MessageComposer` 改为 `React.forwardRef` + `useImperativeHandle`，对外暴露
  `setSelection(start: number, end: number)`（内部 TextInput ref 透传）。
  memo 包裹保留（`React.memo` 套 `forwardRef`）。
- `commitDictation` 做 splice 后调用 `composerRef.current?.setSelection(
  cursor+text.length, cursor+text.length)`——splice 本身会改变文本，落光标
  必须在 splice 之后同一次完成。
- 实时更新途中不强制控制光标（用户双手被占用，期间光标位置纯视觉；定稿一刻
  才修正）。

### 3.6 Composer 改动清单

1. `renderModeToggle`：`TouchableOpacity` 增加 `onLongPress`（RN 中
   onLongPress 触发后松手不再触发 onPress，点按路径零回归）；新 props
   `onDictationPressIn` / `onDictationPressOut`（可选 prop，未传时长按回落为
   无操作）。影响面说明：`MessageComposer` 的唯一消费方是
   `VibeCodingSessionScreen`（已 grep 证实）；`ApprovalCustomReply` /
   `DeviceControlCard` / `VibeSessionCard` 用的是另一个组件 `VoiceTextInput`，
   与本改动无关。可选 prop 是为未来复用留的安全垫，本期无其他回归面。
2. `TextInput` 增加 `onSelectionChange`，经新 prop `onComposerSelectionChange`
   上报屏幕（屏幕存 ref，不进 state）。
3. 听写提示条：`status ∈ {connecting, recording, stopping}` 且 `mode === 'text'`
   时显示（"正在听写…松手结束" / errorMessage），复用现有 i18n 命名空间新增
   key（i18n jest 锁 zh，key 齐进 zh 与 en）。
4. 只读守卫沿用 `composerDisabled`：只读态长按不启动。

### 3.7 录音持久化字段

与语音路径完全一致（`sessionId` / `projectPath` / `deviceId`），admin 侧
stt_records 浏览与回放口径不变。

## 4. 边界与错误处理

| 场景 | 行为 |
| --- | --- |
| 空结果（说了但没识别出） | hook `failWith(noSpeechDetected)` → revert 原文 + 提示行报错 |
| 松手过快（< MIN_RECORDING_MS） | hook 既有等待补齐逻辑复用，无需新代码 |
| `stt.completed` 迟到/丢失 | hook STOP_SAFETY 兜底 `finishWith` → 仍会 commit |
| 听写中回合开始流式输出 | 输入框仍可编辑（现状语义），听写不受影响；不新增拦截 |
| 长 input 性能 | 每次 partial 一次字符串拼接 + setInput，量级等同逐字输入；hook 已节流 liveCaption |
| 复用方未传新 props | onLongPress 回落无操作，行为与今天一致 |

## 5. 明确不做（本期）

- 不改服务端、不改 `stt.start`/`sttTypes` 协议、不迁移百炼 DashScope。
- 不做上下文增强 / 热词表（记录为后续独立项：见 1.3）。
- 不做语音模式的任何改动。
- 不做"听写转 AI 润色"（语音路径方案A同理，直接原文入框）。

## 6. 测试计划

1. 纯函数 `replaceSegment` 单测：3.3 所列场景全绿。
2. Composer 手势测试：长按触发 `onDictationPressIn`；press-out 触发
   `onDictationPressOut`；点按仍触发 `onModeChange`（回归）；未传可选 props
   时长按无操作（守住可选契约）。
3. 屏幕级听写状态机测试（可抽纯逻辑）：liveCaption 更新替换在途段；
   `commitDictation` splice 权威文本 + 落光标；尾随 liveCaption 空更新不抹
   已定稿片段（watcher 门控）；错误 revert。
4. 既有 jest 基线保持绿（`MessageComposer.memo/attachments/steer`、
   `VoiceTextInput`、`useVoiceStt` 系列不回归）。
