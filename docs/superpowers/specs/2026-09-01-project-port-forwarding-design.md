# 项目级端口转发（preview 驱动自动公网映射）设计

- 日期：2026-09-01
- 状态：已批准（用户逐节确认）
- 涉及仓库：AliangVibeCodingPhone（手机）、AliangPhoneServer（服务端）。**agent（alianggate）与 AliangTunnelGateway 零改动。**

## 1. 背景与问题

端口转发/短网址隧道四层链路（手机 → PhoneServer → alianggate agent → Piko/网关）已端到端验证可用，但手机侧唯一入口是**设备级**的 PortMappingsScreen（设备详情 → 公网端口），需要用户手工填写 host/port。创建会话页（CreateVibeCodingScreen）的「端口映射」开关自 2026-07-31 起一直是纯装饰占位（`CreateVibeCodingScreen.tsx:761`，opacity 0.4、无 handler、「即将支持」chip）。

根本约束：**创建会话那一刻，AI 还没运行，没人知道 dev server 会监听哪个端口**——所以「创建时建映射」不可行。而 agent 已有 preview 检测链路：AI 会话中起 dev server 后，agent 上报 `preview.ready{port, short_url, target_url}`（agent 本地地址，非公网）。

## 2. 目标 / 非目标

**目标**
1. 创建页开关变真功能：打开后，该会话内 agent 检测到 preview 端口时，server 自动为其建立真公网映射（复用现有 tunnel 链路），并把公网地址推给手机展示。
2. 公网地址在会话页 preview 卡片可直接复制/浏览器打开/手动撤销。
3. 映射生命周期：固定 24h 有效期 + 手动撤销；agent 重发同一端口不重复建映射。

**非目标**
- 不做自动重试（失败后手动兜底路径已存在：设备详情 PortMappings 手动建）。
- 不做用户自选有效期（固定 24h）。
- 不做 pause/resume 语义。
- 不打通 agent 本地 short_url 与公网映射以外的 preview 能力（preview 链路其余行为不变）。

## 3. 已定决策（用户拍板）

| 决策点 | 结论 |
|---|---|
| 建立时机 | preview.ready 到达时自动建（server 钩子），不在创建时建 |
| 生命周期 | 固定 24h TTL + 手动撤销，不跟随会话关闭 |
| 逻辑归属 | server 钩子（不依赖手机在线；映射↔会话关联服务端权威） |

## 4. 总体架构

```
创建页开关(会话级标记 exposePreviewPort)
  └─draftConfig→ 聊天页首条消息 → createAiSession{expose_preview_port:true}
                                      └→ AiSession.exposePreviewPort = true（持久化）

AI 运行中 agent 检测到 dev server 端口
  └→ WS preview.ready{session_id, port, short_url, ...}
       └→ server handlePreviewReady（现状：upsert PreviewLink + WS 推手机）
            └→【新钩子 fire-and-forget】会话标记开 && port>0：
                 ensureAgentTunnel(deviceId)                    // 已有，35s 栅栏
                 gatewayClient.createPortMapping({             // 已有
                   target_host:'127.0.0.1', target_port:port,
                   kind:'http', expires_in_seconds:86400 })
                 ├─ 成功 → PreviewLink{publicUrl, portMappingId, mappingStatus:'mapped'}
                 └─ 失败 → PreviewLink{mappingStatus:'failed'|'unavailable', mappingError}
                 两种结果都 upsert + WS 推「preview.updated」
```

数据面访问不变：公网 `{slug}.{PUBLIC_BASE_DOMAIN}` → 网关 → Piko → agent → `127.0.0.1:port`。

## 5. 组件改动明细

### 5.1 Server（AliangPhoneServer）

**a. 会话标记贯通 + 持久化**
- `AiSession` 类型加 `exposePreviewPort?: boolean`（`server/src/types.ts`）。
- createAiSession 请求 schema 加 `expose_preview_port: z.boolean().optional().default(false)`（路由创建 handler 处）。
- sqlite + postgres `ai_sessions` 各加一列（`expose_preview_port INTEGER DEFAULT 0` / `BOOLEAN DEFAULT FALSE`），读写 mapper 同步；照 `approval_scheme` 列的既有加列先例。

**b. 新模块 `server/src/modules/tunnel/previewMapping.ts`**
- `PREVIEW_MAPPING_TTL_SECONDS = 86_400`。
- `autoMapPreviewPort(session, link)`：
  1. 守卫（任一不满足 → `mappingStatus:'unavailable'`，`mappingError` 记原因码）：`requireTunnelConfig()` 完整性通过（control.ts:30，= enabled && pikoUpstreamUrl && routePublicKey；**不要用 `resolveTunnelConfig()` 判定**——它恒返回合并对象、从不抛错，当判据会恒真）；`isAgentConnected(deviceId)`；device.capabilities 含 `http_tunnel_v1` 且 `websocket_tunnel_v1`；`link.port > 0`。
  2. 去重：已存在同 `(userId, sessionId, port)` 且 `mappingStatus==='mapped'` 的 PreviewLink → **先经 `gatewayClient.getPortMapping(id)` 复核**（已有导出；网关 404 以 **thrown `ApiError(404,'port_mapping_not_found')`** 表达，catch 须针对该错误码，而非 falsy 返回值）：网关仍返回映射 → 复用其 publicUrl/mappingId 不重建；404 ⇒ 该映射已被撤销或过期 → 视同无映射，走新建。服务端 `mappingStatus` 不作为「网关侧仍存活」的充分证据（手机撤销、自然过期都会造成服务端状态滞后）。
  3. 组合方式镜像既有 `POST /api/port-mappings` handler（`routes/portMappings.ts:38`：`ensureAgentTunnel(device)` → `createPortMapping(resolveTunnelConfig(), {...})`）；实现计划必须沿用真实签名：`ensureAgentTunnel(device: Device, options?)`、`createPortMapping(config, {userId, deviceId, targetHost, targetPort, kind, expiresInSeconds})`（文中 `{127.0.0.1:port}` 为语义示意）。
  4. `await ensureAgentTunnel(device)`（复用 control.ts，内含并发去重与 35s 等待）。
  5. `await createPortMapping(...)`（gatewayClient.ts，targetHost 恒 `127.0.0.1`——agent 侧白名单对 loopback 恒放行；e2e 冒烟覆盖）。
  6. 结果写回传入的 link（publicUrl=short_url、portMappingId=mapping.id、mappingStatus），`PreviewLinkRepository.upsert` + `scheduleStateSave` + `publishToMobiles('preview.updated', ...)`。
- 全程 try/catch，绝不向调用方抛错。

**c. `handlePreviewReady` 挂钩**（`modules/agent/handlers/projectDevice.ts:67`）
- 现有逻辑（upsert + preview.ready 推送 + ack）不动；末尾：
  `if (session?.exposePreviewPort) void autoMapPreviewPort(session, link)`（查 `aiSessions.get(session_id)` 且校验 userId/deviceId 归属）。不 `await`，不延迟 `preview.ready.ack`。

**d. PreviewLink 扩展 + 新 WS 事件**
- `PreviewLink` 加 `publicUrl?/portMappingId?/mappingStatus?: 'mapped'|'failed'|'unavailable'|'revoked'/mappingError?`；`publicPreviewLink` 序列化器带出。
- `mappingStatus:'revoked'`：**服务端同步**——既有 `DELETE /api/port-mappings/:mappingId` 路由（`routes/portMappings.ts:112`）在网关撤销成功后，扫描 `previewLinks` 中 `portMappingId === mappingId` 的链接 → 翻 `'revoked'` + upsert + `scheduleStateSave` + `publishToMobiles('preview.updated')`（约 10 行，不新增端点）。手机收到撤销确认后本地同步翻 `'revoked'`（乐观更新，与服务端广播收敛）。这保证刷新/重装后快照权威状态与网关一致，撤销后的卡片不会复活成 mapped。
- 新 WS 事件 `preview.updated{preview}`，载荷形状与 `preview.ready` 相同（`publicPreviewLink` 输出），direction `agent_to_mobile` 语义沿用。

**e. `publicDevice` 加 `tunnelAvailable: boolean`**（`modules/device/serializers.ts`）
- 判据 = `requireTunnelConfig()` 的完整性谓词（enabled && pikoUpstreamUrl && routePublicKey；`resolveTunnelConfig()` 恒成功不可作判据）。供手机把创建页开关精确置灰（能力位只代表 agent 支持，不代表 server 已启用隧道）。

### 5.2 Phone（AliangVibeCodingPhone）

**a. 创建页开关**（`CreateVibeCodingScreen.tsx:761`）
- 占位面板 → 真开关行：复用能力开关行的 optionRow + StatusChip('ON'/'OFF') + TouchableOpacity 模式，state `exposePreviewPort`（默认 false）。
- 门控（不满足则置灰 + 中性提示文案，不禁创建）：
  - `device.tunnelAvailable === true`（server 隧道配置完整）
  - `device.capabilities` 含 `http_tunnel_v1` && `websocket_tunnel_v1`
  - 设备 online
- `handleCreate` 把 `exposePreviewPort` 放进 `draftConfig`。

**b. 类型贯通**
- `VibeCodingSession` 路由参数 draftConfig、`startAgentSession` input 类型加 `exposePreviewPort?: boolean`（聊天页 DraftVibeCoding 透传到首条消息发送）。
- `startAgentSession` 的 `createAiSession` payload 加 `expose_preview_port: input.exposePreviewPort === true`。

**c. platformTransport**
- WS 消息联合类型加 `preview.updated`；处理分支与 `preview.ready` 相同管道（normalize + 合并进 previewLinks 快照）。`PlatformPreviewSnapshot` 加 `publicUrl?/portMappingId?/mappingStatus?/mappingError?`。
- 设备快照类型与 normalize 路径（`platformTransport.ts` 设备归一化处）显式带上 `tunnelAvailable?: boolean`（配合 5.1e，供创建页门控读取）。

**d. 会话页 preview 卡片**（`VibeCodingSessionScreen.tsx` preview 卡）
- `publicUrl` 存在：显示「公网」徽标 + 「复制」「打开」按钮（Clipboard/Linking，手法同 PortMappingsScreen MappingCard），原 agent 本地 shortUrl 展示保留。
- `mappingStatus==='failed'|'unavailable'`：卡片底部一行中性提示（含可读原因），不阻塞、不显红（无 error 语义冲突）。
- `mappingStatus==='mapped'`：卡片加「撤销」入口（Alert 确认 → 既有 `revokePortMapping(portMappingId)` → 本地翻 `'revoked'`）。撤销只影响公网映射，agent 本地 shortUrl 不动。
- `mappingStatus==='revoked'`：徽标置灰「已撤销」，**移除复制/打开/撤销按钮**（此前已复制出去的链接在网关侧到期前仍可解析，属用户自持行为；卡片不再提供入口）。

**e. i18n**：`vibecoding` 命名空间 zh/en 补键：开关标题沿用 `createScreen.permissions.portMapping.title`，新增 hint（开/关/置灰三种）、preview 卡公网徽标、复制/打开/撤销、失败提示、已撤销。沿用现有 key 组织方式。

### 5.3 Agent / 网关
零改动。映射即普通设备级映射，自动出现在 PortMappingsScreen 列表（无需新列表 UI）。

## 6. 错误处理与边界

| 场景 | 行为 |
|---|---|
| 隧道未配置（ALIANG_TUNNEL_* 缺失/禁用） | 创建页开关置灰（tunnelAvailable=false）；若运行中配置被改坏 → 钩子守卫拦下，`unavailable` |
| agent 离线 / 能力缺失 | `unavailable` |
| ensureAgentTunnel 超时（35s）/ 409 | `unavailable`，mappingError=原因码 |
| 网关 5s 超时 / 4xx / 5xx | `failed`，mappingError=错误文案 |
| agent 重发同 session+port | 去重复用，不重建（复用前经网关复核存活；已撤销/已过期 ⇒ 重建） |
| 手机撤销某映射后刷新/重进 | 服务端已同步翻 revoked（DELETE 路由联动），快照权威一致，卡片不复活成 mapped |
| 撤销后 agent 重报同端口（dev server 重启场景） | 去重复核发现网关 404 → 新建映射，新链接推 preview.updated |
| 同会话多端口（3000 与 8080） | 各建各的映射 |
| port 缺失或 0 | 跳过（`unavailable`，原因 port_missing） |
| 老会话（无标记） | 行为零变化 |
| preview.ready 先于 WS 推送到达手机、钩子后完成 | `preview.updated` 事件补推；手机重进/下拉刷新也能从快照拿到（PreviewLink 持久化） |

## 7. 测试策略（TDD）

**Server（vitest）**
- `previewMapping` 单测：标记关不建 / 成功写 publicUrl+推 preview.updated / 隧道不可用→unavailable / 网关失败→failed / 同 (session,port) 去重 / 去重复核网关 404→重建 / port=0 跳过。
- DELETE 联动单测：网关撤销成功后，portMappingId 匹配的 PreviewLink 翻 'revoked' + 推 preview.updated；不匹配的链接不受影响。
- schema + 持久化 roundtrip：createAiSession 带 `expose_preview_port` → 存库 → 重启读回。
- `publicDevice` tunnelAvailable：配置完整 true / 缺一项 false。

**Phone（jest）**
- 创建页：开关门控（能力缺失/离线/tunnelAvailable=false 置灰）、toggle 交互、handleCreate 透传。
- startAgentSession payload 断言 `expose_preview_port`。
- platformTransport：preview.updated merge 进 previewLinks。
- preview 卡：publicUrl 徽标/复制/打开/撤销；failed 提示行；revoked 态。

**冒烟**：`AliangPhoneServer/scripts/tunnel-e2e.mjs` 追加一段——createAiSession 带 expose_preview_port → fake agent 发 preview.ready → 断言网关建映射 + preview.updated 推达 + 公网 URL 可命中。

## 8. 发布与回滚

- 三端独立部署安全：server 先上（字段向后兼容，缺标记=零行为）；phone 后上（旧 server 无 preview.updated/字段时 UI 不显示公网元素，`mappingStatus` undefined 视同无映射）。
- 回滚 = 还原开关默认关；已建映射按 24h 自然过期或经 PortMappingsScreen 手动撤销，无需数据清理。
