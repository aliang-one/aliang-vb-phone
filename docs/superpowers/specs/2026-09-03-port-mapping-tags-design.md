# 端口公网映射标签（设备/项目）设计

- 日期：2026-09-03
- 状态：已定稿（经用户逐节确认）
- 涉及仓：AliangVibeCodingPhone（手机端）、AliangPhoneServer（服务端）；AliangTunnelGateway（网关）与 Go agent **零改动**
- 分支：phone `feat/port-mapping-tags`（本 spec 所在分支）；server 实现期另开同名 worktree 分支

## 1. 背景与问题

### 1.1 需求

1. 给每条端口公网映射记录打**标签**：设备级创建的映射带设备标签；项目上下文创建的（含会话自动暴露）带**设备+项目**双标签。
2. 设备视图（现状已有）看到该设备全部映射；新增**项目视图**：项目详情页看本项目标签下的全部映射，并支持在项目内新建（自动带双标签）。
3. 修复创建 vibecoding 页 "Expose preview ports as public links" 开关**永久置灰**的 bug 及该区块样式异常。

### 1.2 置灰根因（已复核）

数据链：server 下发 `tunnel_available`（`AliangPhoneServer/server/src/modules/device/serializers.ts:28`）→ 手机 transport 归一化进 `PlatformDeviceSnapshot`（`src/services/platformTransport.ts:222`）→ **断点**：`platformDeviceToClient`（`src/store/internals.ts:296-352`）拷贝了 `capabilities`（:321）但**漏拷 `tunnelAvailable`** → store 里 `device.tunnelAvailable` 恒 `undefined`。

判定处 `CreateVibeCodingScreen.tsx:142-147` 四条件取与（online + `http_tunnel_v1` + `websocket_tunnel_v1` + `tunnelAvailable`），第四条恒 false → 开关永久置灰 + "Coming soon" chip。测试未发现是因为 `__tests__/CreateVibeCodingScreen.test.tsx:37-38` 手工在 mock Device 上塞字段，绕过了 mapper。

### 1.3 样式异常清单（CreateVibeCodingScreen.tsx）

| # | 问题 | 位置 |
|---|---|---|
| 1 | hint 文字零水平内边距，顶到 1px 边框（`optionPanel: {padding: 0}` 是死样式） | :795-807, :853-855 |
| 2 | 长标题无 flexShrink，窄屏挤压 StatusChip/怪异换行 | :780-782 |
| 3 | "Coming soon" chip 与事实矛盾（功能已上线，禁用真因=离线/隧道未配置） | i18n `createScreen.permissions.portMapping.comingSoon` |
| 4 | `ON`/`OFF` 硬编码英文绕过 i18n | :788-789 |
| 5 | 置灰仅 dim 内层 row（opacity 0.4），面板整体观感不统一；neutral chip 暗色下对比度低 | :779, StatusChip.tsx:35 |

## 2. 现状调查（设计输入）

- **映射真相在网关**：`AliangTunnelGateway/internal/mapping/sqlite.go:99-117` / `postgres.go:93-111` 的 `port_mappings` 表，纯 device 维度（`user_id/device_id/target_host/target_port/status/expires_at/...`），无 project 字段；有保留期清理（`store.go:205` 等）。
- **server 零持久化映射**：`PortMapping` 只是 `gatewayClient.ts:4-17` 的响应类型；路由 `modules/routes/portMappings.ts`：
  - `POST /api/port-mappings`（:39-71，zod 校验 + `getAccessibleDeviceOrThrow` + `ensureAgentTunnel`）
  - `GET /api/port-mappings`（:73-97，**按 user_id 强制**，`?device_id=` 可选过滤）
  - `DELETE /api/port-mappings/:id`（:113-138，撤后调 `revokeLinkedPreviewMappings` 收敛 preview links）
- **server 侧 `preview_links` 表**（`database.ts:701-713` sqlite / `postgresDatabase.ts:600-612` pg）：session 维度，`mapping_state` JSON 列打包 `publicUrl/portMappingId/mappingStatus/mappingError`。仅覆盖"会话自动暴露"路径。
- **会话自动暴露链**：创建开关 `expose_preview_port` 落库（`schemas.ts:78`，列 `database.ts:353`）→ agent `preview.ready`（`projectDevice.ts:72-128`）→ `autoMapPreviewPort`（`modules/tunnel/previewMapping.ts:109-192`，TTL 24h，targetHost 硬编码 `127.0.0.1`）。**agent 目前无 preview.ready 发送端（grep 零命中），此路径休眠中**；设备级手动创建不受影响。
- **手机端**：设备入口 `DeviceDetailScreen.tsx:293-301` → `PortMappingsScreen.tsx`（新建表单 host/port/expiry + detectedPorts 快选 + 列表卡片 + 撤销；列表是本地 `useState`，无 store/无 WS 收敛）。会话侧 `SessionPreviewCard`（公网 URL/撤销，服务端权威收敛）。另有 CommandCenterScreen "RECENT PREVIEWS" 区块（`CommandCenterScreen.tsx:865-929`，全局 `previewLinks`，**未按项目过滤**）与旧版 `PreviewScreen`（未接公网映射字段）。
- **项目概念完备**：`Project`（`platformModels.ts:4-33`，含 `deviceId`/`detectedPorts`）、`VibeCodingRun.projectId` required、路由带 `projectId`。**AiSession 无 projectId，只有 `projectPath`**（`types.ts:520`）；server 创建会话时已做 `(userId, deviceId, path)→project` 三元组解析（`modules/routes/ai.ts:312-323`，找不到且有 path 则建占位项目）。

## 3. 方案取舍

| 方案 | 说明 | 结论 |
|---|---|---|
| **A. server 注解层**（选定） | server 新增 1:1 标注表；设备标签由 `device_id` 推导不存储；网关/agent 零改动；列表=网关在线列表⋈标注表 | 中小成本，影响面收敛在端口域 |
| B. 网关表加 project 列 | 跨仓改 Go（双 schema+internal API+client 类型），把 app 层概念下沉进通用基础设施 | 成本高、污染基础设施，弃 |
| C. 零存储读时推导 | `preview_links`⋈session 按 projectPath 推导 | 只覆盖会话路径，设备手动映射进不了项目视图，弃 |

关键洞察：**所有映射创建都必经 server**（手机创建代理 + preview 自动映射），在 server 打标天然完整；列表走 join，网关保留期清理死映射后标签自然不显示，**不可能复活已死端口**。

## 4. 数据模型（server）

新表 `port_mapping_tags`（sqlite + postgres 镜像，遵循 `server/src/db/` 按域拆分 dao 模式 + primitives private 约定）：

```sql
CREATE TABLE IF NOT EXISTS port_mapping_tags (
  mapping_id   TEXT PRIMARY KEY,   -- 1:1 对应网关映射
  user_id      TEXT NOT NULL,
  device_id    TEXT NOT NULL,      -- 冗余存，方便按设备清理
  project_id   TEXT,               -- NULL = 纯设备级
  project_name TEXT,               -- 快照：项目删除后设备视图仍可显示
  project_path TEXT,
  source       TEXT NOT NULL,      -- 'device_manual' | 'project_manual' | 'session_preview'
  session_id   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_port_mapping_tags_project
  ON port_mapping_tags(user_id, project_id);
```

设计取舍：

- **一个映射最多属一个项目**（PK=mapping_id）：端口对应一个 dev server，物理 1:1；多标签 YAGNI。
- **设备标签不存储**：`device_id` 是映射固有属性，推导即得。
- **项目名/路径存快照**：项目删除后设备视图仍显示"曾属项目"，项目视图按 `project_id` 查询自然为空。
- 读写经 store 门面 + 按域 dao（照 `db/previewLinks.ts` 的 sqlite/postgres 两 dao + class delegate 模式）。

## 5. 打标点与生命周期（server）

三个打标点，覆盖全部创建路径：

1. **`POST /api/port-mappings` 加可选 `project_id`**：zod schema 增加可选字段；若带，校验 `project.userId === userId && project.deviceId === device.id`，通过则 upsert 标注 `{source:'project_manual', project_id, project_name, project_path}`；不带则 upsert `{source:'device_manual'}`（现状行为不变）。
2. **`autoMapPreviewPort`**：映射成功（`commit 'mapped'`）后，若 `session.projectPath` 存在，用 `(userId, deviceId, projectPath)` 三元组解析项目（把 `ai.ts:312-323` 的查找逻辑抽成共享 helper，供两处复用），upsert `{source:'session_preview', session_id}`。agent 休眠期间此路径不触发，基建先就位。
3. **项目删除级联**：project delete 路由顺带 `DELETE ... WHERE project_id = ?`，不留死项目标注。

生命周期规则：

- **打标失败不阻塞创建**：网关映射已建成而标注 upsert 失败时，降级为无项目标（设备标签天然存在），log 记录，创建响应正常返回。
- **撤销/过期**：标注行随映射显示（网关列表含 revoked/expired 状态）；网关保留期清理掉映射后，列表 join 自然不显示，并对孤儿标注行**惰性清理**（列表请求内 fire-and-forget，批量上限，如 ≤200 行/次）。
- 重复打标（同 mapping_id 再创建/复用已有映射）= upsert 覆盖，最后写者胜。

## 6. API 变更（向后兼容）

- `GET /api/port-mappings`：
  - 每条附 `tag: { project_id?: string, project_name?: string, project_path?: string, source: 'device_manual'|'project_manual'|'session_preview', session_id?: string, created_at: string } | null`（`tag.created_at` 是**标注行写入时间**，与映射自身的网关 `created_at` 并列，二者语义不同；拍平进映射对象亦可，实现时二选一，以 serializer 单点出口为准）。
  - 新增 `?project_id=` 过滤：校验 project 归属（`getAccessibleProjectOrThrow` 语义），只返回带该标签的映射（仍按 user 隔离）；与 `?device_id=` 同时携带时取 AND（交集）。
- `POST /api/port-mappings`：body 增加可选 `project_id`。
- 手机 `src/api/portMappings.ts` 类型同步：`PortMapping` 增加可选 tag 字段；`CreatePortMappingInput` 增加可选 `projectId`。
- `publicAiSession`/`publicAiSessionSummary` 不动（会话列表不暴露开关状态，维持现状）。

## 7. 手机端变更

### 7.1 创建页修复（独立可先行，纯 bug fix + 样式）

- `internals.ts` `platformDeviceToClient` 补 `tunnelAvailable: sd.tunnelAvailable,` + **mapper 回归测试**（走真实 mapper 断言字段贯通；改造 CreateVibeCodingScreen 测试不再手塞字段绕过 mapper）。
- 样式修复（对齐 §1.3 清单）：`optionPanel` 给真 padding 并删死样式；标题 `flexShrink`；置灰改整面板统一 dim；chip 文案状态化——删 "Coming soon"，按真实原因显示（设备离线 / 设备不支持 / 隧道未配置）；`ON`/`OFF` 走 i18n；分隔线颜色改主题令牌。

### 7.2 PortMappingsScreen（设备级，小改）

- `MappingCard` 有项目标时显示项目名 chip（来源小标：会话自动/手动，用现有 chip 形态，不新增组件族）。
- 新建表单、探测端口快选、撤销流程均不动。

### 7.3 ProjectDetailScreen 新「公网端口」区块

- **列表**：`GET /api/port-mappings?project_id=<id>` 拉本项目标签下全部映射（会话自动 + 手动统一呈现）；卡片与设备屏共用（把 `MappingCard` 抽成共享组件，两屏消费）；支持撤销（复用 `revokePortMapping` + `Alert.confirm`，本地替换返回的 revoked 记录，与设备屏一致）。项目未绑定设备（`Project.deviceId` 为空）时区块只读展示、隐藏新建入口（创建需要 `device_id`）。
- **新建**：端口从 `project.detectedPorts` 快选；host 默认 `127.0.0.1`；有效期复用 `EXPIRY_OPTIONS`；创建带 `project_id` → 自动设备+项目双标。设备离线/能力缺失时复用设备屏现有 Notice 门控文案。
- **空态**：说明两个来源（会话自动暴露 / 在此手动新建）。
- i18n en+zh 新增 `projects.portMappings.*` 文案。
- **不动**：CommandCenter "RECENT PREVIEWS"、`PreviewScreen`、会话内 `SessionPreviewCard`（后续想吃标签随时可扩展，本轮保持 scoped）。

## 8. 错误处理

| 场景 | 行为 |
|---|---|
| 创建带别家/异设备 `project_id` | 403 拒绝（归属校验） |
| 项目已删 | 设备视图显示名字快照；项目视图查询为空；项目删除时级联清标注行 |
| 标注 upsert 失败（映射已建成） | 降级为无项目标，不阻塞创建，log |
| 网关列表无此映射（过期/保留期清理） | join 后自然不显示 + 孤儿标注行惰性清理 |
| 设备离线/能力缺失（项目页新建） | 复用设备屏现有 Notice 门控 |
| 手机列表刷新 | 沿用现有手动刷新/下拉模式（设备屏现状即本地 state，无 WS，本轮不引入 store——保持最小影响面） |

## 9. 测试策略

**server（vitest）**

- dao：sqlite/postgres 形状互换测（照 `db/` 现有域测模式）。
- 路由：create 带 `project_id` 归属校验（通过/异设备/异用户/项目不存在）；打标 upsert 内容与 source 正确。
- `autoMapPreviewPort`：有/无 projectPath 的打标分支（fake session/project）。
- 列表：join 输出 tag；`?project_id=` 过滤与归属校验；孤儿标注惰性清理。
- 项目删除级联清标注。

**phone（jest + tsc）**

- mapper 回归：`platformDeviceToClient` 贯通 `tunnelAvailable`（快照进 → Device 出）。
- CreateVibeCodingScreen：门控渲染用真实 mapper 产物驱动（修掉手塞 mock）；置灰/可用两种态的 chip 文案断言。
- PortMappingsScreen：卡片项目 chip 渲染。
- ProjectDetail 区块：列表渲染/新建请求带 `project_id`/撤销调用/空态。
- tsc 0 错；全量 jest 过 terminal 基线（已知 3 flake）。

## 10. 部署与兼容

- server：`CREATE TABLE IF NOT EXISTS` + pg 迁移（照现有 ensureColumn/迁移模式）；旧客户端忽略新字段，向后兼容。
- phone：需 rebuild APK 生效。
- 网关/agent：**零改动、零部署**。
- 置灰修复部署即亮（设备在线+隧道已配置即可用）；"会话自动暴露"仍等 agent 未来支持 `preview.ready`，届时标签链路自动生效。

## 11. 分阶段交付

| 阶段 | 内容 | 可独立上线 |
|---|---|---|
| P1 | 创建页置灰修复 + 样式修复（§7.1，纯 phone） | ✅ |
| P2 | server 标注层：表+dao+三个打标点+列表 join/过滤+级联清理（§4-6） | ✅（对旧客户端无感） |
| P3 | phone 项目区块 + 设备卡片 chip + 类型同步（§7.2-7.3） | 依赖 P2 |

实现按仓开 worktree 分支：phone `feat/port-mapping-tags`（本分支）、server 同名分支；commit message 中文。
