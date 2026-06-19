# VibeCoding 输入栏 · Agent 感知工具菜单（Tools Menu）

**Date:** 2026-06-19
**Goal:** 在 vibecoding 输入框附近（modeRow 最左）加一个工具钮，点击弹出按 agent（Claude Code / Codex）区分的设置 + `/` 命令菜单，让用户在输入时更快地切模型/强度/风险、插入斜杠命令。

## 关键决策（用户拍板）

1. **位置/形态**：`modeRow` 最左一个工具钮（VOICE/TEXT 两种模式都常驻）→ 点击展开**底部抽屉**（内联在 inputPanel 顶部，输入栏仍贴底可见）。
2. **数据来源**：**扩展 agent + 云契约上报真实命令**（不在手机端写死目录）。手机是纯渲染器。
3. **`/` 行为**：**插入为可编辑提示词**（不假装"执行"交互态命令）。

## 「能否拿到」— 落地后的诚实结论

| 命令类型 | 来源 | 能否真实拿到 |
|---|---|---|
| 项目自定义 `/` | `<项目>/.claude/commands/*.md` | ✅ agent 真正 introspect（frontmatter 取 description / argument-hint） |
| 用户自定义 `/` | `~/.claude/commands/*.md` | ✅ 同上 |
| 内置 `/` | `/clear /compact /model /cost /review /memory …` | ⚠️ agent 内置精选基线（CLI 不枚举自身命令） |
| codex | 无自定义命令文件 | 以**设置**为主 + 少量精选命令 |

所以"能拿到且正确展示"= 项目/用户自定义命令是真的可发现、真按机器/项目不同；内置是 agent 维护的稳定基线。

## 三层架构

```
桌面 agent                   云端 server                     手机
detectAiTools()              AgentTool.commands?:             AgentToolInfo.commands?
 + discoverCommands()   ──>  normalizeAgentTools        ──>  ToolsMenu 底部抽屉
 (读 .claude/commands)       (透传 commands)                 (按 isCodex 渲染 + 插入)
```

`AgentCommandInfo = { name, description?, argHint?, scope: 'builtin'|'user'|'project' }`
（`name` 不带前导 `/`，UI 负责补 `/`。）

## 已实现（本仓库 = 手机 + 云端 server + local-agent 参考）

- **契约**：`server/src/types.ts`（`AgentCommandInfo`/`AgentCommandScope` + `AgentTool.commands?`）；`server/src/index.ts` `normalizeAgentTools`/`normalizeAgentCommands` 透传；手机 `src/data/platformModels.ts`、`src/api/devices.ts`、`src/store/internals.ts` 映射。
- **agent 参考实现**：`AliangPhoneServer/scripts/local-agent.ts` — `discoverCommands()` + `readClaudeCommandDir()` + `parseCommandFrontmatter()` + `BUILTIN_COMMANDS` 基线。dev 下 `npm run agent:local` 即上报真实命令。
- **手机 UI**：`src/components/vibecoding/ToolsMenu.tsx`（设置：model/强度/risk + 命令列表，点击插入为可编辑文本）；`src/screens/vibecoding/VibeCodingSessionScreen.tsx` modeRow 最左工具钮 + 条件挂载；`src/utils/modelIntensity.ts`（与 SessionSettingsScreen 共享的 model/强度解析）。

## ⚠️ 生产 Go agent（独立仓库，需手动落地）

**`AliangPhoneServer/scripts/local-agent.ts` 是参考实现（TS，dev 用）。生产用的是 Go agent（alianggate），不在此仓库。** 要让生产环境也上报命令，Go agent 需对等实现：

1. `register` / `status sync` 的 `tools[]` 里，每个 AI 工具增加 `commands` 字段（结构同 `AgentCommandInfo`）。
2. claude-code：读每个 projectRoot 的 `.claude/commands/**/*.md` + `~/.claude/commands/**/*.md`，解析 YAML frontmatter（`description`、`argument-hint`），`name` = 去掉 `.md` 的相对路径；再并一份内置基线（`/clear /compact /model /cost /review /memory /init /help`）。
3. codex：仅内置精选基线（`/diff /clear /model`）。
4. 未安装的工具 `commands` 留空（`undefined`），让手机区分"不可用" vs "可用但无命令"。

Go agent 不实现也不会让功能崩溃 —— 手机端会渲染诚实空态（"该 Agent 暂未上报可用命令"），设置区仍可用。

## 验证

- 手机 `tsc --noEmit`：0 错。
- 手机 `jest`：ToolsMenu 5/5 通过；全量 210 passed，5 failed（TerminalListScreen / DeviceDetailScreen / VibeCodingListScreen，**全部 pre-existing**，stash 我的改动后仍同样失败，与本次无关）。
- server `tsc -p server/tsconfig.json`：0 错。
- local-agent.ts 由 tsx 运行（不在 server tsc 范围）；diagnostics 仅 2 处 pre-existing 警告（非本次改动）。

## 设计要点 / 约束

- **手机只渲染、不持有命令目录**：符合"数据来自 agent"。未上报时显示诚实空态，不做假数据。
- **`/` 插入为可编辑文本**：因为 CLI 每轮按 `--model` 重 spawn，无常驻 REPL stdin，交互态命令（`/clear` 等）无法真正执行；插入为文本让用户可改可发。
- **voice 模式点命令**：自动切到 text 模式并填入输入框（命令本质是文本）。
- **每开一次 = 重新挂载**：ToolsMenu 由父条件挂载，drafts 从最新 session props 初始化，避免 useEffect 引发的异步 setState（React 19 test renderer 下会导致 renderer 未挂载）。
