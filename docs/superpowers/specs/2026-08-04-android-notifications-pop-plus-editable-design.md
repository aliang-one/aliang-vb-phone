# Android 后台通知 v2 — 「真能弹 + 可编辑」设计

- 日期: 2026-08-04
- 范围: 仅手机端(`AliangVibeCodingPhone`),**仅 Android**。server / agent / iOS **零改动**。
- 前置: v1(`2026-06-30-android-local-background-notifications-design.md`)已实现并编进 `8月 4 00:15` 的 release APK。本设计是 v1 之上的**增量**。
- 状态: 设计已与用户确认,待实现计划。

## 1. 问题(根因已定位)

用户反馈「状态栏通知从来没出现过」。系统排查后端到端链路**全部健康**:

| 边界 | 状态 | 证据 |
|---|---|---|
| server 发 `approval` | ✅ | `server/src/modules/approval/derived.ts:93,141`、`agent/handler.ts:356,1201,1329` |
| server 发任务完成 `completed` | ✅ | `server/src/modules/ai/lifecycle.ts:144`、`idleSettle.ts:105` |
| server WS 推送 | ✅ | `server/src/modules/notification.ts:69`(`notification.created`) |
| 手机 store 入库 | ✅ | `src/store/controlCenterStore.ts:1102` |
| notify-kit 原生已编译 | ✅ | `node_modules/react-native-notify-kit/android/build/outputs/aar/*.aar` 存在;`AndroidManifest.xml` 已声明 `POST_NOTIFICATIONS` |
| release APK 已含 notify-kit | ✅ | `android/app/build/outputs/apk/release/app-release.apk` 重建于 `8月 4 00:15` |

**真正根因不是某行代码坏了,而是三个叠加因素**:

1. **投递被硬闸在「后台」**(`useBackgroundNotifications.ts:65` `if (!isBackgroundRef.current || !permissionGrantedRef.current) return;` + `backgroundNotifications.ts:79`)。这是 v1 既定设计(前台不弹),**本次保留**。
2. **每个原生调用都被裸 `catch {}` 静默吞掉**(`localNotifications.ts` 全文),权限没给 / 通道没建好 / 小图标无效,都看不到任何报错 —— 表现就是「什么都没发生」。
3. **无 FCM / 无前台服务**:国产 ROM 与深度 Doze 会杀/挂起后台进程,此时到达的事件 WS 收不到。这是无云端推送的固有限制(见 v1 §1/§8),**本次不解决**(用户明确接受「app 被杀就不弹」)。

用户确认(v1 §1 + 本次再次确认):**仅做 Android、仅后台投递、不引入 FCM/云端**。

## 2. 目标 / 非目标

**目标**
1. 让后台投递在「app 进程活着且处于后台」时**真的弹出来**(消除静默失败、给用户自验手段)。
2. **按事件类型开关**(可编辑①):用户在设置里勾选哪些事件类型弹通知。
3. **approval 通知带「批准 / 拒绝」操作按钮**(可编辑②):直接在状态栏处理审批,不进 App。

**非目标(明确不做)**
iOS、FCM/云端推送、前台 heads-up 横幅、前台服务保活、任何 server 改动、被杀覆盖、回前台补发。

## 3. 投递语义(本次细化,与用户确认)

> **只有「app 进程活着且处于后台」期间新到达的事件才弹状态栏通知;其余一律视为历史,不弹、不补发。**

具体:
- **前台一律不弹**(foreground gate 已保证;本次不加任何「回前台补发」)。
- **打开 app 时即便有积压通知也不弹**:`useBackgroundNotifications` 的 `enabled` 依赖 `hasHydrated`,挂载在 hydrate 之后;挂载即 `snapshot()` 把当前所有通知(含死亡期间积压、重启后从服务端拉回的)标为 baseline = 历史 → 永不弹。
- **App 被杀 → 死亡期间的事件丢弃**:重启后上述 baseline 机制同样吞掉;这些通知**仍出现在 App 内通知中心**(`NotificationCenterScreen`),只是不进状态栏。
- baseline 在每次「前台↔后台」切换时重置:切后台时把当时已有通知快照为历史,只对之后新到达的弹。

> 这些语义**已是现有代码行为**,本次只是写进验收标准,并确保 Part A/B/C 的改动不破坏它。

## 4. Part A — 让它真能弹出来

### A1. 去掉静默吞错
`src/services/localNotifications.ts` 中所有裸 `catch {}` 改为 `catch (error) { console.warn('[localNotifications]', <fn>, error); }`,**保留**优雅降级返回值(`false` / `'unsupported'` / `undefined`)。失败从此在 `adb logcat` 可见。

涉及:`load()` 的 require、`ensureChannel`、`getNotificationPermissionStatus`、`requestPermission`、`openNotificationSettings`、`displayNotification`、`trimDisplayedNotifications`、`onNotificationPress`、`getInitialNotificationData`。

### A2. 「发送测试通知」按钮
`src/screens/settings/SettingsScreen.tsx` 通知分区加一个按钮,直接调 `displayNotification({ id:'vibe_test_${Date.now()}', title, body, data:{type:'test'} })`。
**价值**:把「notify-kit 在这台机器上到底能不能弹」与「触发链路是否通」隔离开 —— 定位时最关键的一步。按钮在 `getNotificationPermissionStatus() !== 'authorized'` 时禁用并提示先授权。

### A3. 权限流程校验(不重建已有 UI)
`SettingsScreen` 已有权限状态展示 + handler(`not_determined`→`requestPermission`,否则→`openNotificationSettings`,见 `SettingsScreen.tsx:67-76,188-198,451-463`)。本次只:
- 确认新 APK 上 `requestPermission()` 真的弹系统授权框(此前旧 APK 原生缺失,`getNotificationSettings()` 抛错→返回 `'unsupported'`→永不弹框)。
- `useFocusEffect` 已刷新状态;保持。

### A4. 通知小图标(用户已同意走 a)
当前 `displayNotification` 用 `smallIcon: 'ic_launcher'`,在新版 Android 状态栏常渲染成空白剪影。
新增规范的白色透明小图标 `ic_notification`(`android/app/src/main/res/drawable-anydpi-v24/ic_notification.xml` 或 PNG),`displayNotification` 的 `smallIcon` 改为 `'ic_notification'`。这是**唯一一处原生资源改动**。

## 5. Part B — 按事件类型开关(可编辑①)

### B1. 偏好模型
新增本地持久化偏好(复用现有 user-settings 持久化路径):
```ts
type NotificationTypeKey = 'approval' | 'completed' | 'error' | 'device_offline';
type NotificationPrefs = Record<NotificationTypeKey, boolean>; // 默认全 true
```
**server 零改动**(投递本就是客户端决定)。

### B2. 过滤
新增纯函数 `src/utils/notificationDeliveryPolicy.ts`:
```ts
isEventTypeEnabled(prefs: NotificationPrefs, type: BackgroundNotificationType): boolean
```
在 `useBackgroundNotifications` 的 `check()` 里、调 `decideBackgroundNotifications` 之前,按 `notification.data.type` 过滤掉被关掉的类型。(或下沉到 `decideBackgroundNotifications`,二选一,实现时定;倾向前者,保持 `decideBackgroundNotifications` 纯粹。)

### B3. UI
`SettingsScreen` 通知分区加「通知类型」子分区,4 个开关绑定偏好,`i18n` 文案进 `common:notification.*`。

## 6. Part C — approval 通知带操作按钮(可编辑②)

### C1. 通知加 actions
`displayNotification` 扩展:当 `data.type === 'approval'` 时,`android.actions` 附:
```ts
[
  { title: i18n.t('common:notification.approve'), pressAction: { id: 'approve' } },
  { title: i18n.t('common:notification.deny'),    pressAction: { id: 'deny' } },
]
```
(确认 `react-native-notify-kit` 的 `AndroidAction` 形态:`NotificationAndroid.d.ts:19,464` 已支持 `actions?: AndroidAction[]`,每个含 `pressAction: { id }`。)

### C2. 事件路由
扩展 `localNotifications.ts` 的 `onNotificationPress`:除 `EventType.PRESS`(=1,正文点击)外也处理 `EventType.ACTION_PRESS`(=2,操作按钮,见 `node_modules/react-native-notify-kit/dist/types/Notification.d.ts:305-336`)。ACTION_PRESS 事件里被按下的 action id 在 `event.detail.pressAction.id`,审批 id 在 `event.detail.notification.data.approvalId`:
- `approve` → `respondApproval(approvalId, 'approved')`
- `deny` → `respondApproval(approvalId, 'denied')`

复用现有链路:`respondApproval`(`src/api/approvals.ts:41`)← 已被 `platformTransport.respondApproval` ← `approvalSlice.ts:135` 使用。通知 action 走同一 `apiPost` 通路即可(app 进程活着,token 在内存)。

成功后:`lib.default.cancelNotification(nativeId)` 移除该通知 + 刷新 store(`useControlCenterStore.getState().refreshFromServer()` 或等价)。

### C3. 正文点击不变
`EventType.PRESS`(点通知正文)仍走现有 `processNotificationTap` → 跳 `VibeCodingSession`(审批带 `approvalId`)。

## 7. 错误处理

- 原生调用全部优雅降级 + **现在带日志**(A1)。
- 权限拒/未授:Settings 显示状态 + 入口(A3);测试按钮禁用并提示(A2)。
- 开关关:静默跳过(B2)。
- action 调 `respondApproval` 失败:`console.warn`,通知不取消(让用户可重试或点正文进 App 处理)。
- 后台 WS 丢事件 / 进程被杀:不在本设计修复范围(与 v1 假设一致),最坏漏通知,回前台后 in-app `NotificationCenter` 仍可见。

## 8. 测试(TDD)

沿用现有 jest 基线(`AliangVibeCodingPhone`,tsc 为权威)。新增/扩展纯函数测:
- `notificationDeliveryPolicy.test.ts`:`isEventTypeEnabled` 各类型 × 各开关组合。
- `notificationTap.test.ts`(扩展):`pressAction.id`(`approve`/`deny`)→ 正确 decision + 正确 `approvalId` 透传给 `respondApproval`;非 approval 类型无 action。
- `backgroundNotifications.test.ts`(扩展):被关掉的类型即使后台到达也不进 pending 列表。

UI/原生交互(测试按钮、开关、action 真弹)走真机 smoke,**不**写 RN 组件单测(本仓惯例:纯逻辑单测 + 真机验)。

## 9. 验收标准

1. **测试按钮**:授权后点「发送测试通知」,状态栏**立即**出现一条通知(隔离验证 notify-kit)。
2. **后台 approval**:app 切后台,触发一个 approval → 状态栏弹出,带「批准 / 拒绝」按钮;点「批准」→ 服务端 approval 转 approved、通知消失、store 刷新。
3. **后台任务完成**:app 切后台,会话回合结算 → 状态栏弹出「会话已完成」。
4. **按类型开关**:在 Settings 关掉「任务完成」→ 后台回合结算不再弹;approval 仍弹。
5. **投递语义**:打开 app(前台)即便有积压 → 不弹;app 被杀后重启 → 死亡期间积压不弹(仍可在 App 内通知中心看到)。
6. **失败可见**:任何原生失败在 `adb logcat` 有 `[localNotifications]` warn。
7. tsc 0、jest 不回归(纯函数新测全绿)。

## 10. 改动文件清单

| 文件 | 改动 |
|---|---|
| `src/services/localNotifications.ts` | A1 去静默吞错;A4 `smallIcon`→`ic_notification`;C1 approval 加 `actions`;C2 扩展 `onNotificationPress` 处理 `EventType.ACTION` + 取消通知 |
| `src/screens/settings/SettingsScreen.tsx` | A2 测试按钮;B3 「通知类型」4 开关 |
| `src/utils/notificationDeliveryPolicy.ts` | B2 新增 `isEventTypeEnabled` + 偏好类型 |
| `src/hooks/useBackgroundNotifications.ts` | B2 调用前置类型过滤 |
| 通知偏好持久化(复用现有 settings store) | B1 新增偏好字段 + 默认值 |
| `src/i18n/locales/*` | 新文案(`notification.approve`/`deny`/测试按钮/类型开关) |
| `android/app/src/main/res/drawable-anydpi-v24/ic_notification.xml`(新) | A4 白色透明小图标 |
| `src/utils/__tests__/notificationDeliveryPolicy.test.ts` | B2 单测 |
| `src/utils/__tests__/notificationTap.test.ts` | C2 扩展 |
| `src/utils/__tests__/backgroundNotifications.test.ts` | B2 扩展 |

## 11. 部署

`npm run android:release` 重出签名 APK(参见 `scripts/build-android-release.js`、memory `android-release-build-setup`),装真机 + 授权通知权限后 smoke。
