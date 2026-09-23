# 通知类型设置弹窗 + 设备上线通知 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置页通知面板改为「一行入口 + 底部弹窗逐类开关」，并全链路新增 `device_online`（设备上线）通知类型（server 转换守卫直发 → 手机按开关过滤）。

**Architecture:** 手机端复用 `shared/BottomSheet` 新建 `NotificationTypesSheet`，开关读写既有 `useSessionStore.notificationPrefs`（zustand persist）；`device_online` 作为新事件类型贯通 7 个既有落点（键值恒等，无新映射）。Server 端在 agent hello 成功路径捕获 `wasOffline = existing?.status === 'offline'`（upsert 前），经新导出的 `notifyDeviceBackOnline` 守卫直发，防风暴不变量见 spec §4.3。

**Tech Stack:** React Native + zustand + i18next（手机）；Node/TypeScript + vitest（server）。

**Spec:** `docs/superpowers/specs/2026-09-23-notification-types-sheet-design.md`（不变量与测试矩阵的唯一权威，冲突以 spec 为准）

---

## 约定（所有任务通用）

- **仓库**：手机 = `/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone`（下称 PHONE）；
  server = `/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer`（下称 SERVER）。
- **并行会话警告**：两仓库都有并行会话在推进。`git add` **只加本任务明确列出的文件**，
  绝不 `git add -A` / `git add .`。每个 commit message 以
  `Co-Authored-By: Claude Code <noreply@anthropic.com>` 结尾。
- **手机测试命令**：jest 会扫进 `.claude/worktrees/` 里并行会话的测试副本，**必须用
  `$PWD` 绝对路径匹配**，如 `npx jest "$PWD/__tests__/xxx.test.ts"`；全量用
  `npx jest "$PWD/__tests__"`。
- **server 测试命令**：`cd "$SERVER" && npx vitest run <文件>`（server 无 worktree 干扰）。
- **TDD**：每个行为改动先写失败测试、跑红、最小实现、跑绿、提交。

---

### Task 1: `NotifiableEventType` 加 `device_online`（手机）

**Files:**
- Test: `__tests__/notificationDeliveryPolicy.test.ts`（新建）
- Modify: `src/utils/notificationDeliveryPolicy.ts:44-57`

- [ ] **Step 1: 写失败测试**

```ts
// __tests__/notificationDeliveryPolicy.test.ts
import {
  DEFAULT_NOTIFICATION_PREFS,
  isEventTypeEnabled,
  type NotificationPrefs,
} from '../src/utils/notificationDeliveryPolicy';

describe('device_online pref', () => {
  test('default prefs include device_online: true', () => {
    expect(DEFAULT_NOTIFICATION_PREFS.device_online).toBe(true);
  });

  // 旧持久化状态没有 device_online 键 —— isEventTypeEnabled 的
  // `!== false` 兜底必须视为开启，升级不能静默吞通知（spec §4.4）。
  test('missing key (pre-device_online persisted state) defaults to enabled', () => {
    const legacy = {
      approval: true,
      session_done: true,
      session_failed: true,
      device_offline: false,
    } as unknown as NotificationPrefs;
    expect(isEventTypeEnabled(legacy, 'device_online')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑红**

Run: `cd "$PHONE" && npx jest "$PWD/__tests__/notificationDeliveryPolicy.test.ts"`
Expected: FAIL（`device_online` 不是 `NotifiableEventType` 成员 / `DEFAULT_NOTIFICATION_PREFS.device_online` 为 undefined，TS 编译报错同样算红）

- [ ] **Step 3: 最小实现**

`src/utils/notificationDeliveryPolicy.ts`：

```ts
export type NotifiableEventType =
  | 'approval'
  | 'session_done'
  | 'session_failed'
  | 'device_offline'
  | 'device_online';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  approval: true,
  session_done: true,
  session_failed: true,
  device_offline: true,
  device_online: true,
};
```

（`isEventTypeEnabled` 不动——`prefs[type] !== false` 已覆盖缺键兜底。）

- [ ] **Step 4: 跑绿**

Run: `cd "$PHONE" && npx jest "$PWD/__tests__/notificationDeliveryPolicy.test.ts"`
Expected: PASS (2 tests)。随后的 Task 3 会改联合类型，本任务先只改本文件可能引发
其他文件 TS 报错——**本任务不跑全量 typecheck**，属预期，Task 3 收口。

- [ ] **Step 5: 提交**

```bash
cd "$PHONE" && git add __tests__/notificationDeliveryPolicy.test.ts src/utils/notificationDeliveryPolicy.ts
git commit -m "feat(通知): NotifiableEventType 新增 device_online(默认开启+旧状态缺键兜底)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 后台通道类型 + nativeId 分组（手机）

**Files:**
- Test: `__tests__/backgroundNotifications.nativeId.test.ts`（新建）
- Modify: `src/utils/backgroundNotifications.ts:7,44-46`

- [ ] **Step 1: 写失败测试**

```ts
// __tests__/backgroundNotifications.nativeId.test.ts
import { nativeNotificationId } from '../src/utils/backgroundNotifications';
import type { PushNotificationItem } from '../src/store/types';

const item = (over: Partial<PushNotificationItem>): PushNotificationItem =>
  ({ id: 'n1', createdAt: 't', read: false, ...over }) as PushNotificationItem;

describe('nativeNotificationId for device presence', () => {
  test('device_online groups by device → vibe_device_<id>_online', () => {
    expect(
      nativeNotificationId(item({ type: 'device_online', deviceId: 'dev/A' })),
    ).toBe('vibe_device_dev_A_online');
  });

  test('device_offline keeps its existing grouping (regression)', () => {
    expect(
      nativeNotificationId(item({ type: 'device_offline', deviceId: 'dev/A' })),
    ).toBe('vibe_device_dev_A_offline');
  });
});
```

- [ ] **Step 2: 跑红**

Run: `cd "$PHONE" && npx jest "$PWD/__tests__/backgroundNotifications.nativeId.test.ts"`
Expected: FAIL（`device_online` 落到默认分支 `vibe_notification_n1`）

- [ ] **Step 3: 最小实现**

`src/utils/backgroundNotifications.ts`：

```ts
export type BackgroundNotificationType =
  | 'approval'
  | 'session_done'
  | 'session_failed'
  | 'device_offline'
  | 'device_online';
```

`nativeNotificationId` 中把

```ts
  if (item.type === 'device_offline' && item.deviceId) {
    return `vibe_device_${safeId(item.deviceId)}_offline`;
  }
```

改为

```ts
  // 同设备的上/下线通知共享一个原生槽位：后到的替换先到的，不叠加。
  if ((item.type === 'device_offline' || item.type === 'device_online') && item.deviceId) {
    return `vibe_device_${safeId(item.deviceId)}_${item.type === 'device_online' ? 'online' : 'offline'}`;
  }
```

（`notificationType()` 直通分支不动——`device_online` 自动透传，键值恒等是 spec §4.4 的硬约束。）

- [ ] **Step 4: 跑绿**

Run: `cd "$PHONE" && npx jest "$PWD/__tests__/backgroundNotifications.nativeId.test.ts"`
Expected: PASS (2 tests)

- [ ] **Step 5: 提交**

```bash
cd "$PHONE" && git add __tests__/backgroundNotifications.nativeId.test.ts src/utils/backgroundNotifications.ts
git commit -m "feat(通知): device_online 透传 + 按设备分组 nativeId

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: server 通知类型联合收口（手机）

**Files:**
- Modify: `src/api/notifications.ts:8`
- Modify: `src/store/types.ts:174`

- [ ] **Step 1: 两处联合类型加 `'device_online'`**

```ts
type: 'approval' | 'completed' | 'error' | 'device_offline' | 'device_online';
```

- [ ] **Step 2: typecheck 收口（Task 1 遗留的 TS 报错在此清零）**

Run: `cd "$PHONE" && npx tsc --noEmit`
Expected: exit 0。若 `NotificationCenterScreen.tsx` 三张映射表因联合扩大而报
「缺 device_online 键」——**这正是预期中的编译器检查**，先跳过该报错，
Task 5 处理；除此之外不得有其他报错。若出现其他文件报错，停下排查，不要顺手改。

- [ ] **Step 3: 提交**

```bash
cd "$PHONE" && git add src/api/notifications.ts src/store/types.ts
git commit -m "feat(通知): 手机端 server 通知类型联合加 device_online

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 点按路由——`device_online` 进设备详情页（手机）

**Files:**
- Test: `__tests__/notificationTap.deviceOnline.test.ts`（新建）
- Modify: `src/utils/notificationTap.ts:29-32`

- [ ] **Step 1: 写失败测试**

```ts
// __tests__/notificationTap.deviceOnline.test.ts
import { resolveNotificationTapTarget } from '../src/utils/notificationTap';

describe('device_online tap routing', () => {
  test('routes to DeviceDetail with the deviceId (same as offline)', () => {
    expect(
      resolveNotificationTapTarget({ type: 'device_online', deviceId: 'd1' }),
    ).toEqual({ route: 'DeviceDetail', params: { deviceId: 'd1' } });
  });

  test('without deviceId falls through to the session/none path (no crash)', () => {
    expect(resolveNotificationTapTarget({ type: 'device_online' })).toBeNull();
  });
});
```

- [ ] **Step 2: 跑红**

Run: `cd "$PHONE" && npx jest "$PWD/__tests__/notificationTap.deviceOnline.test.ts"`
Expected: 第 1 例 FAIL（device_online 无 deviceId 时落到 sessionId 分支返回 null——
恰好与第 2 例期望相同，所以第 2 例可能直接 PASS；红在带 deviceId 的第 1 例即可）

- [ ] **Step 3: 最小实现**

`src/utils/notificationTap.ts` 把

```ts
  if (data.type === 'device_offline' && deviceId) {
    return { route: 'DeviceDetail', params: { deviceId } };
  }
```

改为

```ts
  if ((data.type === 'device_offline' || data.type === 'device_online') && deviceId) {
    return { route: 'DeviceDetail', params: { deviceId } };
  }
```

- [ ] **Step 4: 跑绿**

Run: `cd "$PHONE" && npx jest "$PWD/__tests__/notificationTap.deviceOnline.test.ts"`
Expected: PASS (2 tests)

- [ ] **Step 5: 提交**

```bash
cd "$PHONE" && git add __tests__/notificationTap.deviceOnline.test.ts src/utils/notificationTap.ts
git commit -m "feat(通知): 点按设备上线通知进对应设备详情页

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 通知中心映射 + operations i18n（手机）

**Files:**
- Modify: `src/screens/operations/NotificationCenterScreen.tsx:28-51`（三张映射表）
- Modify: `src/i18n/locales/operations/zh.json:39` 附近（`notification` 键组）
- Modify: `src/i18n/locales/operations/en.json:39` 附近（同上）

- [ ] **Step 1: 三张映射表各加一行**

```ts
const notificationTypeKey: Record<PushNotificationItem['type'], string> = {
  approval: 'notification.typeApproval',
  completed: 'notification.typeCompleted',
  error: 'notification.typeError',
  device_offline: 'notification.typeOffline',
  device_online: 'notification.typeOnline',
};
// notificationTypeChip 加:  device_online: 'neutral',
// notificationIcon 加:      device_online: 'device',
```

（chip/icon 的值与 `device_offline` 完全一致；tsconfig 会强制三表同时补全，
漏一张 `tsc` 即红。）

- [ ] **Step 2: operations i18n 加键**（`notification` 键组内、`typeOffline` 旁边；
  该命名空间现有值就是英文，照抄惯例）

zh.json 与 en.json 都加：

```json
"typeOnline": "Online",
```

- [ ] **Step 3: 验证**

Run: `cd "$PHONE" && npx tsc --noEmit && npx jest "$PWD/__tests__/settingsNotifications.test.tsx"`
Expected: 双双 exit 0 / PASS

- [ ] **Step 4: 提交**

```bash
cd "$PHONE" && git add src/screens/operations/NotificationCenterScreen.tsx src/i18n/locales/operations/zh.json src/i18n/locales/operations/en.json
git commit -m "feat(通知中心): device_online 标签/色调/图标映射

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: settings i18n 键（手机）

**Files:**
- Modify: `src/i18n/locales/settings/zh.json`（`notifications` 键组）
- Modify: `src/i18n/locales/settings/en.json`（同上）

- [ ] **Step 1: zh.json** —— `notifications` 键组内（`"types"` 之前）加：

```json
"typesTitle": "通知类型",
"typesSummary": "{{enabled}}/{{total}} 已开启",
```

`"types"` 对象加一行：

```json
"device_online": "设备上线"
```

- [ ] **Step 2: en.json** 对应加：

```json
"typesTitle": "Notification types",
"typesSummary": "{{enabled}}/{{total}} enabled",
...
"device_online": "Device online"
```

- [ ] **Step 3: 验证 JSON 合法**

Run: `cd "$PHONE" && node -e "['zh','en'].forEach(l=>JSON.parse(require('fs').readFileSync('src/i18n/locales/settings/'+l+'.json'))); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: 提交**

```bash
cd "$PHONE" && git add src/i18n/locales/settings/zh.json src/i18n/locales/settings/en.json
git commit -m "feat(i18n): 通知类型弹窗标题/摘要 + device_online 中英文案

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: `NotificationTypesSheet` 组件（手机）

**Files:**
- Create: `src/components/settings/NotificationTypesSheet.tsx`
- Test: `__tests__/NotificationTypesSheet.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**（harness 参照 `__tests__/settingsNotifications.test.tsx`
  的 ThemeContext + SafeAreaProvider 包裹）

```tsx
// __tests__/NotificationTypesSheet.test.tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Switch, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { useSessionStore } from '../../stores/useSettingsStore';
import { NotificationTypesSheet } from '../src/components/settings/NotificationTypesSheet';

const renderSheet = () =>
  ReactTestRenderer.create(
    <ThemeContext.Provider
      value={{ theme: utilityMinimalist, mode: 'light', setMode: () => undefined, isDark: false }}
    >
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}
      >
        <NotificationTypesSheet open onClose={() => undefined} />
      </SafeAreaProvider>
    </ThemeContext.Provider>,
  );

describe('NotificationTypesSheet', () => {
  beforeEach(() => {
    useSessionStore.setState({
      notificationPrefs: {
        approval: true, session_done: true, session_failed: true,
        device_offline: true, device_online: true,
      },
    });
  });

  test('renders one switch row per notifiable type (5 rows)', () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => { r = renderSheet(); });
    const labels = r.root.findAllByType(Text).map(t => String(t.props.children ?? ''));
    expect(labels).toContain('审批请求');
    expect(labels).toContain('设备上线');
    expect(r.root.findAllByType(Switch)).toHaveLength(5);
  });

  test('toggling a switch writes back to the store', () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => { r = renderSheet(); });
    const offlineSwitch = r.root
      .findAllByType(Switch)
      .find(s => s.props.accessibilityLabel === '设备离线');
    act(() => { offlineSwitch!.props.onValueChange(false); });
    expect(useSessionStore.getState().notificationPrefs.device_offline).toBe(false);
  });
});
```

（开关定位依赖 `accessibilityLabel={t('notifications.types.<type>')}`，实现必须带上；
jest 的 i18n 已锁 zh，断言用中文。）

- [ ] **Step 2: 跑红**

Run: `cd "$PHONE" && npx jest "$PWD/__tests__/NotificationTypesSheet.test.tsx"`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现组件**

```tsx
// src/components/settings/NotificationTypesSheet.tsx
import React from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { BottomSheet } from '../shared/BottomSheet';
import { useSessionStore } from '../../../stores/useSettingsStore';
import {
  isEventTypeEnabled,
  type NotifiableEventType,
} from '../../utils/notificationDeliveryPolicy';

// Per-type notification toggles, reached from the Settings notification
// panel's single 「通知类型」 row. Keys are the NotifiableEventType union —
// identical to the `data.type` string carried by each background notification,
// so the background hook filters with zero mapping (spec §4.4).
const NOTIFIABLE_EVENT_TYPES: NotifiableEventType[] = [
  'approval',
  'session_done',
  'session_failed',
  'device_offline',
  'device_online',
];

export const NotificationTypesSheet: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { theme } = useTheme();
  const { t } = useTranslation('settings');
  const notificationPrefs = useSessionStore(s => s.notificationPrefs);
  const setNotificationPrefs = useSessionStore(s => s.setNotificationPrefs);

  return (
    <BottomSheet open={open} onClose={onClose} title={t('notifications.typesTitle')}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
        {NOTIFIABLE_EVENT_TYPES.map(type => {
          const enabled = isEventTypeEnabled(notificationPrefs, type);
          return (
            <View style={styles.row} key={type}>
              <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                {t(`notifications.types.${type}`)}
              </Text>
              <Switch
                value={enabled}
                accessibilityLabel={t(`notifications.types.${type}`)}
                trackColor={{
                  false: theme.colors.surfaceContainerHighest,
                  true: theme.colors.primaryContainer,
                }}
                thumbColor={enabled ? theme.colors.primary : theme.colors.onSurfaceVariant}
                onValueChange={value =>
                  setNotificationPrefs({ ...notificationPrefs, [type]: value })
                }
              />
            </View>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
});
```

（`StyleSheet` 需加入 react-native import；开关行样式沿用 `SettingsScreen.tsx:585-604`
现内联行的主题令牌，将来删内联行后样式令牌以此处为准。）

- [ ] **Step 4: 跑绿**

Run: `cd "$PHONE" && npx jest "$PWD/__tests__/NotificationTypesSheet.test.tsx"`
Expected: PASS (2 tests)

- [ ] **Step 5: 提交**

```bash
cd "$PHONE" && git add src/components/settings/NotificationTypesSheet.tsx __tests__/NotificationTypesSheet.test.tsx
git commit -m "feat(设置): NotificationTypesSheet 逐类通知开关底部弹窗

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: 设置页入口行替换内联开关（手机）

**Files:**
- Modify: `src/screens/settings/SettingsScreen.tsx:56-60,82-96 区域,582-607`
- Test: `__tests__/settingsNotifications.test.tsx`（追加用例）

- [ ] **Step 1: 写失败测试**（追加进现有 describe）

```tsx
test('the notification TYPES entry row opens the per-type sheet (inline switches replaced)', async () => {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => { r = renderScreen(); });
  await flush();

  // 入口行：标题 + 「N/5 已开启」摘要
  expect(findButtonByText(r.root, '通知类型')).toBeDefined();
  const summary = r.root.findAllByType(Text).map(t => String(t.props.children ?? ''));
  expect(summary.some(s => s === '5/5 已开启')).toBe(true);

  // 内联开关已被移除：面板里不再直接渲染类型 Switch
  // 点击入口行 → 弹窗出现，含 5 个类型开关
  const entry = findButtonByText(r.root, '通知类型');
  await act(async () => {
    (entry!.props as { onPress: () => void }).onPress();
    await flush();
  });
  const sheetSwitches = r.root.findAllByType(Switch);
  expect(sheetSwitches.length).toBeGreaterThanOrEqual(5);
});
```

（文件顶部需补 `import { Switch } from 'react-native';`——现有 import 只有
Text/TouchableOpacity/AppState。`NotificationTypesSheet` 挂在 SettingsScreen 后
需真实渲染，BottomSheet 走 reanimated mock + Modal，settings harness 已具备。）

- [ ] **Step 2: 跑红**

Run: `cd "$PHONE" && npx jest "$PWD/__tests__/settingsNotifications.test.tsx"`
Expected: 新用例 FAIL（找不到「通知类型」行），**既有 4 个用例必须仍 PASS**

- [ ] **Step 3: 改 SettingsScreen**

1. import 区加 `Pressable`（react-native，若无）与 `NotificationTypesSheet`。
2. 组件 state 区（`~line 91` 附近）加 `const [typesSheetOpen, setTypesSheetOpen] = useState(false);`
3. 删除 `SettingsScreen.tsx:582-607` 的 `NOTIFIABLE_EVENT_TYPES.map` 内联开关块，
   原位替换为：

```tsx
              <View style={styles.settingRow}>
                <View style={styles.settingCopy}>
                  <Text style={[theme.typography.bodyMd, { color: theme.colors.onSurface }]}>
                    {t('notifications.typesTitle')}
                  </Text>
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    {t('notifications.typesSummary', {
                      enabled: NOTIFIABLE_EVENT_TYPES.filter(
                        type => isEventTypeEnabled(notificationPrefs, type),
                      ).length,
                      total: NOTIFIABLE_EVENT_TYPES.length,
                    })}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setTypesSheetOpen(true)}
                  accessibilityLabel={t('notifications.typesTitle')}
                  hitSlop={8}
                >
                  <Text style={[theme.typography.labelMd, { color: theme.colors.primary }]}>
                    {t('common:notification.edit') ?? '›'}
                  </Text>
                </Pressable>
              </View>
              <NotificationTypesSheet
                open={typesSheetOpen}
                onClose={() => setTypesSheetOpen(false)}
              />
```

（`common:notification.edit` 若不存在则直接用 `'›'` 字面量——执行时以
`src/i18n/locales/common/zh.json` 的 `notification` 键组实况为准，不要发明新键。
右侧文案只做视觉提示，整行 Pressable 才是点击目标；`findButtonByText` 匹配的是
行内 Text，与 Pressable/TTouchableOpacity 包装兼容。）

4. `isEventTypeEnabled` 加入 settingsDeliveryPolicy import（该文件已从
   `../utils/notificationDeliveryPolicy` 导入 `NotifiableEventType`，扩展即可）。
5. 「通知类型」行放在权限按钮 GlassPanel 内、测试通知 GlassPanel 之前（即原开关块位置）。

- [ ] **Step 4: 跑绿**

Run: `cd "$PHONE" && npx jest "$PWD/__tests__/settingsNotifications.test.tsx" "$PWD/__tests__/NotificationTypesSheet.test.tsx"`
Expected: 全部 PASS（新用例 + 既有 4 例）

- [ ] **Step 5: 提交**

```bash
cd "$PHONE" && git add src/screens/settings/SettingsScreen.tsx __tests__/settingsNotifications.test.tsx
git commit -m "feat(设置): 通知类型改为入口行+底部弹窗,替换内联开关

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: 手机端全量验证门

- [ ] **Step 1: 全量测试 + 类型 + lint**

Run:
```bash
cd "$PHONE" && npx jest "$PWD/__tests__" && npx tsc --noEmit && npx eslint src/utils/notificationDeliveryPolicy.ts src/utils/backgroundNotifications.ts src/utils/notificationTap.ts src/screens/operations/NotificationCenterScreen.tsx src/screens/settings/SettingsScreen.tsx src/components/settings/NotificationTypesSheet.tsx __tests__/notificationDeliveryPolicy.test.ts __tests__/backgroundNotifications.nativeId.test.ts __tests__/notificationTap.deviceOnline.test.ts __tests__/NotificationTypesSheet.test.tsx
```
Expected: 全绿（本仓库基线 123 套件 + 新增 3 个纯函数测试文件 + 2 个组件测试）。
ESLint warning 预算是 0，不许引入新 warning。

- [ ] **Step 2: 如有残留未提交文件属本计划范围 → 补提交；否则进入 server 任务**

---

### Task 10: server `device_online` 守卫直发（SERVER 仓库）

**Files:**
- Modify: `SERVER/server/src/types.ts:785`（type 联合加 `'device_online'`）
- Modify: `SERVER/server/src/modules/device/lifecycle.ts`（新导出 `notifyDeviceBackOnline`）
- Test: `SERVER/server/test/modules/device/lifecycle.onlineNotify.test.ts`（新建）

- [ ] **Step 1: 写失败测试**（harness 照抄 `lifecycle.test.ts`：`resetAppState` +
  fake publisher）

```ts
// SERVER/server/test/modules/device/lifecycle.onlineNotify.test.ts
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRealtimePublisher } from '../../../src/shared/realtime/publish.js';
import { devices, notifications, resetAppState } from '../../../src/store.js';
import {
  markDeviceOfflineById,
  notifyDeviceBackOnline,
} from '../../../src/modules/device/lifecycle.js';

// 防风暴不变量（spec §4.3）：只有真走过 markDeviceOfflineById 的设备才发
// device_online；grace 吸掉的抖动、首次 hello 都不发。

const publish = vi.fn(async () => undefined);
beforeAll(() => initRealtimePublisher({ publish } as never));

beforeEach(() => {
  publish.mockClear();
  resetAppState();
  devices.set('d1', {
    id: 'd1',
    userId: 'u1',
    name: 'n',
    platform: 'darwin',
    status: 'online',
    capabilities: [],
    createdAt: 't',
  } as never);
});

const source = { kind: 'server' } as never;

describe('notifyDeviceBackOnline', () => {
  it('emits exactly one device_online after a real offline→online transition', async () => {
    await markDeviceOfflineById('d1', 'disconnected', source);
    const device = devices.get('d1')!;
    await notifyDeviceBackOnline(device, source, true);
    const emitted = [...notifications.values()].filter(n => n.type === 'device_online');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].deviceId).toBe('d1');
    expect(emitted[0].userId).toBe('u1');
  });

  it('emits nothing when the device was never marked offline (grace-blip / first hello)', async () => {
    const device = devices.get('d1')!;
    await notifyDeviceBackOnline(device, source, false);
    expect([...notifications.values()].filter(n => n.type === 'device_online')).toHaveLength(0);
  });
});
```

（`notifications` 若未从 `store.js` 导出则以实际导出为准——它由
`NotificationRepository.values()` 暴露，测试可改用
`NotificationRepository`；执行时先 `rg "export .*notifications" store.js` 确认。）

- [ ] **Step 2: 跑红**

Run: `cd "$SERVER" && npx vitest run server/test/modules/device/lifecycle.onlineNotify.test.ts`
Expected: FAIL（`notifyDeviceBackOnline` 未导出）

- [ ] **Step 3: 最小实现**

`server/src/types.ts:785`：

```ts
  type: 'approval' | 'completed' | 'error' | 'device_offline' | 'device_online';
```

`server/src/modules/device/lifecycle.ts` 末尾追加（`createNotification` 已 import，
`Device`/`RealtimePublishInput` 已 import）：

```ts
/**
 * device_online 通知——防风暴不变量的唯一发点（spec §4.3）：
 * `wasOffline` 必须来自 hello 路径在 DeviceRepository.upsert 之前捕获的
 * `existing?.status === 'offline'`。grace 窗口内的抖动从未被 mark offline，
 * 这里自然不发；首次 hello（existing 为空）同理。与 markDeviceOfflineById 的
 * wasOnline 守卫语义对称：没发过离线，就不发上线。
 */
export async function notifyDeviceBackOnline(
  device: Device,
  source: RealtimePublishInput['source'],
  wasOffline: boolean,
): Promise<void> {
  if (!wasOffline) return;
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

- [ ] **Step 4: 跑绿**

Run: `cd "$SERVER" && npx vitest run server/test/modules/device/lifecycle.onlineNotify.test.ts server/test/modules/device/lifecycle.test.ts`
Expected: 新 2 例 PASS，既有 lifecycle 用例无回归

- [ ] **Step 5: 提交**

```bash
cd "$SERVER" && git add server/src/types.ts server/src/modules/device/lifecycle.ts server/test/modules/device/lifecycle.onlineNotify.test.ts
git commit -m "feat(通知): notifyDeviceBackOnline——真离线→上线才发 device_online

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: server hello 路径接线（SERVER 仓库）

**Files:**
- Modify: `SERVER/server/src/modules/agent/handler.ts`（hello 路径两处）

- [ ] **Step 1: 捕获 wasOffline（upsert 之前）**

在 hello 路径 `const existing = ...`（约 `handler.ts:266`，`DeviceRepository.get`
返回值）赋值行之后、`DeviceRepository.upsert(device)`（约 `:323`）之前加：

```ts
      // spec §4.3: must be captured BEFORE upsert replaces the record —
      // this is the only faithful "was the device actually offline" signal.
      const wasOffline = existing?.status === 'offline';
```

- [ ] **Step 2: 注册成功后发通知**

在 `rememberAudit({ userId: ws.userId, deviceId, eventType: 'agent.online' });`
（约 `:452`）之后、`return;` 之前加：

```ts
      await notifyDeviceBackOnline(
        device,
        {
          kind: 'agent',
          user_id: ws.userId,
          device_id: deviceId,
          connection_id: socketConnectionId(ws),
        },
        wasOffline,
      );
```

import 行加 `notifyDeviceBackOnline`（来自 `../device/lifecycle.js`）。

- [ ] **Step 3: 全量回归 + 类型**

Run: `cd "$SERVER" && npx vitest run && npx tsc --noEmit -p server/tsconfig.json`
Expected: 全部 PASS / exit 0（spec §5 server 矩阵中「grace 内」「首次 hello」
两例由 Task 10 的单元守卫覆盖；handler 接线由 tsc 与 call-site 保证）

- [ ] **Step 4: 提交**

```bash
cd "$SERVER" && git add server/src/modules/agent/handler.ts
git commit -m "feat(通知): agent hello 路径接线 device_online(wasOffline 于 upsert 前捕获)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 12: 部署与真机验证（人工门，不自动执行）

**顺序强制：server 先上，手机后上**（spec §6：旧手机收新事件只是显示层过渡窗口，
反序会让新手机开关长期无事件源）。

- [ ] **Step 1: server 镜像构建 + k8s 更新** —— 走 memory
  `k8s-deploy-recipe-and-pitfalls` 配方（strategic-merge/完整 manifest，禁 merge-patch），
  版本号按 `v1.0.x` 递增；部署后 `rollout_status` 确认 + 观察通知风暴为 0。
- [ ] **Step 2: iPhone 重装** —— 走 memory `ios-free-team-install-recipe`
  （必须 `SWIFT_COMPILATION_MODE=singlefile`），设置页验证：入口行「通知类型 · 5/5
  已开启」→ 弹窗 5 开关 → 关掉「设备上线」→ 让 liang-dev 断网重连 → **不弹**；
  打开 → 再断连一次（等 grace 过期）→ 恰弹 1 条「设备上线」，点按进设备详情。
- [ ] **Step 3: Android**（可选）—— 推 `v*` tag 触发 release.yml 出 APK。

---

## 验收对照（spec §5 矩阵 → 任务映射）

| spec 测试项 | 覆盖任务 |
| --- | --- |
| 手机 5 类型 × 开/关 矩阵 | Task 7（sheet 开关写 store）+ Task 10 既有 `isEventTypeEnabled` 链路；后台过滤行为由既有 `useBackgroundNotifications.ts:84` 保证，交付前在 Task 12 Step 2 真机端到端验证 |
| 补发 / 迁移 | Task 1 Step 1（迁移）+ Task 12 Step 2（真机开关切换） |
| nativeId 分组 | Task 2 |
| 点按路由 | Task 4 |
| 弹窗 UI | Task 7 + Task 8 |
| server 转换 4+2 场景 | Task 10（守卫单测）+ Task 11（接线）+ Task 12 Step 2（端到端） |
