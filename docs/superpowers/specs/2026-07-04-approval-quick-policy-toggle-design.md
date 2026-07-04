# 审批卡片「更多」快速策略切换 — 设计文档

**日期**: 2026-07-04
**范围**: 手机端 (`AliangVibeCodingPhone`) + 服务端 (`AliangPhoneServer`)。Go agent **零改**。
**状态**: 设计待评审

---

## 1. 背景与动机

vibecoding 会话等待审批时，用户每次都得手点 APPROVE。项目级审批策略虽有 3 档
(`balanced` / `allow_all` / `custom`)，但要切档得离开会话去**项目设置**页，路径太长。

用户希望在会话页审批卡片上**就地快速切档**：

- **全部放行** → `allow_all`：该项目一切自动放行（含未知工具、MCP、危险 bash）。
- **通用放行** → `custom` + `default_decision=auto_approve`：万物皆过，**只拦危险 bash**
  （`rm -rf` / `sudo` / `git push` 等仍需审批）。覆盖 MCP 及一切未匹配工具。
- 切换后**顺手把当前这张 pending approval 也放行掉**。
- 顶部小角标提示当前模式，可一键恢复「按需审批」(`balanced`)。

## 2. 关键约束（已坐实）

- `project_custom_templates` 表**已存在 `default_decision` 列**（`database.ts:872`），
  且 `resolveProjectApprovalPolicy` 已把 custom 模板的 `default_decision` 透出（`:904`）。
  → 服务端只需让写入路径接受 override，**读取/解析/agent 求值链路全已就绪**。
- agent 通过 `resolveProjectApprovalPolicyByPath` 拉取 resolved policy 后**本地按
  `rules` 优先、`default_decision` 兜底**求值。MCP 等无规则命中的工具落到
  `default_decision` → 设成 `auto_approve` 即自动放行。**agent 无需改、无需重编**。
- `custom` 模板的规则从 balanced 模板复制；balanced 已把 `dangerous-bash` 设为
  `require_approval`。通用放行**不改规则、只覆盖 default_decision**，故危险 bash 天然保留拦截。
- 手机 `VibeCodingSessionScreen` 已能拿到 `session.projectId` + `project`，可直接调
  `updateProject(projectId, { approval_policy: {...} })`。

## 3. 服务端改动（`AliangPhoneServer`）

### 3.1 `server/src/schemas.ts`
- `projectApprovalPolicySettingsSchema` 增字段：
  `custom_default_decision: approvalDecisionSchema.optional()`
- `projectCustomPolicyOverridesSchema` 增字段：
  `custom_default_decision: approvalDecisionSchema.optional()`，
  并把 `custom_rule_overrides` 改为 `.optional()`（仅覆盖 default 时可不传规则覆盖）。

### 3.2 `server/src/database.ts` — `upsertProjectCustomTemplate`
签名加一个可选参数：
```ts
upsertProjectCustomTemplate(
  projectId: string,
  base: ApprovalPolicy,
  ruleOverrides?: Record<string, ApprovalDecision>,
  defaultDecisionOverride?: ApprovalDecision,   // ← 新增
): ApprovalPolicy
```
构造 `policy.default_decision` 时：`defaultDecisionOverride ?? base.default_decision`。
（INSERT 语句已写 `default_decision` 列，无需改表结构。）

`resolveProjectApprovalPolicy` **不改**：已正确透出 custom 模板的 `default_decision`。

### 3.3 `server/src/modules/routes/projects.ts`
- `PATCH /api/projects/:id`（~`:199-225`）：当 `ap.custom_default_decision` 存在时，
  透传给 `upsertProjectCustomTemplate` 的第 4 参。注意仅当 `scheme==='custom'`
  分支才走 upsert；切到非 custom 时不变（override 自然失效，因为读的是 custom 模板行）。
- `PATCH /api/projects/:id/approval-policy/custom`（~`:503`）：把
  `input.custom_default_decision` 透传给 `upsertProjectCustomTemplate`。
- audit metadata 增记 `custom_default_decision`。

### 3.4 测试
- `server/test/modules/approval/policy.test.ts`（或新建）：`upsertProjectCustomTemplate`
  带 `defaultDecisionOverride='auto_approve'` → resolved policy 的 `default_decision`
  为 `auto_approve`，且 balanced 的 `dangerous-bash` 规则仍 `require_approval`。
- 路由测试：PATCH custom 带 `custom_default_decision` 后，GET approval-policy 回读一致。

## 4. 手机端改动（`AliangVibeCodingPhone`）

### 4.1 `src/api/projects.ts`
- `updateProject` 的 `approval_policy` 入参增 `custom_default_decision?: ApprovalDecision`。
- `patchProjectCustomPolicy` 增可选参 `defaultDecision?: ApprovalDecision`，
  body 字段 `custom_default_decision`；`customRuleOverrides` 改可选。

### 4.2 新组件 `src/components/vibecoding/ApprovalQuickPolicySheet.tsx`
- 基于 `BottomSheet`。props：`projectId`、`approvalId`（当前要顺带放行的卡）、`open`、`onClose`。
- 打开时调 `fetchProjectApprovalPolicy(projectId)` 拿当前 resolved policy，计算 `currentMode`：
  - scheme `allow_all` → `'allow_all'`
  - scheme `custom` 且 `default_decision==='auto_approve'` → `'common_auto'`
  - scheme `balanced` → `'balanced'`
  - 其它（custom 但被手动调过 default） → `'custom_other'`
- 三行操作（radio 高亮 currentMode）：
  1. **全部放行** → `applyAllowAll`
  2. **通用放行（万物皆过·只挡危险命令）** → `applyCommonAuto`
  3. **按需审批（恢复默认）** → `applyBalanced`
- 每行带一句副文案说明语义。
- loading / error 态：切换中显示 spinner，失败 toast「策略切换失败，请重试」。

### 4.3 `src/screens/vibecoding/VibeCodingSessionScreen.tsx`
- `renderApprovalCard` 的两个动作区（option-choices 变体 + 简单 APPROVE/DENY 变体）
  各加一个「更多 ⋯」按钮（`GlowButton variant="outline"` 或图标钮），与 APPROVE/DENY 同行。
  `disabled` 条件同 APPROVE/DENY（`deviceOffline` / 正在 resolving 别的）。
- 新 state：`quickPolicyFor: { approvalId: string } | null`。
- 点「更多」→ set `quickPolicyFor`。`ApprovalQuickPolicySheet` 据此渲染。
- 三个 apply handler（在 screen 内，复用现有 `handleResolveApproval` 与 `updateProject`）：
  - `applyAllowAll`：`updateProject(projectId, { approval_policy: { scheme: 'allow_all' } })`
    成功后 → `handleResolveApproval(currentApprovalId, 'approved')` → 关 sheet。
  - `applyCommonAuto`：`updateProject(projectId, { approval_policy: { scheme: 'custom', custom_default_decision: 'auto_approve' } })`
    成功后 → approve 当前 → 关 sheet。
  - `applyBalanced`：`updateProject(projectId, { approval_policy: { scheme: 'balanced' } })`
    → 关 sheet（**不顺带 approve**，balanced 仍要逐张审批）。
- 顶部小角标：当 `project.approvalScheme !== 'balanced'` 时，在会话顶部状态条附近显示
  「已开启：全部放行 / 通用放行 / 自定义」chip（用 `project.approvalScheme` 推断；
  custom+unknown 显示「自定义」），点击可打开同一 sheet。**首版可只做 sheet 内 radio，
  顶部 chip 作为可选 polish**——若改动过大则放到后续。

### 4.4 i18n
- 在 `session` 命名空间（英文默认 + 中文）加 key（遵循 [[app-i18n-i18next-setup]]）：
  - `session.approval.moreActions`（「更多」按钮 a11y label）
  - `session.approval.quickPolicy.title`
  - `session.approval.quickPolicy.currentLabel`
  - `session.approval.quickPolicy.allowAll.title` / `.hint`
  - `session.approval.quickPolicy.commonAuto.title` / `.hint`
  - `session.approval.quickPolicy.balanced.title` / `.hint`
  - `session.approval.quickPolicy.applyFailed`
- jest 锁 `zh`（见 [[app-i18n-i18next-setup]]），确保中文测不被破。

### 4.5 测试
- `ApprovalQuickPolicySheet` 组件测：渲染三档、radio 高亮 currentMode、点击触发对应
  `updateProject` 调用（mock platformTransport）+ 顺带 approve（仅 allow_all/commonAuto）。
- `VibeCodingSessionScreen`：「更多」按钮在 pending 且可 resolve 时出现、deviceOffline 时禁用。

## 5. 数据流（通用放行为例）

```
用户点「更多」→ ApprovalQuickPolicySheet 打开 → GET /projects/:id/approval-policy 渲染当前档
用户点「通用放行」
  → PATCH /api/projects/:id  body { approval_policy: { scheme:'custom',
                                    custom_default_decision:'auto_approve' } }
  → 服务端: project.approvalScheme='custom'; upsertProjectCustomTemplate(base, {}, 'auto_approve')
           → 新 custom 模板行 (default_decision='auto_approve', rules=balanced 的 4 条)
  → resolveProjectApprovalPolicy → hash 变 → publishToAgent(project.settings.updated)
  → agent 下回合前重拉 policy → MCP/未匹配工具落 default=auto_approve → 自动放行
  → 手机侧同时 handleResolveApproval(currentId,'approved') → 当前这张立即放行
  → 关 sheet
```

## 6. 边界与决策

- **只顺带放行「当前这张」**：用户原话「连这张一起放行」。同会话其它已 pending 的审批不自动处理
  （它们已 escalate，policy 改动不影响已发的审批）；用户可逐张点，或后续做「放行全部 pending」变体。
- **切换失败处理**：策略切换失败 → 不 approve、不关 sheet、显示错误。approve 失败但策略已切 →
  报错但策略保留（用户可手点 APPROVE）。
- **deviceOffline**：「更多」按钮禁用（与 APPROVE/DENY 一致）。
- **与现有 `CustomApprovalRulesSheet`（开关微调）共存**：本特性是「一键切档」快通道，
  不替换详细编辑器；项目设置页的细调入口保留。「通用放行」本质就是把 default_decision
  设为 auto_approve 的一种 custom 预设，用户事后仍可在开关微调里继续调。
- **agent 兼容**：旧 agent 二进制本就按 `default_decision` 求值，无需重编即可生效
  （policy 经 WS project.settings.updated 推送，agent 60s 内或下回合前重拉）。

## 7. 不做（YAGNI）

- 不加会话级临时覆盖（用户确认项目级持久即可）。
- 不动 device-level 旧 schema（已是 legacy，project-scoped 取代）。
- 不改 Go agent（零改）。
- 不加「放行全部 pending」（首版只放行当前这张）。
- 顶部 chip 首版可省略（sheet 内 radio 已足够示意当前档）。

## 8. 验收

- 服务端：`tsc -0`、vitest 全绿（含新 default_decision override 用例）。
- 手机：`tsc -0`、jest 全绿（含新 sheet 测、不破 i18n zh 锁的中文测）。
- 真机：rebuild APK 后，会话审批卡点「更多」→「通用放行」→ 当前卡消失 + 之后 MCP/常规
  操作不再弹审批；切回「按需审批」恢复正常；危险 bash 在「通用放行」下仍弹审批。
