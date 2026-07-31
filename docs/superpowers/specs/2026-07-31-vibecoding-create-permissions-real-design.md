# 创建 vibecoding 的权限区做成真功能 — 设计文档

**日期**: 2026-07-31
**范围**: 手机端 (`AliangVibeCodingPhone`) + 服务端 (`AliangPhoneServer`)。Go agent **零改**。
**状态**: 设计待评审

---

## 1. 背景与动机

创建 vibecoding 页 (`CreateVibeCodingScreen.tsx`) 第 8 段 `PERMISSIONS` 有 4 个开关：

```
Read project files / Modify files in selected directory /
Run local commands with approval / Expose preview ports as short links
```

核查结论：**4 个全是装饰性占位 UI**。`selectedPermissions` 只在该组件内
（`:122` 初始化、`:150` toggle、`:640` 渲染、`:672` Create 按钮 disabled 守卫），
从未进入 `draftConfig`、从未送到服务器 —— 勾不勾对会话毫无影响。
`draftConfig` 类型 (`app/navigation/types.ts:32`) 也没有 permissions 字段。

附带问题：
- 段编号从 `6. EFFORT` 跳到 `8. PERMISSIONS`，缺 `7.`。
- “Expose preview ports as short links” 这个开关跟端口映射/隧道（`/api/port-mappings`
  + `AliangTunnelGateway`）完全没连；会话内的 `preview_links` 子系统是没接通的半成品
  （workspace 内无任何 `.go` emit `preview.ready`）。该功能当前未走通。

**目标**：把权限区从装饰做成真功能，语义清晰、可强制、不误导。

## 2. 关键决策（与用户已确认）

1. **作用域 = 仅本次会话生效**（per-session）。
   - ⚠️ 这**推翻** `2026-07-04-approval-quick-policy-toggle-design.md` 第 158 行
     “不加会话级临时覆盖（用户确认项目级持久即可）” 的决策。用户此次明确要 per-session。
2. **审批策略三档**（创建页入口）：`放行` / `逐项确认` / `只读`。
   - `放行` = 现有 `allow_all`。
   - `逐项确认` = 新：所有工具调用 `require_approval`。
   - `只读` = 新：读工具放行、写/执行工具 `auto_deny`。
   - `balanced`（智能）不在这个入口出现；不显式选 = 继承项目默认（通常 balanced）。
3. **Read / Modify / Run = 独立能力开关**（全局开/关，**不做路径硬闸**）。
   - Modify=off → 本会话写工具 `auto_deny`；Run=off → 执行工具 `auto_deny`；
     Read=off → 读工具 `auto_deny`。
   - **不重新引入路径限制** —— 维持 `2026-07-03` “彻底放开 agent 路径限制、别加回去” 的运营决策
     （见 `mem:path-restrictions-removed-operator-policy`）。
   - approval 档控制“开着的能力怎么决策（auto/ask/deny）”，与能力开关正交。
   - `只读` 档 = `Read=on / Modify=off / Run=off` 的快捷预设 + 锁定。
4. **端口映射 = 置灰展示**（功能未走通，不可选）。

## 3. 架构：怎么把 per-session 策略送到 agent（agent 零改路径）

### 3.1 约束（已坐实）

- agent 通过 `GET /api/agent/approval-policy?project_path=<path>`（`agent/routes.ts:38`）
  与 `…/hash` 探针（`:62`，每个 AI 回合探一次）**按 (device, path) 拉策略**，**不传 session_id**。
- agent 本地按 `rules` 优先、`default_decision` 兜底求值；只在 `require_approval` 时上报服务器。
- 现有 scheme：`balanced` / `allow_all` / `custom`（挂在 device/project 上，**非 session**）。
  见 `database.ts` `resolveProjectApprovalPolicy` / `resolveProjectApprovalPolicyByPath`。

### 3.2 路径作为 session 代理（server-only 近似）

per-session 策略无法直接走现有路径管道下发给 agent。采用**服务端合并**近似：

- `resolveProjectApprovalPolicyByPath(deviceId, path)` 增强为：
  解析项目策略后，**查 (deviceId, path) 上的“当前活跃会话”**；若该会话带覆盖
  （approval_scheme 非空 或 任一能力开关非空），则把覆盖叠加到策略上。
- “当前活跃会话”定义：该 (device, path) 上 `last_active_at` 最大且未 closed 的 vibe 会话。
- 覆盖叠加规则：
  - scheme = `allow_all` → `default_decision=auto_approve`，清掉 require 规则。
  - scheme = `ask_all` → `default_decision=require_approval`，清掉 auto_approve 规则。
  - scheme = `read_only` → 等价 Read=on/Modify=off/Run=off。
  - 能力开关 off → 追加 `auto_deny` 规则（匹配对应工具集，见 §3.4）。
- 覆盖改变 → `computePolicyHash` 变 → 经现有 `project.settings.updated` 推送，
  agent 下回合 `/hash` 探针发现变化即重拉。

### 3.3 假设与风险（必须如实记录）

- **单活跃会话/路径假设**：vibecoding 实践中一个项目路径通常只有一个活跃会话，
  故 path 级解析 = session 级解析。若同 (device, path) 存在多个活跃会话且覆盖不同，
  **取最近活跃那条**；其它会话的覆盖在该期间不生效。这是有意的近似。
  - 备选（更重）：给 `/api/agent/approval-policy` 加 `session_id` 参，agent 改造传递 → 需重编 agent，本次不做。
- **逐项档（ask_all）天然 server-only 可强制**：所有操作 escalate，服务器按
  `approvals.session_id` 解析 per-session 决策（`handler.ts:965` 解析点已具备 session 上下文）。
- **auto_deny 能力开关依赖 agent 本地求值**：需确认 agent 真按推下来的 `auto_deny` 规则
  拦截对应工具（见 §3.4 + §7 验收）。这是**真机 smoke 必查项**。

### 3.4 工具集匹配

`auto_deny` 规则用 `ApprovalRule.match.tool: string[]` 匹配 agent 工具名。
实现期需坐实各 provider 的工具名（如 claude 的 `Edit`/`Write`/`MultiEdit`、codex 的应用编辑工具、
通用 shell/exec 工具）。归类：write 集 / exec 集 / read 集。归不准会导致漏拦——
计划阶段用 codegraph/agent 源码确认工具标识符。

## 4. 服务端改动（`AliangPhoneServer`）

### 4.1 数据模型
- `ai_sessions` 加可空列（null = 继承，旧会话零影响）：
  - `approval_scheme TEXT` — 扩展值 `'allow_all'|'ask_all'|'read_only'`（+ null=继承）。
  - `can_read INTEGER` / `can_modify INTEGER` / `can_run INTEGER`。
- `database.ts` + `postgresDatabase.ts`：建表/迁移 `ensureColumn`；行映射；`AiSession`/`publicAiSession` 类型增字段。
- `database.ts:365` 的 `ai_sessions` schema 与 PG 镜像同步。

### 4.2 resolver
- 新 `resolveSessionApprovalPolicy(deviceId, path)`：
  1. `resolveProjectApprovalPolicyByPath(deviceId, path)` 得项目策略 base；
  2. 查 (deviceId, path) 当前活跃会话；若带覆盖，按 §3.2 叠加；
  3. 重算 hash 返回。
- `handleAgentApprovalPolicy` / `handleAgentApprovalPolicyHash`（`agent/routes.ts`）改调新 resolver。
- `handler.ts:965` approval 解析点：按 `approval.session_id` 解析 session 覆盖（逐项档兜底）。

### 4.3 建会话写入
- `POST /sessions`（创建链路）接收 `approvalScheme` + `canRead/canModify/canRun`，写入新列。
- 首条消息建会话路径（`dispatchUserAiMessage`）透传。

### 4.4 测试
- resolver：session 覆盖 ?? project ?? device 回退；ask_all/read_only/能力开关各档；
  null=继承（旧行为不变）；多会话同 path 取最近活跃。
- 契约：`ai_sessions`/`publicAiSession` 新字段。
- `POST /sessions` 透传新字段。

## 5. 手机端改动（`AliangVibeCodingPhone`）

### 5.1 类型与传递
- `app/navigation/types.ts:32` `draftConfig` 增 `approvalScheme?`、`canRead?/canModify?/canRun?`。
- `VibeCodingSessionScreen.tsx:1217` 建会话带上新字段。
- `serverAiSessionToVibeRun` 等映射同步（若会话页要展示当前策略）。

### 5.2 创建页 UI（替换 4 个死开关；修编号 `8.→7.`）
- **审批策略**（单选 chip 行）：`继承`（默认）/ `放行` / `逐项` / `只读`。
  - 选 `只读` → 把 Read=on、Modify=off、Run=off 并**置灰锁定**；切回其他档解锁。
- **能力开关**（3 toggle 行）：`Read project files` / `Modify files` / `Run local commands`。
  - approval=只读 时 disabled；否则可独立勾选，默认全 on。
- **端口映射**（置灰展示行）：`Expose preview ports as short links` + 副标题 `即将支持` + 灰锁图标，不可点。

### 5.3 默认值 & 记忆
- 默认 approval=`继承`（null）→ 走项目 balanced，**无安全回归**。
- 默认能力（非只读）= 全 on。
- 复用 `rememberModel` 模式记忆上次显式选择（默认 on；可选）。

### 5.4 i18n
- `vibecoding` 命名空间加 key（英文默认 + 中文，遵循 `mem:app-i18n-i18next-setup`）：
  approval 各档标题/副文案、3 个能力开关标签、端口映射“即将支持”。jest 锁 `zh` 不破中文测。

### 5.5 测试
- 选 `只读` snap+锁开关；只读下开关 disabled；`draftConfig` 带新字段；默认值。

## 6. 数据流（创建一个“逐项 + Modify off”会话）

```
创建页选 逐项 + Modify=off → draftConfig{ approvalScheme:'ask_all', canModify:false }
首条消息 → POST /sessions 写 ai_sessions(approval_scheme='ask_all', can_modify=0)
agent 跑该回合前探 /approval-policy/hash?project_path=<p>
  → resolveSessionApprovalPolicy 发现活跃会话覆盖
  → base=project balanced；叠加：default_decision=require_approval + 写工具 auto_deny 规则
  → hash 变 → agent 重拉全量 policy
agent 本地：写工具命中 auto_deny → 直接拦；其它操作 require_approval → 上报服务器
服务器 approval 解析按 session_id → 逐项确认 UI 推到手机
```

## 7. 验收

- 服务端：`tsc -0`；vitest 全绿（含新 resolver 用例）；`POST /sessions` 透传。
- 手机：`tsc -0`；jest 全绿（含创建页新 UI 测，i18n zh 锁不破）。
- 真机 smoke（必查）：
  1. `逐项` 会话：常规操作弹审批。
  2. `只读` / `Modify=off` 会话：agent 写文件被拦（验证 §3.3 auto_deny 风险）。
  3. `放行` 会话：不弹审批。
  4. `继承` 会话：行为同旧 balanced。
  5. 同 path 切到另一个会话：策略跟随最近活跃会话切换。

## 8. 不做（YAGNI / 非目标）

- 不重新引入路径限制（07-03 不动）。
- 不接真隧道网关（端口映射仅展示）。
- 不改项目/设备级 `ApprovalPolicyCard`（纯加 session 级覆盖）。
- 不给 agent 加 session_id 参（不做 agent 改造；接受单活跃会话/路径近似）。
- 不改 Go agent（零改，policy 走现有推送/拉取路径）。
- 不在创建页暴露 `balanced`/`custom`（留给项目设置页细调）。

## 9. 评审建议（spec-reviewer 已采纳）

- **类型分离**：新增会话级类型 `SessionApprovalScheme = 'allow_all' | 'ask_all' | 'read_only'`，
  与现有 project/device 的 `'balanced' | 'allow_all' | 'custom'`（`types.ts:330,628`）**分开**。
  会话列 `approval_scheme` 用会话级类型；`resolveProjectApprovalPolicy` 仍读 project 级。
  避免扩 `ApprovalPolicy.scheme` 联合时把两者混了导致类型错配。
- **规则排序（deny-first）**：构造策略时，能力开关 off 产生的 `auto_deny` 规则必须
  排在 `ask_all` 生成的 `require_approval`/匹配规则**之前**（`policy.ts:43-46` 的既定约定，
  `ApprovalRule` 是有序数组）。否则 allow/require 规则可能先命中，挡不住 deny。
