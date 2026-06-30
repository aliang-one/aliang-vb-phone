# Voice → Bash(语音说需求 → AI 生成 bash → 确认运行)— 设计

- 日期: 2026-06-30
- 范围: 跨三仓 —— 手机(`AliangVibeCodingPhone`)、Node 服务端(`AliangPhoneServer/server`)、Go agent(`AliangPhoneServer` 下的 agent / `cmd/aliang`)。`official-website` 零改动。
- 状态: 设计已与用户确认,待实现计划。

## 1. 背景与目标

用户希望"说一句话,AI 生成对应的 bash 命令,确认后直接在终端里跑",提供两个入口:

- **入口 A — 长按 NEW TERM**(VibeCoding 列表页 Terminals 标签的悬浮胶囊):长按 → 弹录音 modal → STT → 服务端把转写文本 + 工具能力发给云端 AI → AI(可调只读工具获取环境信息)产出 bash → 手机二次确认 → 创建新终端并自动运行。
- **入口 B — 终端内语音悬浮框**(Phase 2):在终端命令输入/推荐栏最右加一个语音 FAB → 录音 → STT → 同一条 AI 链路 → 弹框编辑确认 → 注入当前 pty 并回车执行。

轻点 NEW TERM 仍走原逻辑(新建空终端)。本功能只挂在**长按**上。

两个入口共用一条服务端"文本 → bash"核心链路(`command-gen`)。

## 2. 设计决策总览(已与用户确认)

| 决策点 | 选择 |
|---|---|
| AI 调用位置 | Node 服务端直连 LLM(OpenAI 兼容 `/chat/completions`),**不复用** vibecoding 的 Go agent spawn-CLI 重链路 |
| AI 配置 | admin 可编辑的 `ServerSettings.commandGen`(base URL / apiKey / model / 提示词模板 / maxToolCalls / timeoutMs),持久化、免重编(照 STT 模式) |
| 运行语义 | 确认后**直接运行**:A 创建新终端并跑;B 写入现有 pty 并回车 |
| 危险命令 | 提示词避险 + 服务端&手机双侧 `DANGEROUS_COMMANDS` 检测 + 弹框红字警告 + 危险命令二次确认 |
| 工具执行 | tool-calling 循环由**服务端编排**;工具调用经 WS 代理到 **Go agent 只读执行**;密钥留服务端 |
| 工具审批策略 | **读/写分级**:读类工具自动执行(加四护栏),唯一"写"=最终 bash 走人工确认 |
| 初始态信号 | `mode: 'initial'`(无终端,新 shell 首命令)/ `'live'`(现有终端,可查实时环境 + 命令历史) |
| 录音交互 | 录音 modal 用点按切换(点一下开始/点一下结束),复用 `useVoiceStt` |
| LLM 输出 | 只回**裸 bash**(无 markdown/解释);确认弹框就显示这条命令 |
| 流式 | v1 非流式(bash 通常很短) |

## 3. 架构总览

```
[手机]                          [Node 服务端]                    [Go agent(设备)]            [云端 AI]
入口A 长按NEW TERM ─┐
入口B 终端语音FAB ──┤
                  ├─► VoiceToBashModal(录音+STT)
                  │     │ POST /api/ai/command-gen
                  │     ▼
                  │   command-gen handler ──┬──► 云端 AI(/chat/completions,带 tools)
                  │   (编排 tool 循环)      │     ◄── tool_calls
                  │                         │
                  │                         ├──► agent.tool.invoke (WS) ──► 只读工具执行
                  │                         │     ◄── agent.tool.result  ◄──
                  │                         └──► (loop 直到 AI 给最终 bash)
                  │     ◄── { command, dangerous }
                  │   确认弹框(可编辑 + 危险红字 + 二次确认)
                  ▼
            onConfirm(command)
                │
        ┌───────┴────────┐
   入口A: navigate        入口B: 写 cmd+'\r'
   DeviceTerminal          到当前 pty
   (initialCommand)
```

服务端是"agent 大脑":持 LLM 配置/密钥/提示词,编排 tool-calling 循环;Go agent 是"只读手眼":执行环境探测工具。手机是"嘴 + 确认门 + 执行器"。

## 4. 服务端设计(`AliangPhoneServer/server`)

### 4.1 配置(扩 `ServerSettings`)

`types.ts` 的 `ServerSettings` 增加:

```ts
commandGen: {
  enabled: boolean;
  baseUrl: string;        // OpenAI 兼容基地址,如 https://api.openai.com/v1
  apiKey: string;         // 服务端持有,绝不下发 agent/手机
  model: string;          // 如 gpt-4o-mini / glm-4-flash
  promptTemplate: string; // 含 {request}/{os}/{cwd}/{mode} 占位符
  maxToolCalls: number;   // 单次生成的工具调用上限,默认 ~6
  timeoutMs: number;      // 整条 tool 循环总超时,默认 ~25000
};
```

持久化在 `server_settings` 行(sqlite + pg 镜像,照 STT 字段的方式加列)。`modules/routes/admin.ts` 的 `GET/PUT /api/admin/settings` 扩 `commandGen` 字段;admin web 加一页配置(base URL / key / model / 模板 / 上限)。未配置或 `enabled=false` → 端点返回 503 + 明确提示。

### 4.2 LLM client(`server/src/commandGen/llmClient.ts`,新增)

OpenAI 兼容 `POST {baseUrl}/chat/completions`,body 含 `{ model, messages, tools, tool_choice:'auto' }`:
- `messages[0]` = system,内容由 `promptTemplate` 填充:`{request}`=用户原话、`{os}`/`{cwd}`=目标设备与目录、`{mode}`=initial/live。模板内含 tool 使用说明 + "只输出裸 bash、不要解释/markdown" + 危险操作避险指令。
- `tools` = 工具定义(见 §5.1)。
- 解析响应:若 `choices[0].message.tool_calls` 非空 → 返回工具调用让上层处理;否则 `choices[0].message.content` 即最终 bash。

超时与重试:单次 LLM 调用设较短超时;`fetch` 失败/超时向上抛,由编排层决定降级。

### 4.3 tool-calling 编排(`server/src/commandGen/orchestrator.ts`,新增)

输入:`{ request, deviceId, cwd, os, mode, sessionId?, projectId? }`。流程:
1. 构造 system(填模板)+ user(request)消息。
2. 循环(≤ `maxToolCalls` 次,且未超 `timeoutMs`):
   a. 调 `llmClient`。
   b. 若返回 `tool_calls`:逐个经 WS `agent.tool.invoke`(§6)发给 `deviceId` 的 agent → 收 `agent.tool.result` → 作为 `tool` 角色消息追加进对话。
      - `mode==='live'` 时,`recent_commands` 工具**不走 agent**:服务端直接从已存的终端命令历史(`terminalCommandRetentionPerSession`)取最近 N 条,本地应答。
   c. 若返回最终文本 → 跳出循环,该文本 = bash。
3. 取最终 bash → 服务端再跑一次 `DANGEROUS_COMMANDS` 检测(复用手机端同一份规则常量,服务端也留一份) → 返回 `{ command, dangerous }`。

降级:agent 离线 / `agent.tool.invoke` 超时 / 工具执行出错 → 把"工具不可用:<原因>"作为该工具的结果回填给 LLM,让其尽力出 bash;循环超 `maxToolCalls` 或 `timeoutMs` 仍未收敛 → 若已有过部分 LLM 文本则返回该文本并标 `dangerous` 复核,否则返回错误。

### 4.4 端点

`POST /api/ai/command-gen`(user bearer 鉴权,沿用现有 `/api/ai/*` 中间件):
- body: `{ text: string, deviceId: string, cwd: string, mode: 'initial'|'live', sessionId?: string, projectId?: string }`
- 200: `{ command: string, dangerous: boolean }`
- 503: 未配置 / agent 离线兜底失败
- 鉴权/参数校验失败走现有错误约定。

### 4.5 安全(读/写分级 + 四护栏)

详见 §7。服务端职责:持密钥、跑 `DANGEROUS_COMMANDS` 复检、审计日志(每次工具调用 + 最终命令落 audit/session)。

## 5. Go agent 设计(`cmd/aliang` / agent 模块)

### 5.1 工具集(只读,全部加护栏)

| 工具 | 入参 | 出参 | 护栏 |
|---|---|---|---|
| `list_dir` | `{ path }`(相对 cwd) | 目录条目名列表 | 路径限定 cwd 内,拒 `../` 越界;条目数上限 |
| `read_file` | `{ path }` | 文件文本 | 限定 cwd 内;大小上限(如 8KB);**敏感拒绝**(见下); |
| `git_status` | `{}` | repo? branch? short status | 只读 git 子命令(`rev-parse`/`status --short`/`branch --show-current`) |
| `env_info` | `{}` | os / shell / user / 关键工具版本(node/git/python…) | 不返回完整 env,只返回白名单项 |

**敏感拒绝 denylist**(在 cwd 内也拒):`.env*`、`*.key`、`*.pem`、`id_rsa*`、`*_rsa`、`.git/config`、`*token*`、`*secret*`、`credentials*` 等(服务端可配,agent 侧内置默认)。命中即以 `{ ok:false, error:'sensitive_path_denied' }` 回应(不算"执行失败",会回填给 LLM 说明)。

### 5.2 WS 契约(新增,复用现有 pending-request 响应模式)

- `agent.tool.invoke`(server → agent):`{ call_id, tool, args, cwd }`
- `agent.tool.result`(agent → server):`{ call_id, ok, result?, error? }`

agent 侧:收到 invoke → 校验工具名与 cwd 是否在该设备的授权目录内 → **只读**执行 → 回 result。严禁任何能改变系统状态的操作(无 `run_command`/`write_file` 工具)。复用 agent 现有的 request/response 通道(与 pending agent requests 同一套注册/超时/清理机制)。

## 6. WS 契约汇总(新增)

| 方向 | 消息 | 载荷 |
|---|---|---|
| server → agent | `agent.tool.invoke` | `{ call_id, tool, args, cwd }` |
| agent → server | `agent.tool.result` | `{ call_id, ok, result?, error? }` |

(命令/响应语义对齐现有 agent 请求模式;`call_id` 用于超时与并发匹配。)

## 7. 安全与权限模型(核心)

**读/写分级,审批次数 = 写的次数,不是工具调用次数。**

- **读工具自动执行**:v1 全部工具只读,改不了系统。"AI 自由调只读工具" ≠ "开放自由执行",因为它们无副作用。唯一副作用是最终 bash,已被人工确认弹框拦住。
- **v1 不提供任何写工具**;唯一写路径 = 确认后的 bash。
- → 全程 **0 次工具审批 + 1 次命令审批**(确认弹框)。不存在"每个工具都审批"的繁琐。

**auto-read 的真实风险 = 泄密(不是乱执行)**,用四条硬规则堵(服务端 + agent 侧,不靠审批):

1. **限定范围** — 只读 cwd(授权目录)及子路径,拒 `../` 越界。
2. **敏感拒绝** — denylist(`.env*`/`*.key`/`id_rsa*`/`.git/config`/`*token*`…)。
3. **大小上限** — `read_file` 限 ~8KB。
4. **审计** — 每次工具调用 + 最终命令落 session/audit 日志,admin 可查(透明不挡)。

**最终 bash 的写门**:确认弹框显示可编辑命令;命中 `DANGEROUS_COMMANDS`(`rm -rf`/`sudo rm`/`mkfs`/…)→ 红字警告 + 需二次确认才运行;运行 = 写 `cmd+'\r'` 到 pty(两入口都是确认后直接执行)。

> 安全属性来自**只读 + 有界**,不是"预设工具"。规则:工具可自动执行 ⇔ 它只读且有界。日后若加写工具,必须升级为显式策略标签(见 §11)。

## 8. 手机设计(`AliangVibeCodingPhone`)

### 8.1 `VoiceToBashModal`(共享组件,新增)

`components/terminal/VoiceToBashModal.tsx`。Props:`{ visible, deviceOs?, cwd, mode, deviceId, sessionId?, projectId?, onClose, onConfirm(command) }`。内部状态机:

```
recording ──stop──► transcribing ──endpoint──► confirming ──onConfirm──► (closed)
   ▲                   │(error)                   │ 取消/重录
   └──────── re-record │                          ▼
                       ▼                        closed
                    (error + retry)
```

- `recording`:复用 `useVoiceStt({ onComplete, sessionId, projectPath })`。点按切换(点 mic 开始、点"停止"结束),实时字幕(`liveCaption`)。`onComplete(transcript)` → 进 `transcribing`。
- `transcribing`:`apiPost('/api/ai/command-gen', { text, deviceId, cwd, mode, sessionId, projectId })` → `{ command, dangerous }` → 进 `confirming`。失败 → 错误态 + 重试/取消。
- `confirming`:可编辑 `TextInput`(mono)预填 `command`;`dangerous` 或本地 `isUnsafeSuggestion(command)` 命中 → 红字警告 + "确认运行"需二次点按;按钮 `取消 / 重录 / 确认运行`。确认 → `onConfirm(command)` → 关闭。
- 卸载/取消 → `useVoiceStt.cancel()`。

### 8.2 入口 A:长按 NEW TERM(`VibeCodingListScreen.tsx`)

当前 NEW TERM FAB(`TouchableOpacity`,`onPress=handleCreateTerminal`)增加 `onLongPress`:
- `onLongPress` → 打开 `VoiceToBashModal`,带 `{ mode:'initial', deviceId: newTerminalDevice.id, cwd: newTerminalDevice.authorizedDirectories[0] ?? '~', deviceOs: newTerminalDevice.os }`。
- `onConfirm(command)` → `navigation.navigate('DeviceTerminal', { deviceId: newTerminalDevice.id, directory: <cwd>, initialCommand: command })`。
- 无可用设备(`!newTerminalDevice`)时长按不响应(FAB 本就 disabled)。

### 8.3 `DeviceTerminalScreen.tsx`(initialCommand 自动运行,新增小钩子)

- 路由参数增 `initialCommand?: string`。
- 终端/pty 就绪(用现有 `isTerminalInputAvailable` 判断 input available)后,且仅当有 `initialCommand` 时,通过现有命令发送路径写 `initialCommand + '\r'` 一次,然后清掉该参数(防重复)。
- Phase 2 的入口 B 语音 FAB 也在本屏(见 §8.4)。

### 8.4 入口 B:终端内语音 FAB(`DeviceTerminalScreen.tsx`,Phase 2)

- 在命令输入/推荐栏(`buildTerminalSuggestions` 渲染处)最右加一个语音 FAB(与 NEW TERM 胶囊同风格,小号)。
- 点击 → 打开 `VoiceToBashModal`,带 `{ mode:'live', deviceId: terminal.deviceId, cwd: terminal.directory, deviceOs, sessionId, projectId }`。
- `onConfirm(command)` → 通过现有终端输入发送路径(与 `EXECUTE` 同一条)写 `command + '\r'` 到当前 pty → 关闭。
- 仅在终端可输入(`isTerminalInputAvailable`)时启用 FAB。

## 9. 数据流

**入口 A**:长按 FAB → modal 录音 → STT 转写 → `POST /command-gen` → 服务端 tool 循环(LLM↔agent 只读工具) → `{command, dangerous}` → 确认弹框 → `onConfirm` → `DeviceTerminal(initialCommand)` → pty 就绪写 cmd+⏎。

**入口 B**:点终端语音 FAB → modal 录音(mode=live) → STT → `POST /command-gen`(live 下 `recent_commands` 服务端自供) → `{command, dangerous}` → 确认弹框 → `onConfirm` → 当前 pty 写 cmd+⏎。

## 10. 错误处理与降级

- **LLM 调用失败/超时**:单次重试一次,仍失败 → modal 错误态(可重录/取消),不产生命令。
- **agent 离线**:入口 A 的 `newTerminalDevice` 本就是 online;入口 B 终端活跃 → agent 在线。若 `agent.tool.invoke` 失败 → 回填工具错误给 LLM,尽力出 bash;全失败 → 503,modal 提示。
- **工具越界/敏感命中**:agent 返回 `{ok:false, error}` → 回填 LLM(说明被拒),不中断循环。
- **循环不收敛**(超 `maxToolCalls`/`timeoutMs`):返回已有部分文本(标 `dangerous` 复核)或错误。
- **STT 失败**:沿用 `useVoiceStt` 现有错误展示(`errorMessage`)。
- **危险命令**:即使 AI 已避险,双侧 `DANGEROUS_COMMANDS` 兜底;弹框二次确认。

## 11. 测试

沿用各仓测试基线(tsc 为准;LSP 在重构期 desync,以 `tsc --noEmit`/`go build`/`go vet` 为权威)。

- **服务端**(vitest):
  - `llmClient`:mock fetch —— 模板填充正确、tool_calls 解析、最终文本=bash、超时。
  - `orchestrator`:mock llmClient + mock agent tool RPC —— 单轮出 bash、多轮 tool 循环收敛、`recent_commands` 走本地、agent 超时回填降级、`maxToolCalls`/`timeoutMs` 截断、`DANGEROUS_COMMANDS` 标 `dangerous`。
  - 端点:鉴权、未配置 503、参数校验、happy path。
  - 审计:工具调用 + 最终命令落日志。
- **Go agent**(go test):
  - `agent.tool.invoke` → 各工具只读结果;`list_dir`/`read_file` 越界拒绝;`read_file` 敏感 denylist 命中拒绝 + 大小上限;`git_status`/`env_info` 只读;无写副作用;`call_id` 匹配与超时。
- **手机**(jest):
  - `VoiceToBashModal` 状态机:录音→转写→确认→`onConfirm`、`dangerous`/本地 unsafe 二次确认、重录、取消(调 `cancel`)、endpoint 失败重试。
  - 入口 A:`NEW TERM` `onLongPress` 开 modal(initial 模式 + 正确 deviceId/cwd)、`onPress` 仍 = 新建空终端、`onConfirm` navigate 带 `initialCommand`。
  - `DeviceTerminal` `initialCommand`:就绪后写一次 cmd+⏎ 且不重复。
  - (Phase 2)入口 B FAB:仅可输入时启用、`onConfirm` 写 pty。

## 12. 分期

- **Phase 1**:服务端 `commandGen` 配置 + `llmClient` + `orchestrator` + 端点 + admin 配置页;Go agent `agent.tool.*` + 只读工具 + 护栏;手机 `VoiceToBashModal` + 入口 A 长按 + `DeviceTerminal.initialCommand`。
- **Phase 2**:入口 B 终端内语音 FAB + pty 注入;`recent_commands`(live 模式)接线。

## 13. 范围与边界

- 只动:Node 服务端(新 `commandGen` 模块 + admin 配置 + `ServerSettings` 字段 + `/api/ai/command-gen`)、Go agent(新 `agent.tool.*` + 只读工具)、手机(新 `VoiceToBashModal` + 两处接线 + `DeviceTerminal` 钩子)。
- `official-website` **零改动**。
- STT 链路完全复用(`/ws/stt` + `useVoiceStt` + 录音持久化)。
- vibecoding 的 Go agent spawn-CLI 链路**不复用**(本功能是独立轻量 LLM 直连)。
- v1 不提供写工具;不加流式;不加 LLM 解释输出(只裸 bash)。

## 14. 未来可选(非本次范围)

- **写工具 / 策略标签**:若日后要给 AI 写能力(如 `apply_patch`),升级为每工具 `safety: read|write|destructive` + admin 可配策略(自动/确认/禁止)的清单模型。本次只读,暂不需要。
- **环境快照模式**:若 tool 循环太重,可退化为"服务端一次性向 agent 拉环境快照塞 prompt + 单次 LLM 调用"(§3 之外的 YAGNI 备选)。
- **流式输出**:长 bash 场景再考虑。
- **AI 一句话解释**:确认弹框里附带"这条命令会做什么"的简述(需改 LLM 输出契约为 JSON)。

## 15. 改动文件清单

| 仓 / 文件 | 改动 |
|---|---|
| `server/src/types.ts` | `ServerSettings` 加 `commandGen` 字段 |
| `server/src/config.ts` | env 默认值(可选,主要走 admin 配置) |
| `server/src/commandGen/llmClient.ts` | 新增 OpenAI 兼容 tool-calling client |
| `server/src/commandGen/orchestrator.ts` | 新增 tool 循环编排 + `DANGEROUS_COMMANDS` 复检 |
| `server/src/commandGen/tools.ts` | 新增工具定义 + `DANGEROUS_COMMANDS`/敏感 denylist 常量 |
| `server/src/commandGen/route.ts`(或并入 ai 路由) | `POST /api/ai/command-gen` handler |
| `server/src/database.ts` + `postgresDatabase.ts` | `server_settings` 加 `commandGen` 列(sqlite+pg 镜像) |
| `server/src/modules/routes/admin.ts` | `GET/PUT /api/admin/settings` 扩 `commandGen` |
| agent(`cmd/aliang` 等) | `agent.tool.invoke`/`result` 处理 + 只读工具实现 + 护栏 |
| `web/src/App.tsx` | admin 服务器设置加 commandGen 配置页 |
| `phone/src/api/commandGen.ts` | 新增 `generateCommand(...)` 调 `/api/ai/command-gen` |
| `phone/src/components/terminal/VoiceToBashModal.tsx` | 新增共享 modal |
| `phone/src/screens/vibecoding/VibeCodingListScreen.tsx` | NEW TERM FAB 加 `onLongPress` + 接 modal |
| `phone/src/screens/devices/DeviceTerminalScreen.tsx` | `initialCommand` 自动运行 + (Phase 2)语音 FAB |
| 三仓测试 | 见 §11 |
