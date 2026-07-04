# MCP 分级放行(`__` 命名空间)— 设计文档

**日期**: 2026-07-04
**范围**: 手机端 (`AliangVibeCodingPhone`) + 服务端 (`AliangPhoneServer`)。**Go agent 策略逻辑零改**(仅依赖它已在发的 `tool_name`)。
**依赖前置**: agent 的 `ai.approval.request` 必须带原始 `tool_name`(如 `mcp__serena__find_symbol`)。服务端 `handler.ts:630` 已在读该字段 → 大概率已发;**真机抓一条 MCP 审批确认**是开工第一步。
**状态**: 设计待评审

---

## 1. 目标

MCP 工具名按 `__` 分层:`mcp__<server>__<method>`(如 `mcp__serena__find_symbol`、`mcp__chrome-devtools__click`)。利用这个结构,在 MCP 审批弹出时给用户**分两级一键放行**:

- **放行所有 MCP** → 前缀 `mcp__`(所有 server)
- **放行 `<server>`** → 前缀 `mcp__<server>__`(单个 server,如 `mcp__serena__`)
- 外加已有的 **全部放行**(`allow_all`,一切)

选完即:① 当前这张立即放行 ② 项目存下前缀 ③ 之后该前缀的 MCP 调用**在服务端拦截自动放行,不再推手机**。

## 2. 为什么是服务端拦截(而非 agent 本地求值)

agent 在 balanced 下对未匹配工具(MCP 不命中任何规则)按 `default_decision=require_approval` **本地决定升级**,再发 `ai.approval.request` 给服务端。两条路让 MCP 不再烦人:

| 方案 | 改动 | 代价 |
|---|---|---|
| **A. agent 本地求值**:把 MCP 前缀塞进 resolved policy,agent 命中前缀就不升级 | Go agent 改匹配逻辑 + 重编二进制 + 三仓镜像 | 每次 MCP 调用零网络开销,但部署最重 |
| **B. 服务端拦截**(本设计):agent 照常升级,服务端在 `ai.approval.request` 入口匹配前缀 → 命中就回 `accept`、不推手机 | 只动服务端 + 手机,**agent 零策略改** | 每次 MCP 调用有一次 agent↔server 往返(与现状任何审批一致,无回归) |

选 **B**:正确性等价、部署最轻、agent 不用重编。agent 仅需保证请求里带 `tool_name`(见依赖前置)。agent 本地求值留作未来性能优化。

## 3. 服务端改动(`AliangPhoneServer`)

### 3.1 数据模型
- `types.ts` `Project` 增字段 `mcpAutoApprovePrefixes?: string[]`。
- `database.ts` / `postgresDatabase.ts`:`projects` 表加列 `mcp_auto_approve_prefixes TEXT`(JSON 数组串,`ensureColumn` ADD COLUMN IF NOT EXISTS)。读写时 JSON.parse/stringify,缺省 `[]`。两库镜像(SQLite 同步、PG 异步同形)。

### 3.2 审批结构透出原始工具名
- `types.ts` `ApprovalRequest` 增 `tool_name?: string`。
- `handler.ts:620` `ai.approval.request` 构造审批时:`tool_name: optionalString(message.tool_name)`(目前它被折进 `summary`,新增独立字段保留;`summary` 仍按原逻辑回退)。
- `publicApproval`(serializers)把 `tool_name` 透到手机。

### 3.3 拦截逻辑(`handler.ts` ai.approval.request 分支)
在 `approvals.set` + `aiApprovalIds.add` + `db.upsertApproval` 之后、`publishToMobiles` 之前插入:

```ts
const toolName = optionalString(message.tool_name);
if (toolName) {
  const session = approval.sessionId ? aiSessions.get(approval.sessionId) : undefined;
  const project = resolveProjectForMcpAutoApprove({
    deviceId: ws.deviceId,
    projectId: message.project_id ?? session?.projectId,
    projectPath: message.project_path ?? session?.projectPath,
  });
  const prefixes = project?.mcpAutoApprovePrefixes ?? [];
  if (prefixes.some(p => toolName.startsWith(p))) {
    // 命中:服务端自动放行,不推手机、不发通知
    approval.status = 'approved';
    approval.resolvedAt = ts;
    scheduleStateSave();
    rememberAudit({ userId: ws.userId, deviceId: ws.deviceId, sessionId: approval.sessionId,
      eventType: 'approval.auto_approved', metadata: { approval_id: approval.id, tool_name: toolName, prefix: matched } });
    aiApprovalDelivery.deliver({ approvalId: approval.id, sessionId: approval.sessionId,
      deviceId: approval.deviceId, userId: ws.userId, decision: 'accept' });
    sendJson(ws, { type: 'ai.approval.request.ack', approval_id: approval.id });
    return; // 跳过 publishToMobiles + createNotification
  }
}
```

- 新 helper `resolveProjectForMcpAutoApprove(...)`:按 projectId 直查,或按 (deviceId, projectPath) 经 `resolveProjectApprovalPolicyByPath` 同款归一化匹配(复用 `normalizeRemotePath`)。
- audit 新事件类型 `approval.auto_approved` 记下命中的 prefix,便于 admin/排障。

### 3.4 API
- `PATCH /api/projects/:id` body 增 `mcp_auto_approve_prefixes?: string[]`(整体覆盖)。
- 新 `POST /api/projects/:id/mcp-auto-approve` `{ prefix: string }`:校验 prefix(必须以 `mcp__` 开头、以 `__` 结尾、长度 ≤ 80、去重、上限 32 条)→ 追加 → bump `updatedAt` + `scheduleStateSave` + `publishProjectState`(让手机刷新)。
- 新 `DELETE /api/projects/:id/mcp-auto-approve` `{ prefix: string }`:移除。
- `schemas.ts` 加 `mcpAutoApprovePrefixSchema`(z.string().regex(/^mcp__[a-zA-Z0-9_-]+__$/))。

### 3.5 测试(`server/test`)
- `policy-resolve`(或新 `mcp-auto-approve.test.ts`):拦截单测 —— mock 一条 ai.approval.request 带 `tool_name='mcp__serena__find_symbol'`、项目存了 `['mcp__serena__']` → 断言不触发 `publishToMobiles`、`aiApprovalDelivery.deliver` 收到 `accept`、approval.status='approved'、audit 记 `auto_approved`。
- 前缀匹配边界:`mcp__` 命中所有 `mcp__*`;`mcp__serena__` 不误命中 `mcp__serena2__`;无前缀时走原推送路径。
- API:POST 加前缀 / DELETE 删 / 校验非法前缀(不以 `mcp__` 开头)被拒。

## 4. 手机端改动(`AliangVibeCodingPhone`)

### 4.1 类型 + 派生函数
- `ApprovalRequest`(`store/types.ts`)增 `tool_name?: string`;`platformModels.ts` + `api/approvals.ts` `ServerApproval` 同步增 `tool_name?`。
- 新纯函数 `src/utils/mcpTiers.ts`:
  ```ts
  // 由 tool_name 派生两级前缀,顺序:server 级在上、all-MCP 级在下。
  export function deriveMcpTiers(toolName?: string): { prefix: string; label: string }[] {
    if (!toolName) return [];
    const parts = toolName.split('__');     // ['mcp','serena','find_symbol']
    if (parts.length < 3 || parts[0] !== 'mcp') return [];
    const server = parts[1];
    return [
      { prefix: `mcp__${server}__`, label: `mcp__${server}__*` },
      { prefix: 'mcp__', label: 'mcp__*' },
    ];
  }
  ```
  导出便于 jest 单测,且全仓无 renderHook(遵循既有判定函数约束)。

### 4.2 UI —— 扩展现有「更多」sheet
`ApprovalQuickPolicySheet`(本次刚加)扩展为**感知 MCP**:
- props 增 `toolName?: string`。
- 打开时,若 `deriveMcpTiers(toolName)` 非空,在「全部放行」下方、通用放行上方插入 N 行(按 tier 数)「放行 `<prefix>*`」。每行:
  - 副文案说明语义(如"之后所有 `mcp__serena__*` 自动放行")。
  - radio 高亮:当前项目 `mcpAutoApprovePrefixes` 含该前缀则高亮(需 sheet 打开时拉一次 `fetchProjectApprovalPolicy` 顺带返回 prefixes —— 见 4.3)。
- 选中 MCP tier → `POST /projects/:id/mcp-auto-approve { prefix }` + `onApplied('mcp')` → 父屏 approve 当前这张 + 关 sheet。
- 非 MCP 审批(`tool_name` 缺或非 `mcp__` 开头):sheet 不显示 MCP 行,退化为现有的 全部放行 / 通用放行 / 逐次审批 三档。

`VibeCodingSessionScreen` 的 `renderApprovalCard` 里把当前 `approval.tool_name` 透给 sheet(`quickPolicyFor` state 增带 `toolName`)。

### 4.3 手机看到 prefixes
- `GET /api/projects/:id/approval-policy` 返回体增 `mcp_auto_approve_prefixes: string[]`(服务端 serializer 加)。
- `fetchProjectApprovalPolicy` 返回类型增该字段;sheet 用它高亮当前已开启的 tier。

### 4.4 i18n(`vibecoding` 命名空间,英+中,jest 锁 zh 不破中文测)
- `session.approval.quickPolicy.mcpTier.title` / `.hint`(带 `{{prefix}}` 插值)
- `session.approval.quickPolicy.mcpAll.title` / `.hint`
- `session.approval.quickPolicy.mcpApplyFailed`

### 4.5 测试
- `mcpTiers.test.ts`:`deriveMcpTiers` 纯函数 —— 正常 `mcp__serena__x` 出两档;`mcp__chrome-devtools__click` 出两档(server=chrome-devtools);`Bash` / 无 / `mcp__serena`(只两段)→ 空。
- `ApprovalQuickPolicySheet.test.tsx` 扩展:传 `toolName='mcp__serena__find_symbol'` → 出现两行 MCP tier;点 server 级 → `POST /projects/:id/mcp-auto-approve` body 含 `prefix:'mcp__serena__'` + `onApplied('mcp')` 触发。

## 5. 数据流(server 端拦截,以"放行 mcp__serena__*"为例)

```
0. 用户在某条 mcp__serena__find_symbol 审批卡点「更多」→ 选「放行 mcp__serena__*」
1. 手机: POST /api/projects/:id/mcp-auto-approve { prefix:'mcp__serena__' }
   服务端: project.mcpAutoApprovePrefixes 追加 → scheduleStateSave → publishProjectState
2. 手机: onApplied → handleResolveApproval(currentId,'approved') → 当前这张放行
3. 之后 agent 跑 mcp__serena__find_symbol,本地 balanced 无规则命中 → 升级 ai.approval.request { tool_name }
4. 服务端 handler: tool_name 命中 project 前缀 'mcp__serena__'
   → approval.status='approved'; aiApprovalDelivery.deliver(accept); 不推手机;audit auto_approved
5. agent 收 ai.approval.response accept → 继续执行
```

## 6. 边界与决策

- **仅 MCP**:`mcp__` 前缀才进 tier 派生。普通工具(Bash/Read/Edit)不出现 MCP 行。Claude/Codex 原生工具名不带 `mcp__`,不受影响。
- **server 名含连字符**:`mcp__chrome-devtools__click` → parts[1]='chrome-devtools'(`split('__')` 不受 `-` 影响)。前缀正则 `^mcp__[a-zA-Z0-9_-]+__$` 允许连字符。
- **更深嵌套**:MCP 工具名恒为 3 段(`mcp__<server>__<method>`),不做第 3 级(用户原话"两层就行")。若将来出现 4 段,派生函数 `parts.length>=3` 仍只取 server 级 + all 级。
- **与通用放行共存**:scheme=allow_all / 通用放行 时,MCP 本就不会升级到手机(前者 default auto,后者 default auto on custom),前缀拦截形同空转,不冲突。前缀功能主要在 balanced 下生效。
- **前缀管理(首版可省)**:加前缀走审批卡;**删前缀**首版暂只支持在项目设置页提供一个列表(或延后)。spec 先标 v2。
- **deviceOffline**:「更多」MCP tier 行禁用条件同 APPROVE/DENY。
- **失败处理**:POST 前缀失败 → 不 approve 当前、提示重试(与现有 sheet 错误处理一致)。
- **不会反向回退**:删 `mcp_auto_approve_prefixes` 不影响已 approved 的历史审批。

## 7. 不做(YAGNI / 留 v2)

- **不做 bash / 命令行模式匹配或复合命令分解**。非 MCP 工具(Bash/Edit/…)一律走现有机制——要么逐次审批,要么用户选「全部放行」(allow_all)一了百了。MCP 之所以单独做,是因为它有干净的 `__` 命名空间、量又大、可识别;bash 命令千变万化,硬分类只会给系统添复杂度(详见决策记录)。
- 不改 Go agent 策略逻辑(服务端拦截足够;agent 本地求值是未来性能优化)。
- 不做第 3 级(单个 method 全名放行)。
- 不做会话级临时前缀(沿用项目级持久)。
- 不做 admin 端前缀管理 UI(手机 + audit 够用)。
- 删前缀 UI 首版可省(项目设置页后续补)。

### 决策记录(2026-07-04):为什么 bash 不做模式匹配
曾考虑给 bash 也做"命令白名单 + 复合命令(`;`/`&&`/`||`/`|`)分解求值",用户明确否决:① 分解 + 逐子命令 safe/dangerous/用户白名单分类,逻辑重、还要 shell-aware tokenizer;② bash 命令形态无限,模式匹配收益低;③ 安全坑大(前缀匹配遇复合命令会误放行 `sleep; rm -rf` 之类)。结论:**MCP 识别值得做,bash 不识别——交给用户用现成的「全部放行」。**

## 8. 前置 / 验收

**前置(开工第一步,验证 agent 发 tool_name)**:
- 真机/日志抓一条 MCP 审批,确认 `ai.approval.request` 的 `message.tool_name` 是 `mcp__<server>__<method>`。若 agent 没发 → 需要小改 Go agent(仅"在请求里带 tool_name",不动策略),那时再单独评估。

**验收**:
- 服务端 `tsc -0`;vitest 全绿(含新拦截测、API 测)。
- 手机 `tsc -0`;jest 全绿(含 mcpTiers + sheet MCP 扩展测,不破 zh 锁)。
- 真机:balanced 下出现 MCP 审批 → 「更多」见两档 MCP tier → 选 server 级 → 当前放行 + 之后同 server 不再弹;切回逐次审批 + 删前缀恢复正常。

## 9. 与既有「全部放行 / 通用放行」的关系

三者并存,覆盖面递减:
- **全部放行**(allow_all):万物皆过,含破坏性命令。
- **通用放行**(custom + default auto):万物皆过,只挡危险 bash。
- **MCP 分级放行**(本设计):只放行 MCP 的某个范围,其它(文件改写/危险 bash)照常审批 —— **最精细**,适合只想"放开 MCP、其它照旧"的场景。
