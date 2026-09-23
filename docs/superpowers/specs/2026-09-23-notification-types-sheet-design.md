# 通知类型设置弹窗 + 设备上线通知 设计文档

日期：2026-09-23
状态：已与用户逐节确认
仓库：AliangVibeCodingPhone（手机端）+ AliangPhoneServer（server 端）

## 1. 背景与目标

设置页通知面板已有 4 个逐类开关（approval / session_done / session_failed / device_offline），
数据模型（`NotificationPrefs`）、持久化（zustand persist）、后台按开关过滤全部打通，但入口是
内联开关行，存在感弱。用户要求：

1. 改成**弹窗**形态：面板缩成一行入口，点开底部弹窗内逐类开关。
2. 新增**设备上线通知**（`device_online`），本轮连 server 一起做全链路。

### 硬性不变量（用户明确提出）

- **只有状态变化了才通知**：不允许出现通知风暴（重复 announce、grace 窗口内抖动、
  首次配对都不得触发）。
- **开关能力必须正确**：每个类型的开关关掉后绝不弹、打开后必弹；旧持久化状态迁移安全。

## 2. 现状盘点（已核实的代码事实）

### 手机端（AliangVibeCodingPhone）

| 现状 | 位置 |
| --- | --- |
| `NotifiableEventType` = approval/session_done/session_failed/device_offline | `src/utils/notificationDeliveryPolicy.ts:44-48` |
| `DEFAULT_NOTIFICATION_PREFS` 全 true；`isEventTypeEnabled` 缺键默认开启 | 同上 `:52-69` |
| 后台过滤：`if (!isEventTypeEnabled(prefs, type)) continue`（在去重记账**之前**） | `src/hooks/useBackgroundNotifications.ts:84` |
| 内联开关行 UI（将移入弹窗） | `src/screens/settings/SettingsScreen.tsx:582-607` |
| `NOTIFIABLE_EVENT_TYPES` 列表 | `SettingsScreen.tsx:56-60` |
| server type → 本地 type 映射（completed→session_done, error→session_failed, 其余直通） | `src/utils/backgroundNotifications.ts:49-54` |
| nativeId 分组（device_offline → `vibe_device_<id>_offline`） | `src/utils/backgroundNotifications.ts:44-46` |
| 点按路由（device_offline → DeviceDetail） | `src/utils/notificationTap.ts:29-32` |
| 通知中心标签/色调/图标映射 | `src/screens/operations/NotificationCenterScreen.tsx:32,42,49` |
| server 通知 type 联合 | `src/api/notifications.ts:8`、`src/store/types.ts:174` |
| 可复用底部弹窗基座 | `src/components/shared/BottomSheet.tsx`（`ApprovalQuickPolicySheet` 已验证该模式） |

### Server 端（AliangPhoneServer）

| 现状 | 位置 |
| --- | --- |
| `device_offline` 通知生成（`wasOnline` 守卫） | `server/src/modules/device/lifecycle.ts:82-97` |
| reconnect grace：抖动期间不 mark offline、不发离线通知 | `lifecycle.ts:174-236` |
| agent hello 路径（注册成功 → `agent.online` 审计） | `server/src/modules/agent/handler.ts:270-455` |
| hello 重建 Device 对象、`existing` 为旧记录 | `handler.ts:270-325`（`existing` 取自 DeviceRepository） |
| 通知 type 联合 | `server/src/types.ts:785` |
| 通知单一写入口（幂等） | `server/src/modules/notification.ts` `NotificationRepository` + `createNotification` |

## 3. 方案（已选定）

- 弹窗形态：**A1** 复用 `shared/BottomSheet` 新建 `NotificationTypesSheet`。
- 设备上线：**B1** 在 agent hello 成功路径加严格转换守卫直发，零新增基础设施。

## 4. 设计

### 4.1 手机端弹窗

- 新组件 `src/components/settings/NotificationTypesSheet.tsx`：
  - props：`open` / `onClose`；内部读 `useSessionStore(s => s.notificationPrefs)`，
    开关写回 `setNotificationPrefs({ ...prefs, [type]: value })`。
  - 主体：`NOTIFIABLE_EVENT_TYPES.map` 渲染 5 行（标签用
    `t('notifications.types.<type>')`），Switch 样式沿用现内联行的主题令牌。
  - 标题「通知类型」。
- `SettingsScreen` 通知面板：删除 4 个内联开关行，替换为**一行入口**：
  - 左侧标题「通知类型」+ 副文案 `t('notifications.typesSummary', {enabled, total})`
    （如「3/5 已开启」，`enabled` 由 prefs 实时统计）；
  - 整行可点（Pressable），点击 `setSheetOpen(true)`。
- i18n（zh/en 同步）：`settings: notifications.typesTitle`、`notifications.typesSummary`
  （`"{{enabled}}/{{total}} 已开启"` / `"{{enabled}}/{{total}} enabled"`）、
  `notifications.types.device_online`（「设备上线」/ "Device online"）。

### 4.2 手机端 `device_online` 贯通（7 个落点）

1. `notificationDeliveryPolicy.ts`：`NotifiableEventType` 加 `'device_online'`；
   `DEFAULT_NOTIFICATION_PREFS` 加 `device_online: true`。
2. `backgroundNotifications.ts`：`BackgroundNotificationType` 加 `'device_online'`
   （`notificationType()` 直通，不新增映射，杜绝映射漂移）；
   `nativeNotificationId` 加 `vibe_device_<safeId>_online` 分组——同设备的上/下线通知
   在通知栏互相替换，不叠加。
3. `api/notifications.ts:8` 与 `store/types.ts:174`：type 联合加 `'device_online'`。
4. `NotificationCenterScreen.tsx`：label/tone/kind 三个映射各加 `device_online`
   （label 用 `notification.typeOnline`；tone neutral；kind 'device'）。查不到的
   未知类型保持现有兜底行为。
5. `notificationTap.ts`：`device_online` 且有 `deviceId` → `DeviceDetail` 路由
   （与 `device_offline` 一致）。
6. `SettingsScreen.tsx`：`NOTIFIABLE_EVENT_TYPES` 加 `'device_online'`。
7. i18n：`settings/zh.json`、`settings/en.json` 的 `notifications.types`；
   通知中心 label `notification.typeOnline`（operations 命名空间
   `src/i18n/locales/operations/{zh,en}.json`，与 `typeOffline` 同处）。

### 4.3 Server：`device_online` 只在真转换时发一条

**防风暴不变量（5 条）：**

| 场景 | 行为 |
| --- | --- |
| 真离线→上线（此前走过 `markDeviceOfflineById`，状态为 `offline`） | 恰好 1 条 `device_online` |
| reconnect grace 窗口内的 WS 抖动（从未 mark offline） | 不发——「没发过离线就不发上线」，语义对称 |
| 首次配对 hello（`existing` 为 undefined）、在线期间重复 announce、4G↔WiFi 换手重连 | 不发 |
| server 重启：grace 已过期才重连（设备已被 mark offline） | 恰好 1 条 |
| server 热重启：grace 窗口内重连（boot 保留在线状态，从未 mark offline，见 `store.ts:425`） | 不发——与 row 2 同一对称原则 |

**实现：**

- `handler.ts` hello 路径，在 `DeviceRepository.upsert(device)` **之前**捕获
  `const wasOffline = existing?.status === 'offline';`（此刻 `existing` 仍是旧记录）。
- 注册成功后（`rememberAudit({eventType: 'agent.online'})` 旁）：

  ```ts
  if (wasOffline) {
    await createNotification(
      {
        userId: device.userId,
        type: 'device_online',
        title: 'Device online',
        body: `${device.name} is back online.`,
        deviceId: device.id,
        createdAt: device.lastSeenAt,
      },
      source,
    );
  }
  ```

- `server/src/types.ts:785` type 联合加 `'device_online'`。
- 文案沿用 server 惯例：英文硬编码（与 `device_offline` 的 title/body 一致）；
  本地化由手机端通知中心负责。

### 4.4 开关正确性保障

- **键值恒等**：prefs key 与通知 type 字符串严格相等（`device_online` 直通），
  过滤无需任何映射，杜绝漂移。
- **旧状态迁移**：持久化状态缺 `device_online` 键 → `prefs[type] !== false` 兜底为
  开启，升级不会静默吞通知。
- **跳过时机**：过滤发生在去重记账之前——关掉的类型不污染 `alreadyNotified`/
  `inFlight`；后台窗口内把开关打开，后续事件仍可正常补发。
- **iOS 语义**：所有类型经同一 `displayManagedNotification` 通道（含限流 5 条/分钟
  + 汇总折叠），iOS 与 Android 行为一致。

## 5. 测试策略（TDD，先红后绿）

### 手机端（jest）

1. **开关矩阵（10 例）**：5 类型 × 开/关 → 断言 `displayManagedNotification`
   收到/未收到。
2. **补发**：后台窗口内先关后开 → 下一事件补发。
3. **迁移**：持久化状态无 `device_online` 键 → 视为开启。
4. **nativeId 分组**：`device_online` → `vibe_device_<id>_online`。
5. **点按路由**：`device_online` + deviceId → DeviceDetail。
6. **弹窗 UI**：入口行渲染摘要「N/5」；点击打开 Sheet；Sheet 内开关切换写回 store。
7. **既有用例适配**：`settingsNotifications.test.tsx` 相关断言跟随入口行调整。

### Server 端（vitest）

1. 真 offline→online → `createNotification` 恰好一次，type `device_online`。
2. grace 内重连（未 mark offline）→ 不发。
3. 首次 hello（无 existing）→ 不发。
4. 在线期间重复 hello → 不发。
5. 热重启 grace 内重连（boot 保留在线状态）→ 不发。
6. 重启后 grace 过期才重连 → 恰好一次。

## 6. 错误处理与边界

- `createNotification` 幂等（单写入口），fire 顺序在 `agent.registered` 应答之后，
  不阻塞握手主路径的失败传播。
- 旧版手机 + 新 server：收到 `device_online`，旧联合类型仅是 TS 层约束；通知中心
  对未知类型无显式兜底（`notificationTypeKey`/`notificationIcon` 查表 miss 返回
  undefined，未验证 i18next 对缺失键的实际表现）——可能显示空标签，仅存在于新旧
  版本并存的过渡窗口，可接受。
- 新版手机 + 旧 server：`device_online` 开关存在但永不触发（无事件源），可接受，
  部署顺序上 server 先行即可窗口最小化。

## 7. 部署顺序

1. server 先上：新镜像走 k8s 配方（strategic-merge / 完整 manifest），agent 二进制
   零改动。
2. 手机端后上：iPhone 走 7 天签名重装配方（`SWIFT_COMPILATION_MODE=singlefile`）；
   Android 走 tag 触发 release.yml。
