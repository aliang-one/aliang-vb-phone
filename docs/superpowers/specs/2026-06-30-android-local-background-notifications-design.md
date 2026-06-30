# Android 本地后台通知 v1 — 设计

- 日期: 2026-06-30
- 范围: 仅手机端(`AliangVibeCodingPhone`),**仅 Android**。后端、agent、official-website、iOS 零改动。
- 状态: 设计已确认,待实现计划。

## 1. 背景与目标

用户希望:当 app 在后台运行时,若收到新的 approval,或某个 vibecoding 会话回合结束(完成 / 失败),能在系统通知栏提醒用户;点击通知进入对应会话。

**关键澄清(与用户多轮确认)**:

1. 只覆盖「app 进程活着、被切到后台」的场景。**app 被杀时不要求通知**(用户明确:「app 没运行就不需要推送」)。
2. 不走云端推送(APNs / FCM / 厂商推送)。原因:iOS 后台通知只有 APNs 一条路(Apple 禁止后台长连接),而云端推送的整套服务端基建(`PushSender`、token 表、触发钩子)本次不值得为「仅后台」场景引入。**iOS 本次不做**(见 §8/§9)。
3. 因此 v1 = **纯 Android、纯客户端、server 零改动**:复用现有 WebSocket 通路——app 在后台时 WS 仍「连接」(见 §2),事件照常流入 store,客户端在后台命中事件就弹本地通知。

**已知可靠性上限(与用户确认接受)**:国产 ROM(小米 / 华为 / OPPO / vivo)会主动杀后台进程,进程一死 WS 断、通知就收不到。这等价于「app 没运行」,与用户的接受范围一致。v1 不上前台服务保活(见 §9 可选项)。

## 2. 可行性核查(结论)

| 关注点 | 结论 |
|---|---|
| 后台 WS 是否仍送达事件 | ✅ 现有代码已假设「RN 在后台挂起期间保持 socket connected」(`RootNavigator.tsx` 的 `usePresenceHeartbeat` 注释原文:「React Native keeps the socket 'connected' across a background suspension」)。后台时事件照常进 `controlCenterStore`。 |
| 后台 WS 可靠性 | ⚠️ 不可靠——app 已为此在「后台→前台」做 re-sync(`usePresenceHeartbeat` 的 foreground refresh)。故后台通知也是 best-effort,与现有假设同源。 |
| 审批事件信号 | ✅ `controlCenterStore.events` 有 `approval.requested` 类型,带 `{sessionId, approvalId}`(`useSessionApprovalEvents`,`controlCenterStore.ts:202`)。 |
| 回合结束信号 | ✅ `isSessionTurnActive(status) = status==='running'`(`sessionPhase.ts:114`);`ai.done` 翻 idle、`ai.error` 翻 failed。故 `running → {idle,completed,failed}` 即回合结算。 |
| 跳转目标 | ✅ 路由 `VibeCodingSession`,接受 `{sessionId, approvalId}`(`app/navigation/types.ts`)。 |
| 前台展示是否已存在 | ✅ 已有 in-app `NotificationCenter` 屏 + `api/notifications.ts` 的 `ServerNotification` 类型。后台本地通知与之**互补**:后台走系统通知栏,前台走 in-app。 |
| 本地通知库 | ⚠️ `@notifee/react-native` 已于 2026-04-07 被归档(末版 v9.1.8)。改用维护中的 fork **`react-native-notify-kit`**(API 兼容、New Arch 就绪)。 |

**结论**:链路全通,纯客户端改动即可。

## 3. 设计决策(已与用户确认)

| 决策点 | 选择 |
|---|---|
| 平台 | 仅 Android。iOS 本次不做。 |
| 通知库 | `react-native-notify-kit`(notifee 归档后的维护 fork)。 |
| 触发事件 | 新 `approval.requested`;回合结算(`running→非running`)的「完成 / 失败」。 |
| 触发条件 | 仅当 app 处于后台(`AppState !== 'active'`)时弹;且回合结算仅当该会话在切后台那一刻处于 `running`。 |
| 前台行为 | 前台一律不弹(交给现有 in-app `NotificationCenter`)。 |
| 点击跳转 | 审批 / 完成都跳 `VibeCodingSession`(审批带 `approvalId`,审批卡就在会话内)。 |
| 前台服务保活 | v1 不上。 |
| 云端推送 / server 改动 | 范围外,server 零改动。 |

## 4. 详细设计

### 4.1 `react-native-notify-kit` 集成

- `package.json` 加 `react-native-notify-kit`;`pod install` 仅 iOS(本次 iOS 不接入,但仍需保持可构建——若 notify-kit 要求 iOS pod,以平台条件守卫,iOS 端为空实现)。
- `android/app/src/main/AndroidManifest.xml` 加 `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />`(Android 13+)。
- 建一个通知渠道(`AndroidChannelId = 'vibe_background'`,`importance HIGH` → heads-up)。
- 登录后首次请求 `POST_NOTIFICATIONS` 权限(`notifyKit.requestPermission()`);拒绝则静默降级,不崩。

### 4.2 `useBackgroundNotifications` hook(新,挂 `RootNavigator`,与 `usePresenceHeartbeat` 并列)

职责:后台期间命中触发事件 → 弹本地通知。纯客户端,无网络。

状态:
- `appStateRef`:跟踪 `AppState`(active / inactive / background)。`active` 以外视为「后台」,布防。
- `notifiedRef`:本次后台期间已通知的键集合(`approval:{approvalId}`、`session:{sessionId}:done`、`session:{sessionId}:failed`),防重复。回前台时清空。
- `runningAtBackgroundRef`:切后台那一刻快照「当时处于 `running` 的会话 id 集合」(仅这些会话的结算才通知,避免切后台时本就空闲的会话误报)。

逻辑:
1. `AppState` 变 `inactive/background`:快照 `runningAtBackgroundRef = 当前 status==='running' 的 session ids`;布防。
2. `AppState` 变 `active`:清空 `notifiedRef`、`runningAtBackgroundRef`;撤防。
3. 订阅 `controlCenterStore`:
   - 新增 `approval.requested` 事件(**事件本身只带 `{sessionId, approvalId}`**)→ 用 `approvalId` 从 `store.approvals` 查 `ApprovalRequest`(现有 `useApproval(approvalId)` helper,`controlCenterStore.ts:183`)取 title/summary → 键 `approval:{approvalId}` 未通知过 → 弹「需要审批:{title 或 summary}」(data `{type:'approval', sessionId, approvalId}`)。
   - 某 vibeRun 的 `status` 从 `running` 变为非 running,且其 id ∈ `runningAtBackgroundRef`:按新状态弹「会话已完成」(`completed`/`idle`)或「会话失败」(`failed`);键 `session:{id}:{done|failed}` 去重。
4. 仅在「后台」布防态执行 3;前台忽略(交给 in-app)。

`displayNotification` 参数:`android: { channelId, smallIcon, pressAction: {id:'default'} }`、`data`、`title`/`body`。

### 4.3 通知点击 → 跳转

- `App.tsx` 的 `NavigationContainer` 挂 `navigationRef`(`createNavigationContainerRef<RootStackParamList>()`)。
- 一个 `handleNotificationTap(data)`:`{type, sessionId, approvalId}` → `navigationRef.navigate('VibeCodingSession', { sessionId, approvalId: type==='approval' ? approvalId : undefined })`;跳转前等 store hydrate(`hasHydrated`)与登录态就绪。
- 接线:`notifyKit.getInitialNotification()`(冷启动被通知拉起)+ `notifyKit.onForegroundEvent`(前台/恢复时点击)→ 都走 `handleNotificationTap`。

### 4.4 触发口径与文案

| 事件 | 标题 | body | data |
|---|---|---|---|
| 新 `approval.requested` | 需要审批 | 从 `store.approvals` 按 `approvalId` 查得的 `title` / `summary` | `{type:'approval', sessionId, approvalId}` |
| 回合 `running→completed/idle` | 会话已完成 | 「点按查看回复」 | `{type:'session_done', sessionId}` |
| 回合 `running→failed` | 会话失败 | 「点按查看详情」 | `{type:'session_failed', sessionId}` |

### 4.5 数据流

| 动作 | 链路 | 改动 |
|---|---|---|
| 后台收到审批 | server WS(已有)→ store `events`(已有)→ hook 弹通知 | 新 hook |
| 后台回合结算 | server WS(已有)→ store `vibeRuns[].status`(已有)→ hook 弹通知 | 新 hook |
| 点击通知 | notify-kit tap → `handleNotificationTap` → `navigationRef.navigate` | 新 ref + 接线 |
| 申请权限 | 登录后 `notifyKit.requestPermission()` | 新 |

## 5. 错误处理

- 权限被拒:`displayNotification` 调用包裹 try/catch,失败静默;不影响主流程。
- notify-kit 原生模块缺失(iOS 或未装):import 处平台守卫,iOS 为空实现;Android 缺失则降级(不崩核心屏,沿用本仓 `voiceRecorder` 懒加载 + try/catch 的既有模式)。
- 点击早于 hydrate:`handleNotificationTap` 内等 `hasHydrated` 与登录态;未就绪则延迟到就绪后再跳(避免跳到 Login)。
- 后台 WS 丢事件:不在本设计修复范围(与现有「前台 re-sync」假设一致);最坏情况是后台期间漏通知,回前台后 in-app `NotificationCenter` 仍可见。

## 6. 测试

沿用现有 jest 基线(`AliangVibeCodingPhone`,tsc 为权威——LSP 可能 desync)。新增:

- **`useBackgroundNotifications` hook 单测**:mock `AppState`、`controlCenterStore`(events + vibeRuns status)、`notify-kit`。断言:
  - 前台收到 approval / 回合结算 → **不弹**。
  - 后台收到新 approval → 弹一次;同 approval 再来 → 不重复。
  - 后台某 running 会话结算 → 弹「完成 / 失败」;切后台时本就空闲的会话结算 → 不弹。
  - 回前台再后台 → 计数清零,可再次通知。
- **点击跳转单测**:mock `navigationRef` + `notifyKit.getInitialNotification` / `onForegroundEvent`;断言 hydrate 后按 data 跳到 `VibeCodingSession` 且 params 正确;未 hydrate 时不跳。

## 7. 范围与边界

- **只动** `AliangVibeCodingPhone`,仅 Android。
- **不引入**:前台服务、iOS 接入、云端推送、server 改动、被杀覆盖。
- 不改动现有 in-app `NotificationCenter` / `notifications.ts`(后台通知与之互补,不替换)。
- 不改 `VibeCodingSessionScreen`(已接受 `sessionId`/`approvalId`,无需改)。

## 8. iOS / 云端为何不做(决策记录)

- **iOS 后台通知只有 APNs 一条路**:iOS app 退后台几秒即被挂起、WS 断、app 冻结无法自弹通知;Apple 禁止后台长连接。故 iOS「后台通知」必须 APNs,无法用本地通知实现。
- **云端推送整套基建成本高**:server `PushSender` + token 表 + 触发钩子 + Apple/厂商凭证,超出「仅后台」场景的收益。
- 故 v1 收敛到 Android 本地;iOS 与云端列入 §9 未来可选。

## 9. 未来可选(非本次范围)

- **前台服务保活**(Android 可靠性增强):开前台服务保活进程 + WS,改善国产 ROM 杀后台导致的漏通知;代价是常驻通知 + 耗电。非银弹(神隐模式仍可能清)。
- **iOS 接入 APNs**:补 iOS 后台通知(需 Apple Developer 会员 + 固定 bundle id + APNs key + server 发推)。
- **厂商推送(云端)**:国产安卓要保证送达,唯一可靠是接入华为 / 小米 / OPPO / vivo 厂商通道(=云端),届时引入 server `PushSender` 基建。
- 扩展更多触发事件(如设备离线、STT 完成)。

## 10. 改动文件清单

| 文件 | 改动类型 |
|---|---|
| `package.json` / `package-lock.json` | 加 `react-native-notify-kit` |
| `android/app/src/main/AndroidManifest.xml` | 加 `POST_NOTIFICATIONS` 权限 |
| `src/services/localNotifications.ts`(新) | notify-kit 封装:建渠道、requestPermission、displayNotification、tap 事件订阅(平台守卫,iOS 空实现) |
| `src/hooks/useBackgroundNotifications.ts`(新) | 后台监听 + 布防 / 去重 + 弹通知 |
| `src/app/navigation/navigationRef.ts`(新)或 `App.tsx` | `createNavigationContainerRef` + 挂到 `NavigationContainer` |
| `App.tsx` / `RootNavigator.tsx` | 挂 `useBackgroundNotifications`(与 `usePresenceHeartbeat` 并列);`handleNotificationTap` 接线 |
| `src/hooks/__tests__/useBackgroundNotifications.test.ts`(新) | hook 单测 |
| 通知点击跳转测试(新) | tap → navigate 单测 |
