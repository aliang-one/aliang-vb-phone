# 设备列表长按菜单(详细介绍 / 重命名 / 删除)— 设计

- 日期: 2026-06-29
- 范围: 仅手机端(`AliangVibeCodingPhone`)。后端、agent、official-website 零改动。
- 状态: 设计已确认,待实现计划。

## 1. 背景与目标

在「Vibe Command」首页(CommandCenterScreen)的设备列表里,设备卡片(`DeviceControlCard`)目前只有点按跳详情,没有长按菜单。用户希望长按设备卡片弹出菜单,提供:

1. **详细介绍** — 底部信息卡预览设备关键信息(不离开列表)。
2. **重命名** — 修改设备名称。
3. **删除** — 删除该设备(硬删除,解绑 + 清数据)。

并要求核查前后端,确认删除/重命名全链路所需的支持。

## 2. 前后端全链路核查(结论)

| 层 | 重命名 | 删除 |
|---|---|---|
| **Server 端点** | ✅ `PATCH /api/devices/:deviceId/settings`,`{name}`(`modules/routes/devices.ts:216`) | ✅ `POST /api/devices/:deviceId/unbind`(`devices.ts:299`),**硬删除**:撤 `device_token` + 关 agent WS + 删设备及其全部 projects/AI sessions/terminal sessions/approvals/preview links/notifications/凭证 |
| **Phone API** | ✅ `updateDeviceSettings(id,{name})`(`api/devices.ts`) | ✅ `unbindDevice(id)`(`api/devices.ts`) |
| **Phone transport** | ✅ `platformTransport.updateDeviceSettings`(`platformTransport.ts:317`) | ❌ 缺:transport 未暴露 `unbindDevice` |
| **Phone store** | ✅ `renameDevice()`(`deviceProjectSlice.ts:30`)已完整实现…但**无任何 UI 调用**(死代码) | ❌ 缺:无 store action |
| **Phone UI(设备列表)** | ❌ `DeviceControlCard` 只有 `onPress`,无长按菜单 | ❌ |

**结论**:删除/重命名**后端链路完全就绪**。缺口几乎全在手机端:transport 暴露 `unbindDevice` + 新增 `removeDevice` store action + 卡片长按菜单 UI;重命名仅需把已有 store action 接到 UI。

## 3. 删除语义与「让 token 过期」可行性(关键决策)

用户要求:删除后手机清数据、后端解除绑定;若该 agent 是扫码登录的,要能「直接下线 / 让 token 过期」。

核查代码后的结论:

1. **直接下线** — ✅ 已实现。`/unbind` 执行 `agent.ws.close(1008,'device_unbound')` 立即关闭活动连接,并发 `device.removed` 通知手机清本地。扫码/密码登录都生效。

2. **用旧 token 重连** — ✅ 已堵死。Agent 的 WS 连接只认 `device_token`(`authenticateDeviceToken`,`agent/connections.ts:26`);`/unbind` 已撤销该 `device_token`,旧 token 重连会被拒。

3. **让 access token 真正「过期」** — ❌ 当前架构 AliangPhoneServer 单方面做不到,但本设计不依赖它。
   - Agent 推上来的 `access_token` 走 `decodeAliangJwt()`(纯 JWT 验签 + 看 exp + 用户匹配;session-refresh 路径在 `agent/handler.ts:288`,连接建立时的 token 校验在 `agent/connections.ts`),**从不查可撤销的 `userSessions` 表**(agent/device 模块中 `authenticateUserToken` 零调用)。
   - JWT 无状态,本服务无法让它提前失效。`revokeUserSessions`(可撤销 session)只对手机/密码登录的 userSession 有效,对 agent 这条路无效。
   - 真要「过期」只能靠:① official-website 侧撤销(跨服务);② 给 JWT 校验加黑名单(新基建);③ 等自然 exp。

4. **残留口子(本设计不堵)**:删除后,只要 agent 的 access JWT 没过期,理论上它能再调 `/register` 重新绑回(`device/register.ts` 无「已删除/黑名单」检查)。这是边缘风险(JWT 过期后自然消失)。

**决策**:删除采用**现有 `/unbind`(零后端改动)**。能保证「下线 + 撤 device_token + 清数据 + 旧 token 不能重连」。不堵「JWT 有效期内重注册」这个边缘口子(若日后要堵,另立 `revoked_devices` 黑名单方案,见 §9)。

## 4. 设计决策(已与用户确认)

| 决策点 | 选择 |
|---|---|
| 菜单归属 | 方案 A:菜单自包含在 `DeviceControlCard` 内(镜像已有 `VibeSessionCard` 长按菜单) |
| 删除语义 | 硬删除,复用 `POST /unbind`;二次确认 |
| 「详细介绍」表现 | 底部信息卡预览(不跳转);点按仍跳 `DeviceDetail` |
| 重命名 | 复用已有 store `renameDevice` |
| 删除后端方案 | 仅 `/unbind`,零后端改动 |

## 5. 详细设计

### 5.1 组件结构

`DeviceControlCard`(`components/vibecoding/DeviceControlCard.tsx`)改造:

- 外层 `TouchableOpacity` 增加 `onLongPress={() => setMenuVisible(true)}`。
- 新增内部 state:`menuVisible`、`renameValue`、`infoVisible`。
- 从 store 取 `renameDevice`、`removeDevice`(`useControlCenterStore`)。
- 复用 `VibeSessionCard` 的菜单骨架:`<Modal visible={menuVisible}>` + `renderMenuAction(label, handler, tone?)`;重命名用 `VoiceTextInput`(带语音输入,与 session 卡一致)。

菜单项:
- **详细介绍** → `setInfoVisible(true)`(打开信息卡 Modal)。
- **重命名** → 进入内联重命名(VoiceTextInput + 取消/保存)。
- **删除** → 弹二次确认 → 调 `removeDevice`。

### 5.2 数据流

| 动作 | 链路 | 改动 |
|---|---|---|
| 详细介绍 | 卡片 `infoVisible` → 底部信息卡 | 纯前端,零网络 |
| 重命名 | 卡片 → store `renameDevice`(已实现)→ transport `updateDeviceSettings` → server `PATCH /settings` | 仅接线 UI |
| 删除 | 卡片 → 新 store `removeDevice` → 新 transport `unbindDevice` → server `POST /unbind` | 加 transport 方法 + store action + 确认框 |

### 5.3 新 store action `removeDevice`

位置:`store/slices/deviceProjectSlice.ts`(紧邻 `renameDevice`),并在 `store/types.ts` 加签名:

```ts
removeDevice: (deviceId: string) => Promise<BindDeviceResult>;
```

行为:
- 校验 `serverMode`(与 `renameDevice` 一致)。
- `await platformTransport.unbindDevice(deviceId)`。
- 成功后:`state.devices` 过滤掉该设备;顺带清掉引用它的 `projects`(`project.deviceId === deviceId`)与 vibeRuns(乐观清理——server 已硬删,WS `device.removed` 也会推,二者幂等)。
- push event(`event('device.bound','Device removed', name, 'done', {deviceId})`)。
- 返回 `{ok:true, deviceId}`;失败返回 `{ok:false, error}`,**不删本地**。

### 5.4 transport 暴露 `unbindDevice`

`services/platformTransport.ts`:
- import `unbindDevice as apiUnbindDevice` from `api/devices`(与 `apiUpdateDeviceSettings` 同处)。
- 暴露 `unbindDevice(deviceId): Promise<{status,device_id}>`。

### 5.5 详细介绍信息卡

底部 `<Modal>` + `GlassPanel`,只读展示 `Device` 模型已有字段:名称 / host / os / 位置 / 在线状态 / agent 版本 / 唯一码 / 项目数(`projectIds.length`)/ Agent 数(`activeSessionIds.length`)/ 最近活跃(`lastSeen`)/ 远程终端开关 / AI 控制开关 / 能力数·工具数。

### 5.6 删除二次确认

danger 风格确认对话框,文案明示后果:「将永久删除该设备及其全部项目 / 会话 / 审批,不可恢复。」确认后才调 `removeDevice`。

## 6. 错误处理

- 网络/API 失败:保留本地状态,通过 event/Toast 提示,不抛未捕获异常。
- 重命名:沿用 `renameDevice` 现有校验(空名 / 重名 / serverMode)与错误信息。
- 删除:必须二次确认;失败保留设备。

## 7. 测试

沿用现有 jest 基线(`AliangVibeCodingPhone`,tsc 为准——LSP 在重构期 desync,以 `tsc --noEmit` 为权威)。

新增:
- store `removeDevice`:成功(本地 device+关联被清、event 产生)、失败(本地保留)、`serverMode` 关闭时拒绝。
- `DeviceControlCard`:长按打开菜单;三项动作可触发;删除走二次确认;重命名空名/重名校验;信息卡渲染关键字段。

## 8. 范围与边界

- **只动** CommandCenter 设备列表的 `DeviceControlCard` 及其依赖(transport / store action / 类型)。
- `TerminalListScreen` 也列出设备,但**本次不扩展**(日后可复用同一张卡 / 同一菜单)。
- 后端、agent、official-website **零改动**。
- 不引入 `revoked_devices` 黑名单(见 §9)。

## 9. 未来可选(非本次范围)

- **`revoked_devices` 黑名单**:若要彻底堵住「扫码 agent 在 access JWT 有效期内重注册回来」,可在 `/unbind` 时写黑名单(device_id + unique_code + user_id),`/register` 命中则拒绝。效果 ≈ token 过期。需后端新表 + register/unbind 接线 + 测试(agent / official-website 仍零改)。本次不做。
- 把长按菜单复用到 `TerminalListScreen` 等其它设备列表。

## 10. 改动文件清单

| 文件 | 改动类型 |
|---|---|
| `src/services/platformTransport.ts` | 暴露 `unbindDevice` |
| `src/store/types.ts` | 加 `removeDevice` 签名 |
| `src/store/slices/deviceProjectSlice.ts` | 加 `removeDevice` action |
| `src/components/vibecoding/DeviceControlCard.tsx` | 加长按菜单 + 信息卡 + 重命名 + 删除 |
| `src/components/vibecoding/__tests__/DeviceControlCard.test.tsx`(或既有测试文件) | 新增测试 |
| store 测试(`store/__tests__`) | 新增 `removeDevice` 测试 |
