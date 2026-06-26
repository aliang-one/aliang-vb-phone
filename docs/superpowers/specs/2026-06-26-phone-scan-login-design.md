# 手机扫码登录 + 移除 /pair 设备配对 — 设计

日期：2026-06-26
状态：已与用户确认方案（方案 1 + 移除 /pair），待 spec review

## 目标

用户在桌面 agent（alianggate，Windows 等）上选择「扫码登录」，桌面展示二维码；用户用**已登录的手机 App** 扫码并确认，桌面 agent 即完成登录（拿到与账号密码登录等价的 `st_` + sub2api `refresh_token`），并**自动把设备注册到 AliangPhoneServer、绑定到该用户**。手机随即在设备列表看到该设备。

扫码登录成为手机端**唯一**的设备登录/绑定入口；移除旧的 `/api/devices/pair` 配对流程。

## 现状（已核实）

- **official-website（aliang.one）扫码登录后端：完整实现**。`internal/scanlogin/service.go` 标准 OAuth device-code 状态机：`pending → scanned → authorized/denied/expired`。`Init` 生成 `dc_`(device_code，PC 轮询用) + `sc_`(scan_code，**即 QR 内容**)。HTTP 路由（`internal/httpapi/routes.go`）：
  - `POST /auth/scan/init`（公开）
  - `GET /auth/scan/status?device_code=`（公开）
  - `POST /auth/scan/scan`（`RequireUser` = Bearer `st_` session，查 `als_sessions`）
  - `POST /auth/scan/confirm`（`RequireUser`）
  - `POST /auth/scan/deny`（`RequireUser`）
- **agent（alianggate）：完整实现**。`POST /api/auth/scan/init`→拿 `dc_`+`sc_`(QR)；`GET /api/auth/scan/status` 轮询；命中 `authorized` 拿 `st_`+`refresh` → `ActivateScanLogin` 完成本地登录。agent 网站 Vue `ScanLoginPanel.vue` 展示二维码并轮询。
- **agent 登录后自动注册**：`ActivateScanLogin` 与密码登录 `Login` 末尾都调 `agentSyncResult(reason)` → `RequestUserAgentSyncAfterAuth` → `SyncNowWithUserContext` → `register_sync`（`POST {PhoneServer}/api/devices/register`，带登录后的 user JWT）。设备注册在该用户名下。**无需新增。**
- **手机：缺失**。`DeviceCameraScannerScreen` 扫到 `sc_` 后误走 `parseDeviceDraft → fallbackDraft`，把 `sc_` 当 unique_code 发到 `ws-vb-phone/api/devices/pair` → `device_not_found`，并因 `os:'macOS'` 写死默认显示错误平台。

## 核心阻塞（方案 1 要解决的）

official-website 的 `/scan`、`/confirm`、`/deny` 走 `RequireUser` 中间件，**只认 `st_` session token**（哈希查 `als_sessions`）。但手机登录拿到的是 **sub2api access JWT**（`/api/auth/login`、`/me`、`/refresh` 均透传 sub2api；手机 `auth.ts` 注释 stateless JWT）。手机现有 JWT 直接打这三个端点会 401。

## 方案（方案 1：扫码端点接受手机 access token）

### official-website 改动（Go）— 用本地反查，不验 JWT 签名

研究结论：official-website **没有** JWT 签名 secret、也没有 Go JWT 库，无法本地验签。但**已有 `findLocalUserIDByStoredAccessToken(token)`**：本地查 `als_sub2api_auth_tokens.access_token → user_id`。而 `sub2api.LoadVault` 读的就是这张表，refresh 轮换也会更新它——所以**手机当前 access_token == 表里存的 token**，反查可靠。

1. **新中间件 `requireUserOrStoredToken`**（`/scan`、`/confirm`、`/deny` 用）：
   - 取 Bearer token。
   - 先 `findLocalUserIDBySessionToken`(st_，als_sessions) → 命中则载入 user。
   - miss 则 `findLocalUserIDByStoredAccessToken`(access token，als_sub2api_auth_tokens) → 命中则载入 user。
   - 都 miss → 401。
   - 载入 user 复用/新增 `loadAuthenticatedUser(userID)`（查 als_users 的 id/email/name/role），注入 context。
2. **handler 零改动**：仍用 `auth.UserFromContext` 拿 `u.ID`，**完全复用现有 `scanLogin.Scan/Confirm/Deny`**。
3. `/init`、`/status` 不变。官网 web 端继续用 st_，两条鉴权并存，零回归。
4. **优点**：无需新 secret、无需 JWT 库、无需网络调用；纯本地 DB 反查。

### 手机改动（React Native）

1. **移除 `/pair` 配对流程**：
   - 删 `api/devices.ts` 的 `pairDevice`、`platformTransport.pairDevice`、store 的 `bindDevice` action + 类型、`DeviceBindingScreen`/`DeviceCameraScannerScreen` 里的配对/`parseDeviceDraft`/`fallbackDraft`（含 `os:'macOS'` 写死）。
   - 扫码器改为扫码登录专用。（PhoneServer 的 `/api/devices/pair` 路由可保留不删，无害；本任务不动 server。）
2. **扫码登录流程**（用现有 `accountClient` + JWT bearer，直连 aliang.one）：
   - 扫到 `sc_` 前缀 → 解析为 scan-login；其它内容 → 明确提示「无法识别的二维码」（不再盲目发请求）。
   - `POST /auth/scan/scan {code}` → 成功（pending→scanned）。
   - UI 弹「确认在桌面登录？」→ 用户确认 → `POST /auth/scan/confirm {code}`。
   - 状态机：`scanned`→等确认、`authorized`→成功、`denied`→已拒绝、`expired`/404→已过期、409→状态不对；统一清晰提示 + 可重扫。
   - 仅在手机已登录（有 JWT）时可用。
3. **成功后刷新设备列表**：confirm 返回 `authorized` 后，触发一次设备列表刷新（`GET /api/devices` 经 PhoneServer）——agent 已自动把设备注册到该用户名下，刷新即出现。

### agent / PhoneServer：零改动

agent 登录后自动 `register_sync`（已实现）。PhoneServer 不动。

## 端到端数据流

```
桌面 agent                official-website(aliang.one)              手机(已登录,持 access JWT)
 POST /auth/scan/init ──►  Init: dc_ + sc_(QR), pending
 ◄── {device_code, qr_payload=sc_}
 展示 QR(sc_)  ─────────────────────────────────────────────►  扫到 sc_
                                                            POST /auth/scan/scan {code}   (JWT 验签→userID, Scan: pending→scanned)
 轮询 status(看到 scanned,可显"等待确认")                       ◄── {status:scanned}
                                                            UI「确认登录?」→ POST /auth/scan/confirm {code}  (JWT→userID, Confirm: mint st_, scanned→authorized)
                                                              ◄── {status:authorized}
 轮询 status 命中 authorized ──► 返回 {st_, sub2api refresh, user}
 ActivateScanLogin(st_, refresh) → 本地登录
 agentSyncResult → RequestUserAgentSyncAfterAuth
   → register_sync: POST ws-vb-phone/api/devices/register(user JWT) → 设备注册+绑定该用户
                                                            手机刷新 GET /api/devices → 新设备出现 ✓
```

## 鉴权细节（手机 access token → userID）

- 不验 JWT 签名。手机 Bearer = sub2api access_token，本地反查 `als_sub2api_auth_tokens.access_token → user_id`（`findLocalUserIDByStoredAccessToken`，已存在）。
- 该表由 `sub2api.LoadVault` 读取、由 refresh 轮换更新，所以手机当前 token 与表内一致，反查可靠。
- st_ 路径（官网 web 端）不变：`findLocalUserIDBySessionToken`(als_sessions)。
- 两条路径都解析到 `als_users.id` 后，载入完整 user 注入 context，复用 scanLogin 业务逻辑。

## 错误处理

- 扫码：非 `sc_` → 「无法识别的二维码」。
- `/scan`：码不存在(404)/已过期(expired)/状态不对(409) → 提示 + 重扫。
- `/confirm`：同上；`authorized` 即成功。
- JWT 失效(401) → 提示重新登录手机端。
- 并发/重复确认：后端 SQL 原子转移已保证（`scanned→authorized` 要求 `user_id` 匹配）。

## 测试

- **official-website**：JWT 校验（有效/过期/篡改/错 secret/claim 缺失）；`/scan`+`/confirm` 用 JWT 走通 pending→scanned→authorized；st_ 路径不回归；错误码（404/409）。
- **手机**：扫码分流（`sc_`/垃圾码）；scan-login 状态机（scanned/authorized/denied/expired）；成功后触发设备刷新；未登录态不可用。

## 范围外 / 决策

- **移除手机端 `/pair` 配对**（用户拍板）：扫码登录已自动完成绑定，`/pair` 冗余。PhoneServer 路由保留不删。
- 不改 agent、不改 PhoneServer。
- 不做 web 端扫码登录的改动（已用 st_，不受影响）。
- 部署前提（非代码）：agent 的 `cfg.GetAgentDeviceRegisterURL()` 指向手机所用的 PhoneServer（`ws-vb-phone.aliang.one`）；official-website 配置 access JWT 的共享 secret。
