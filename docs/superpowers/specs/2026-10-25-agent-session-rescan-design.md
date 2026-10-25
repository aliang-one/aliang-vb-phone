# 项目会话列表「重扫电脑」功能设计

- 日期:2026-10-25
- 状态:已确认(方案 A,三端打通)
- 范围:手机端(AliangVibeCodingPhone)+ server(AliangPhoneServer)+ 桌面 agent(alianggate)
- 入口决策:项目内两处(项目详情页会话预览区 + AgentSessionsScreen);全局列表本轮不做
- 交互决策:触发 + 轮询确认;AgentSessionsScreen 的下拉手势直接 = 重扫

## 1. 背景与问题

用户在电脑 TUI(claude code)新开一个会话后,手机上对应项目的会话列表常常看不到它。

现状链路(已核实):

1. **agent**(alianggate,`agent_remote_ws.go`):10s digest 循环对 Claude 项目索引、pid rename 记录、codex 文件、原始 JSONL(path+mtime+size)做指纹(`agent_vibe_digest.go:27`);指纹变化立即推 `agent.hello`(带全量 `vibe_sessions`),另有 60s 周期兜底 hello。
2. **server**(AliangPhoneServer):收到 hello → `upsertReportedVibeSessions` → 内存 + DB → 向手机推 `ai.sessions.updated`。
3. **手机**:`useProjectSessions` 仅在 focus 时 fetch 一次 `/api/projects/:id/ai-sessions`;该接口**纯读 server 内存库,不问 agent**(`routes/projects.ts:368`)。

两个缺口:

- **AgentSessionsScreen 没有下拉刷新**,不重新 focus 就不重取;停留页面时新会话不会自己出现。
- **没有「手机→server→agent 立即重扫」的按需通道**。agent 的 WS 入站消息表(`agent_remote_ws.go:643` handleRemoteAgentMessage)没有任何"请立刻重扫并上报"指令;agent 只按自己的节奏(10s digest / 60s 兜底)推。agent 没推上来时(掉线中、digest 未翻转、scanDirs/路径过滤),手机端无论怎么刷都是旧数据。

## 2. 目标

- 手机上,在项目详情页与项目会话列表页,可以主动触发电脑端 agent 立即扫描并上报会话列表。
- 触发后有明确的进行中反馈,新会话到达即确认,不无限等待。
- 复用既有生产验证的上报通道(agent hello → upsert → ai.sessions.updated),不新建第二套上报协议。

非目标(YAGNI):

- 全局 VibeCoding 列表页 / 设备级 AgentSessions 的重扫入口(本轮不做,机制可平移)。
- 手机端消费 `ai.sessions.updated` WS 事件自动重取列表(将来可选增强)。
- 解决"agent 为何没推上来"的根因(scanDirs 过滤、项目路径不匹配)——重扫能力同时是排查手段,根因另行排查。

## 3. 方案选择

**方案 A:WS 轻推指令 + 复用 hello 上报通道(选定)**

- server 新增 endpoint,向设备 agent 的 WS 连接写一条新消息 `{type:"agent.inventory.refresh"}`。
- agent 收到后直接调用现成的 `sendAgentHello(writeJSON, "server_requested")`——这条路径本身就是"扫描 + 全量上报",幂等;hello 的 upsert/推送链路零改动。
- agent 端改动约 10 行;server 端一个薄 endpoint。

**方案 B:请求-响应式 `agent.inventory.collect`**(否决):agent 收集完把 `vibe_sessions` 作为响应直接回 server。优点是 server 确切知道完成时刻;但冷转录扫描实测可达 30s+(alianggate `agent_handler.go:22-25` 记录的 liang-dev 事故),同步等待会撞 server 控制面超时,且与已有 hello upsert 通道重复建设。手机端已定为"触发+轮询",不需要完成回执。

**方案 C:server 调 agent 本地 HTTP `POST /api/agent/sync`**(不可行):agent 在 NAT 后,只有出站 WS,server 无法直连 agent HTTP。

## 4. 三端改动

### 4.1 agent(alianggate)

`app/http/services/agent_remote_ws.go` 的 `handleRemoteAgentMessage` 新增 case:

- 消息类型:`agent.inventory.refresh`(常量加到 `models` 事件类型处,与既有事件并列)
- 处理:`s.setRemoteConnectionState(true, "online", "")` + `s.sendAgentHello(writeJSON, "server_requested")`
- 同步执行,与 digest 变更推送同路径;失败仅记日志,不断连接(与 `vibe_digest_change` 分支同语义)
- 离线设备门控(`remoteAgentMessageRequiresEnabledDevice`):重扫属于只读动作,不加入需要 enabled 的名单,与既有 hello 类流量一致

### 4.2 server(AliangPhoneServer)

`server/src/modules/routes/projects.ts` 新增:

- 路由:`POST /api/projects/:projectId/ai-sessions/refresh`
- 流程:`requireUserId` → `getAccessibleProjectOrThrow` → 取项目所属 device → 检查 agent 连接状态(离线 → `409 agent_offline`)→ 向 agent WS 写 `{type:"agent.inventory.refresh"}` → 立即响应 `{status:"requested"}`(**不等待** agent 回 hello)
- 发送方式:fire-and-forget 写 agent 连接(不使用 `requestAgentPayload` 的请求-响应机制,理由见方案 B 否决理由)
- 审计:`rememberAudit({ eventType: 'project.ai_sessions.rescan', ... })`

hello 回来后,既有链路(`agent.hello` → upsert → `ai.sessions.updated` 推手机)零改动。

### 4.3 手机(AliangVibeCodingPhone)

**API 层**(`src/api/projects.ts`):

```ts
export const refreshProjectAiSessions = (projectId: string): Promise<{ status: string }> =>
  apiPost(`/api/projects/${projectId}/ai-sessions/refresh`, {});
```

**重扫 hook**(`src/hooks/useSessionRescan.ts`,新文件):

- 签名:`useSessionRescan(projectId: string | undefined)` → `{ rescanning: boolean; rescan: () => Promise<RescanOutcome> }`
- `rescan()` 流程:
  1. 记录触发前的 `total_count` + 最新 session 的 `id`/`last_active_at` 快照(线字段名以 `publicAiSessionSummary` 下发的 `last_active_at` 为准;`updated_at` 在本仓库特指 agent 文件时钟,server 有意不下发,勿混用——2026-10-15 时钟污染修复)
  2. 调 `refreshProjectAiSessions`;`409 agent_offline` → 直接返回 `agent-offline`,不发轮询
  3. 轮询 `fetchProjectAiSessions(projectId)`(照搬 `ProjectScanScreen.handleScan` 的 startCount/poll 模式):判定"变化" = `total_count` 增大 或 出现新的 session id 或 最新 `last_active_at` 变新
  4. 轮询节奏:首拍 1.2s,共最多 6 拍(~8s 封顶);任一拍检测到变化即返回 `updated`
- **数据流单源**:hook 只负责触发/轮询/变化判定,不持有第二份会话列表状态;每拍(至少收尾拍)驱动屏幕既有的 `useProjectSessions.reload()` 刷新列表——避免双状态源闪烁/失同步
- 轮询循环与"变化判定"抽为纯函数(如 `resolveRescanTick`)放 `src/screens/vibecoding/`(与 `sessionRefreshDispatch.ts` 同模式),便于 jest 钉测试
- 超时:返回 `timeout`,由调用方 toast;hook 内部最后做一次 reload 保证最终态

**AgentSessionsScreen**(`src/screens/vibecoding/AgentSessionsScreen.tsx`):

- FlatList 加 `RefreshControl`:`refreshing = rescanning`,`onRefresh = rescan`
- 设备离线(仅当 `route.params.deviceId` 指定且该设备 offline)时:`rescan` 前置短路,直接 toast 离线错误(照 `ProjectScanScreen` + `describeDeviceError` 先例),不发请求
- 项目 scoped(有 projectId)与全局/设备 scoped 都渲染 RefreshControl;无 projectId 时(全局视图,数据源是 store)`onRefresh` 退化为普通 `refreshFromServer` 重取(不做重扫,范围外)

**ProjectDetailScreen** 会话预览区:

- 小重扫按钮(图标按钮,复用现有 IconBadge/GlowButton 风格):扫描中显示 ActivityIndicator,逻辑同 hook
- 不动该屏已有的下拉/其他刷新绑定,避免回归

**文案**:中英文案各加 3 条(rescanning 进行中 / 成功到达 / 超时提示),走 `vibecoding` 命名空间,与现有 i18n 模式一致。

## 5. 数据流(触发一次的完整时序)

```
手机: 点下拉/按钮
  → POST /api/projects/:id/ai-sessions/refresh
server: 鉴权 → 检查 agent 在线 → WS 写 {type:"agent.inventory.refresh"} → 200 {status:"requested"}
agent:  handleRemoteAgentMessage → sendAgentHello(reason="server_requested")
        (collectClaudeVibeSessions + collectCodexVibeSessions 全量扫描)
  → WS agent.hello {vibe_sessions:[...]}
server: upsertReportedVibeSessions → publish ai.sessions.updated(现有链路,零改动)
手机:   轮询 GET /api/projects/:id/ai-sessions → 检测到 total_count/last_active_at 变化 → 停表,UI 确认
```

## 6. 错误处理

| 场景 | 行为 |
| --- | --- |
| 设备离线(agent 断连) | server 返回 409 `agent_offline`;手机不发轮询,toast 离线提示 |
| refresh 请求网络失败 | toast 失败;不轮询 |
| 轮询超时(~8s 无变化) | 最后 reload 一次;toast "电脑响应较慢,稍后下拉重试" |
| agent 在线但重扫后仍无该会话 | 属于根因(路径不匹配/scanDirs 过滤);超时提示已覆盖,不掩盖也不误报成功 |
| 触发时已在轮询中 | hook 内部去重(进行中直接复用同一轮询,不叠加) |

## 7. 测试

- **手机 jest**:`resolveRescanTick` 纯函数用例(无变化继续轮 / count 增长停 / updated_at 变新停 / 达上限超时);hook 用例(去重、409 短路);AgentSessionsScreen 现有测试回归
- **server vitest**:新路由——鉴权失败 401、项目不可达 404、agent 离线 409、在线时向 agent 连接写出正确消息体并 200
- **agent go test**:`handleRemoteAgentMessage` 新 case 触发 `sendAgentHello` 且 reason=`server_requested`;连接不断开
- **手工验证**(部署后):liang-dev TUI 开新会话 → 手机项目页下拉 → ~数秒内出现;agent 停掉时下拉 → 离线提示

## 8. 部署顺序

依赖方向:agent 收新指令 → server 发新指令 → 手机调新 endpoint。旧版本互相兼容(新消息类型对旧 agent 是未知类型,走 default 分支忽略;旧 server 不会发;旧手机不会调)。

1. agent(alianggate)先发——收到新指令才会响应
2. server(AliangPhoneServer)次之——开始发指令
3. 手机端随下个 TestFlight/APK 版本——开始调用

各端单独回滚均安全。

兼容性注:旧版 agent 收到未知类型 `agent.inventory.refresh` 会回一帧 `agent.event.error`("unsupported remote agent event type");server 对无 `request_id` 的错误帧没有可匹配的 pending 请求,记录后丢弃——结论不受影响,新指令只由新 server 发出。
