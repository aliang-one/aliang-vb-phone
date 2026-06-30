# Android 本地后台通知 v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Android app 在后台(进程活着)时,收到新 approval 或一个切后台时正在跑的回合结算(完成 / 失败),弹系统本地通知;点击跳进对应会话。纯客户端,server 零改动。

**Architecture:** 通知判定逻辑抽成纯函数(`decideBackgroundNotifications` / `resolveNotificationTapTarget`),沿用本仓纯逻辑测试范式(`sessionPhase.test.ts` 那类,无 `renderHook`)。React hook 只做「AppState + store 订阅 → 喂纯函数 → 调封装层」的薄壳。原生通知能力用 `react-native-notify-kit`(notifee 归档后的维护 fork),封装在 `localNotifications.ts` 里,平台守卫 + 懒加载,缺失/ iOS 降级为 no-op 不崩。

**Tech Stack:** React Native 0.85 (New Arch), Zustand (`useControlCenterStore`), `react-native-notify-kit`, jest。

**Spec:** `docs/superpowers/specs/2026-06-30-android-local-background-notifications-design.md`

**关键事实(已核查)**
- `useControlCenterStore`(`src/store/controlCenterStore.ts`):`events: UnifiedEvent[]`、`vibeRuns: VibeCodingRun[]`、`approvals: ApprovalRequest[]`,zustand `getState()` / `subscribe(cb)` 可用。
- `UnifiedEvent`(`store/types.ts:171`):`{ id, type, title, detail, status, sessionId?, approvalId?, ... }`。`approval.requested` 是 `UnifiedEventType` 之一。
- `VibeCodingRun`(`data/platformModels.ts:162`):`{ id, title, status: VibeStatus, ... }`。`VibeStatus = 'idle'|'running'|'waiting_user'|'waiting_approval'|'testing'|'preview_ready'|'failed'|'completed'|'paused'`。
- `ApprovalRequest`(`store/types.ts:117`):`{ id, title, summary, sessionId?, status, ... }`。
- `AppContent`(`App.tsx:12`)是根挂载点:`usePresenceHeartbeat()` 在此挂,`NavigationContainer` 在此(包 `RootNavigator`)。
- 路由 `VibeCodingSession` 接受 `{ sessionId?, approvalId? }`。
- 测试范式:`src/utils/__tests__/*.test.ts` 纯函数测试,**全仓无 `renderHook`**。
- `AndroidManifest.xml`(`android/app/src/main/AndroidManifest.xml`):目前只有 INTERNET/CAMERA/RECORD_AUDIO。

**环境限制(重要):本机无法做原生 gradle 构建 + 真机 e2e。** JS/TS 层 + jest + tsc 由本计划完成并验证;`react-native-notify-kit` 的原生链接、Android 构建、真机后台收通知 = **用户步骤**(Task 8),封装层已做平台守卫,未 rebuild 前 app 正常运行、通知功能静默 no-op。

---

## File Structure

| 文件 | 责任 | 创建/修改 |
|---|---|---|
| `src/utils/backgroundNotifications.ts` | 纯函数:给定 store 快照 + 后台基线 + 已通知集 → 算出该弹的通知 + 更新去重集 | 新建 |
| `src/utils/__tests__/backgroundNotifications.test.ts` | 上述纯函数测试 | 新建 |
| `src/utils/notificationTap.ts` | 纯函数:通知 data → 跳转目标(route+params)或 null | 新建 |
| `src/utils/__tests__/notificationTap.test.ts` | 上述纯函数测试 | 新建 |
| `src/services/localNotifications.ts` | notify-kit 封装:渠道 / 权限 / display / tap 订阅 / initial;平台守卫 + 懒加载 | 新建 |
| `src/hooks/useBackgroundNotifications.ts` | 薄 hook:AppState 布防 + store 订阅 → 纯函数 → displayNotification | 新建 |
| `src/app/navigation/navigationRef.ts` | `navigationRef`(`createNavigationContainerRef`) | 新建 |
| `App.tsx` | 挂 `navigationRef` 到 `NavigationContainer`;挂 `useBackgroundNotifications`;接 tap→navigate | 修改 |
| `android/app/src/main/AndroidManifest.xml` | 加 `POST_NOTIFICATIONS` 权限 | 修改 |
| `package.json` | 加 `react-native-notify-kit` | 修改 |

---

### Task 1: 纯判定逻辑 `decideBackgroundNotifications`(TDD 核心)

**Files:**
- Create: `src/utils/backgroundNotifications.ts`
- Test: `src/utils/__tests__/backgroundNotifications.test.ts`

- [ ] **Step 1: 写失败测试**

`src/utils/__tests__/backgroundNotifications.test.ts`:
```ts
import { decideBackgroundNotifications } from '../backgroundNotifications';
import type { UnifiedEvent, ApprovalRequest } from '../../store/types';
import type { VibeCodingRun } from '../../data/platformModels';

const ev = (over: Partial<UnifiedEvent> & { id: string }): UnifiedEvent => ({
  id: over.id, type: 'approval.requested', title: 't', detail: 'd',
  status: 'info', timestamp: '2026-06-30T00:00:00Z', ...over,
});
const run = (over: Partial<VibeCodingRun> & { id: string }): VibeCodingRun => ({
  id: over.id, title: over.title ?? 'S', deviceId: 'd', projectId: 'p',
  directory: '/', status: 'running', objective: '', model: '', ...over,
});
const approval = (over: Partial<ApprovalRequest> & { id: string }): ApprovalRequest => ({
  id: over.id, kind: 'file_write', title: '审批标题', summary: '摘要',
  deviceId: 'd', risk: 'medium', status: 'pending', createdAt: '', ...over,
});
const baseInput = {
  isBackground: true,
  events: [] as UnifiedEvent[],
  runs: [] as VibeCodingRun[],
  approvals: [] as ApprovalRequest[],
  baselineEventIds: new Set<string>(),
  runningAtBackground: new Set<string>(),
  alreadyNotified: new Set<string>(),
};

describe('decideBackgroundNotifications', () => {
  it('前台一律不弹', () => {
    const r = decideBackgroundNotifications({
      ...baseInput, isBackground: false,
      events: [ev({ id: 'e1', approvalId: 'a1' })],
    });
    expect(r.notifications).toHaveLength(0);
  });

  it('后台新增 approval(非基线)→ 弹一次,标题/正文取 approvals 查得的 title/summary', () => {
    const r = decideBackgroundNotifications({
      ...baseInput,
      events: [ev({ id: 'e1', approvalId: 'a1', sessionId: 's1' })],
      approvals: [approval({ id: 'a1', title: 'T', summary: 'Sum' })],
    });
    expect(r.notifications).toHaveLength(1);
    expect(r.notifications[0].title).toBe('需要审批');
    expect(r.notifications[0].body).toBe('T');
    expect(r.notifications[0].data).toEqual({ type: 'approval', sessionId: 's1', approvalId: 'a1' });
    expect(r.notifiedKeys.has('approval:a1')).toBe(true);
  });

  it('基线里已有的 approval(切后台前就在)→ 不弹', () => {
    const r = decideBackgroundNotifications({
      ...baseInput,
      events: [ev({ id: 'e1', approvalId: 'a1' })],
      baselineEventIds: new Set(['e1']),
    });
    expect(r.notifications).toHaveLength(0);
  });

  it('同一 approval 第二次计算 → 去重,不重复弹', () => {
    const first = decideBackgroundNotifications({
      ...baseInput, events: [ev({ id: 'e1', approvalId: 'a1' })],
    });
    const second = decideBackgroundNotifications({
      ...baseInput, events: [ev({ id: 'e1', approvalId: 'a1' })],
      alreadyNotified: first.notifiedKeys,
    });
    expect(second.notifications).toHaveLength(0);
  });

  it('切后台时正在 running 的会话 → completed → 弹「会话已完成」', () => {
    const r = decideBackgroundNotifications({
      ...baseInput,
      runs: [run({ id: 's1', status: 'completed', title: 'MySession' })],
      runningAtBackground: new Set(['s1']),
    });
    expect(r.notifications).toHaveLength(1);
    expect(r.notifications[0].title).toBe('会话已完成');
    expect(r.notifications[0].data).toEqual({ type: 'session_done', sessionId: 's1' });
  });

  it('切后台时正在 running 的会话 → idle → 弹完成(idle 视为结算)', () => {
    const r = decideBackgroundNotifications({
      ...baseInput,
      runs: [run({ id: 's1', status: 'idle' })],
      runningAtBackground: new Set(['s1']),
    });
    expect(r.notifications[0].title).toBe('会话已完成');
  });

  it('切后台时正在 running 的会话 → failed → 弹「会话失败」', () => {
    const r = decideBackgroundNotifications({
      ...baseInput,
      runs: [run({ id: 's1', status: 'failed' })],
      runningAtBackground: new Set(['s1']),
    });
    expect(r.notifications[0].title).toBe('会话失败');
    expect(r.notifications[0].data.type).toBe('session_failed');
  });

  it('切后台时不在 running 的会话结算 → 不弹(避免噪音)', () => {
    const r = decideBackgroundNotifications({
      ...baseInput,
      runs: [run({ id: 's1', status: 'completed' })],
      runningAtBackground: new Set(), // s1 不在基线
    });
    expect(r.notifications).toHaveLength(0);
  });

  it('中途态(waiting_approval/testing/paused)→ 不弹完成', () => {
    for (const status of ['waiting_approval', 'testing', 'paused', 'preview_ready', 'waiting_user'] as const) {
      const r = decideBackgroundNotifications({
        ...baseInput,
        runs: [run({ id: 's1', status })],
        runningAtBackground: new Set(['s1']),
      });
      expect(r.notifications).toHaveLength(0);
    }
  });

  it('会话先 failed 再 completed → failed 与 done 各至多一次(去重)', () => {
    const r1 = decideBackgroundNotifications({
      ...baseInput, runs: [run({ id: 's1', status: 'failed' })], runningAtBackground: new Set(['s1']),
    });
    const r2 = decideBackgroundNotifications({
      ...baseInput, runs: [run({ id: 's1', status: 'completed' })],
      runningAtBackground: new Set(['s1']), alreadyNotified: r1.notifiedKeys,
    });
    expect(r1.notifications.map(n => n.title)).toEqual(['会话失败']);
    expect(r2.notifications.map(n => n.title)).toEqual(['会话已完成']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/utils/__tests__/backgroundNotifications.test.ts`
Expected: FAIL — `decideBackgroundNotifications is not a function` / 模块不存在。

- [ ] **Step 3: 写实现**

`src/utils/backgroundNotifications.ts`:
```ts
import type { ApprovalRequest, UnifiedEvent } from '../store/types';
import type { VibeCodingRun } from '../data/platformModels';

export type BackgroundNotificationType =
  | 'approval'
  | 'session_done'
  | 'session_failed';

export interface PendingLocalNotification {
  key: string;
  title: string;
  body: string;
  data: {
    type: BackgroundNotificationType;
    sessionId?: string;
    approvalId?: string;
  };
}

export interface BackgroundNotifyInput {
  /** 仅当 app 在后台才弹。 */
  isBackground: boolean;
  events: UnifiedEvent[];
  runs: VibeCodingRun[];
  approvals: ApprovalRequest[];
  /** 切后台那一刻已存在的 approval.requested 事件 id(不重复通知历史)。 */
  baselineEventIds: Set<string>;
  /** 切后台那一刻处于 running 的会话 id(只有这些结算才通知)。 */
  runningAtBackground: Set<string>;
  /** 本次后台窗口已通知的去重键。 */
  alreadyNotified: Set<string>;
}

export interface BackgroundNotifyResult {
  notifications: PendingLocalNotification[];
  /** 更新后的去重集(原集合 ∪ 本次发出的 key)。 */
  notifiedKeys: Set<string>;
}

/** 真正「回合结束」的终态:idle(球回用户)/ completed(关闭)。 */
const DONE_STATUSES: ReadonlySet<string> = new Set(['idle', 'completed']);

export function decideBackgroundNotifications(
  input: BackgroundNotifyInput,
): BackgroundNotifyResult {
  const notifications: PendingLocalNotification[] = [];
  const notified = new Set(input.alreadyNotified);

  if (!input.isBackground) {
    return { notifications, notifiedKeys: notified };
  }

  // 1) 新 approval.requested(非基线、未通知)。
  for (const event of input.events) {
    if (event.type !== 'approval.requested') continue;
    if (!event.approvalId) continue;
    if (input.baselineEventIds.has(event.id)) continue;
    const key = `approval:${event.approvalId}`;
    if (notified.has(key)) continue;
    const found = input.approvals.find(a => a.id === event.approvalId);
    const body =
      found?.title || found?.summary || event.title || event.detail || '有新的审批请求';
    notifications.push({
      key,
      title: '需要审批',
      body,
      data: { type: 'approval', sessionId: event.sessionId, approvalId: event.approvalId },
    });
    notified.add(key);
  }

  // 2) 切后台时正在跑的会话,如今结算/失败。
  for (const r of input.runs) {
    if (!input.runningAtBackground.has(r.id)) continue;
    if (r.status === 'failed') {
      const key = `session:${r.id}:failed`;
      if (!notified.has(key)) {
        notifications.push({
          key, title: '会话失败',
          body: r.title || '点按查看详情',
          data: { type: 'session_failed', sessionId: r.id },
        });
        notified.add(key);
      }
    } else if (DONE_STATUSES.has(r.status)) {
      const key = `session:${r.id}:done`;
      if (!notified.has(key)) {
        notifications.push({
          key, title: '会话已完成',
          body: r.title || '点按查看回复',
          data: { type: 'session_done', sessionId: r.id },
        });
        notified.add(key);
      }
    }
    // waiting_approval/testing/paused/preview_ready/waiting_user/running → 中途态,不通知。
  }

  return { notifications, notifiedKeys: notified };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/utils/__tests__/backgroundNotifications.test.ts`
Expected: PASS(全部用例)。

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`
Expected: 0 error。

- [ ] **Step 6: Commit**

```bash
git add src/utils/backgroundNotifications.ts src/utils/__tests__/backgroundNotifications.test.ts
git commit -m "feat(notifications): pure background-notification decision logic"
```

---

### Task 2: 纯点击解析 `resolveNotificationTapTarget`(TDD)

**Files:**
- Create: `src/utils/notificationTap.ts`
- Test: `src/utils/__tests__/notificationTap.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { resolveNotificationTapTarget } from '../notificationTap';

describe('resolveNotificationTapTarget', () => {
  it('approval → VibeCodingSession 带 sessionId + approvalId', () => {
    const t = resolveNotificationTapTarget({ type: 'approval', sessionId: 's1', approvalId: 'a1' });
    expect(t).toEqual({ route: 'VibeCodingSession', params: { sessionId: 's1', approvalId: 'a1' } });
  });
  it('session_done → 只带 sessionId', () => {
    const t = resolveNotificationTapTarget({ type: 'session_done', sessionId: 's1' });
    expect(t).toEqual({ route: 'VibeCodingSession', params: { sessionId: 's1', approvalId: undefined } });
  });
  it('缺 sessionId → null(无处可跳)', () => {
    expect(resolveNotificationTapTarget({ type: 'approval', approvalId: 'a1' })).toBeNull();
  });
  it('null/undefined → null', () => {
    expect(resolveNotificationTapTarget(null)).toBeNull();
    expect(resolveNotificationTapTarget(undefined)).toBeNull();
  });
  it('非 approval 类型不带 approvalId', () => {
    const t = resolveNotificationTapTarget({ type: 'session_failed', sessionId: 's1', approvalId: 'a1' });
    expect(t?.params.approvalId).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/utils/__tests__/notificationTap.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 写实现**

`src/utils/notificationTap.ts`:
```ts
export interface NotificationTapData {
  type?: string;
  sessionId?: string;
  approvalId?: string;
}

export interface NotificationTapTarget {
  route: 'VibeCodingSession';
  params: { sessionId?: string; approvalId?: string };
}

/** 把通知 data 解析成跳转目标。无 sessionId 返回 null(无处可跳)。 */
export function resolveNotificationTapTarget(
  data: NotificationTapData | null | undefined,
): NotificationTapTarget | null {
  if (!data) return null;
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
  if (!sessionId) return null;
  const approvalId =
    data.type === 'approval' && typeof data.approvalId === 'string'
      ? data.approvalId
      : undefined;
  return { route: 'VibeCodingSession', params: { sessionId, approvalId } };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/utils/__tests__/notificationTap.test.ts`
Expected: PASS。

- [ ] **Step 5: tsc + Commit**

```bash
git add src/utils/notificationTap.ts src/utils/__tests__/notificationTap.test.ts
git commit -m "feat(notifications): pure notification-tap target resolver"
```

---

### Task 3: notify-kit 封装 `localNotifications.ts`(平台守卫)

**Files:**
- Create: `src/services/localNotifications.ts`
- Modify: `package.json`(加依赖)

- [ ] **Step 1: 装依赖**

Run: `npm install react-native-notify-kit`
(若与 RN 0.85 New Arch 有 peer 警告,记录之;不影响 JS 层。原生链接 = 用户 rebuild 步骤。)

- [ ] **Step 2: 写封装(平台守卫 + 懒加载)**

`src/services/localNotifications.ts`:
```ts
import { Platform } from 'react-native';

/**
 * notify-kit(notifee 维护 fork)封装。平台守卫 + 懒加载:
 * iOS 或 Android 未 rebuild(原生模块缺失)→ 降级为 no-op,绝不抛、不崩核心屏。
 * 镜像 voiceRecorder.ts 的懒 require + try/catch 既有范式。
 */
type NotifyKit = typeof import('react-native-notify-kit');

let cache: NotifyKit | null = null;
let unavailable = false;

function load(): NotifyKit | null {
  if (unavailable) return null;
  if (cache) return cache;
  if (Platform.OS !== 'android') {
    unavailable = true;
    return null;
  }
  try {
    cache = require('react-native-notify-kit');
    return cache;
  } catch {
    unavailable = true;
    return null;
  }
}

const CHANNEL_ID = 'vibe_background';
let channelEnsured = false;

export async function ensureChannel(): Promise<void> {
  const lib = load();
  if (!lib || channelEnsured) return;
  try {
    await lib.createChannel({
      id: CHANNEL_ID,
      name: 'Vibe 后台通知',
      importance: lib.AndroidImportance.HIGH,
    });
    channelEnsured = true;
  } catch {
    /* ignore */
  }
}

/** 返回是否已授权。失败/不可用 → false。 */
export async function requestPermission(): Promise<boolean> {
  const lib = load();
  if (!lib) return false;
  try {
    const status = await lib.requestPermission();
    return status.authorizationStatus === lib.AuthorizationStatus.AUTHORIZED;
  } catch {
    return false;
  }
}

export interface LocalNotificationInput {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function displayNotification(n: LocalNotificationInput): Promise<void> {
  const lib = load();
  if (!lib) return;
  await ensureChannel();
  try {
    await lib.displayNotification({
      title: n.title,
      body: n.body,
      data: n.data,
      android: {
        channelId: CHANNEL_ID,
        smallIcon: 'ic_launcher',
        pressAction: { id: 'default' },
      },
    });
  } catch {
    /* ignore — best-effort */
  }
}

/** 订阅通知点击(PRESS)。返回取消订阅函数。不可用 → 空 no-op。 */
export function onNotificationPress(
  cb: (data: Record<string, unknown> | undefined) => void,
): () => void {
  const lib = load();
  if (!lib) return () => undefined;
  try {
    return lib.onForegroundEvent(({ type, detail }) => {
      if (type === lib.EventType.PRESS) {
        cb(detail?.notification?.data as Record<string, unknown> | undefined);
      }
    });
  } catch {
    return () => undefined;
  }
}

/** 冷启动时被通知拉起 → 返回那条通知的 data。 */
export async function getInitialNotificationData(): Promise<
  Record<string, unknown> | undefined
> {
  const lib = load();
  if (!lib) return undefined;
  try {
    const initial = await lib.getInitialNotification();
    return initial?.notification?.data as Record<string, unknown> | undefined;
  } catch {
    return undefined;
  }
}
```

> 注:`createChannel` / `requestPermission` / `displayNotification` / `onForegroundEvent` / `getInitialNotification` / `AndroidImportance` / `AuthorizationStatus` / `EventType` 均为 notifee/notify-kit 的标准 API(notify-kit 是 notifee 的 drop-in fork)。Step 3 的 `tsc` 会比对已安装包的类型;若该 fork 的导出名有出入,按 `node_modules/react-native-notify-kit` 的 `.d.ts` 修正。

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: 0 error(若有 notify-kit 类型不符,按实际 `.d.ts` 修正导出名)。

- [ ] **Step 4: Commit**

```bash
git add src/services/localNotifications.ts package.json package-lock.json
git commit -m "feat(notifications): platform-guarded notify-kit wrapper"
```

---

### Task 4: navigationRef + 后台通知 hook + tap 接线

**Files:**
- Create: `src/app/navigation/navigationRef.ts`
- Create: `src/hooks/useBackgroundNotifications.ts`
- Modify: `App.tsx`

- [ ] **Step 1: navigationRef**

`src/app/navigation/navigationRef.ts`:
```ts
import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
```
(若 `RootStackParamList` 未从 `./types` 导出,改从其实际定义文件导入——执行时核对 `src/app/navigation/types.ts`。)

- [ ] **Step 2: 后台通知 hook(薄壳)**

`src/hooks/useBackgroundNotifications.ts`:
```ts
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useControlCenterStore } from '../store/controlCenterStore';
import { decideBackgroundNotifications } from '../utils/backgroundNotifications';
import { displayNotification, requestPermission } from '../services/localNotifications';

/**
 * 后台期间:store 变更 → 喂纯函数 decideBackgroundNotifications → 弹本地通知。
 * 切后台时快照基线(已存在 approval 事件 id + 正在 running 的会话 id);回前台清空。
 * 纯判定逻辑见 utils/backgroundNotifications(已单测);本 hook 只做接线。
 */
export function useBackgroundNotifications(): void {
  const isBackgroundRef = useRef<boolean>(false);
  const baselineEventIdsRef = useRef<Set<string>>(new Set());
  const runningAtBackgroundRef = useRef<Set<string>>(new Set());
  const alreadyNotifiedRef = useRef<Set<string>>(new Set());

  // store 变更检查(后台才工作)。
  useEffect(() => {
    const check = () => {
      if (!isBackgroundRef.current) return;
      const s = useControlCenterStore.getState();
      const result = decideBackgroundNotifications({
        isBackground: true,
        events: s.events,
        runs: s.vibeRuns,
        approvals: s.approvals,
        baselineEventIds: baselineEventIdsRef.current,
        runningAtBackground: runningAtBackgroundRef.current,
        alreadyNotified: alreadyNotifiedRef.current,
      });
      alreadyNotifiedRef.current = result.notifiedKeys;
      for (const n of result.notifications) {
        void displayNotification({ title: n.title, body: n.body, data: n.data });
      }
    };
    return useControlCenterStore.subscribe(check);
  }, []);

  // AppState 布防 / 撤防 + 权限申请。
  useEffect(() => {
    const snapshot = () => {
      const s = useControlCenterStore.getState();
      baselineEventIdsRef.current = new Set(
        s.events.filter(e => e.type === 'approval.requested').map(e => e.id),
      );
      runningAtBackgroundRef.current = new Set(
        s.vibeRuns.filter(r => r.status === 'running').map(r => r.id),
      );
      alreadyNotifiedRef.current = new Set();
    };
    const onChange = (next: AppStateStatus) => {
      const goingBackground = next !== 'active';
      if (goingBackground && !isBackgroundRef.current) {
        snapshot();
        isBackgroundRef.current = true;
      } else if (!goingBackground && isBackgroundRef.current) {
        isBackgroundRef.current = false;
        snapshot(); // 清空,为下次后台准备
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    isBackgroundRef.current = AppState.currentState !== 'active';
    if (isBackgroundRef.current) snapshot();
    void requestPermission(); // 首次挂载请求(Android 13+ POST_NOTIFICATIONS)
    return () => sub.remove();
  }, []);
}
```

- [ ] **Step 3: App.tsx 接线(挂 ref + hook + tap)**

修改 `App.tsx`:
- 顶部 import:
```ts
import { navigationRef } from './src/app/navigation/navigationRef';
import { useBackgroundNotifications } from './src/hooks/useBackgroundNotifications';
import { onNotificationPress, getInitialNotificationData } from './src/services/localNotifications';
import { resolveNotificationTapTarget } from './src/utils/notificationTap';
import { useSessionStore } from './stores/useSettingsStore';
import { useEffect } from 'react';
```
- `NavigationContainer` 加 `ref={navigationRef}`:
```tsx
      <NavigationContainer
        ref={navigationRef}
        theme={{ ... }}>
```
- `AppContent` 内,与 `usePresenceHeartbeat()` 并列:
```ts
  usePresenceHeartbeat();
  useBackgroundNotifications();

  useEffect(() => {
    const unsub = onNotificationPress(data => {
      const target = resolveNotificationTapTarget(data as never);
      if (target && navigationRef.isReady()) {
        navigationRef.navigate(target.route, target.params);
      }
    });
    void getInitialNotificationData().then(data => {
      const target = resolveNotificationTapTarget(data as never);
      if (!target) return;
      const tryNav = () => {
        const { hasHydrated, token } = useSessionStore.getState();
        if (hasHydrated && token && navigationRef.isReady()) {
          navigationRef.navigate(target.route, target.params);
        } else {
          setTimeout(tryNav, 200);
        }
      };
      tryNav();
    });
    return unsub;
  }, []);
```
> 已核查:`useSessionStore` 定义在 `stores/useSettingsStore.ts:50`(仓库根 `stores/`,非 `src/store/`),导出名即 `useSessionStore`,含 `hasHydrated` / `token` / `restoreUser`(`RootNavigator.tsx:29,162-164` 同此导入)。`App.tsx` 在仓库根,故 import 为 `'./stores/useSettingsStore'`。

- [ ] **Step 4: tsc**

Run: `npx tsc --noEmit`
Expected: 0 error。

- [ ] **Step 5: Commit**

```bash
git add src/app/navigation/navigationRef.ts src/hooks/useBackgroundNotifications.ts App.tsx
git commit -m "feat(notifications): wire background notifications + tap navigation"
```

---

### Task 5: AndroidManifest 权限

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: 加 POST_NOTIFICATIONS**

在现有 `<uses-permission .../>` 之后加:
```xml
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

- [ ] **Step 2: Commit**

```bash
git add android/app/src/main/AndroidManifest.xml
git commit -m "feat(notifications): add Android POST_NOTIFICATIONS permission"
```

---

### Task 6: 全量验证(零回归)

- [ ] **Step 1: tsc 全量**

Run: `npx tsc --noEmit`
Expected: 0 error。

- [ ] **Step 2: jest 全量**

Run: `npx jest`
Expected: 通过新测(backgroundNotifications + notificationTap),其余维持基线(本仓历史 terminal flake ≈ 3,见 memory)。

- [ ] **Step 3: 若有回归 → 修;否则记录绿数**

---

### Task 7: (用户步骤,本机不可执行)原生构建 + 真机验证

> 本机无法做 gradle 构建 / 真机 e2e。以下由用户完成:

- [ ] **用户 Step 1:** Android 原生 rebuild(`cd android && ./gradlew assembleDebug` 或 `npx react-native run-android`),让 `react-native-notify-kit` 原生模块链接生效。
- [ ] **用户 Step 2:** 真机:登录 → 发起一个会话 → 切后台 → 触发 approval / 等回合结算 → 验证收到系统通知。
- [ ] **用户 Step 3:** 点通知 → 验证跳进对应会话(app 在后台 / 被杀冷启动两种路径)。
- [ ] **用户 Step 4:** 国产 ROM(小米/华为/OPPO/vivo)实测后台存活时长与可靠性(已知上限:被杀则不通知)。

---

## 记得
- 纯逻辑先行(TDD Task 1/2),hook/wrapper 只接线。
- 封装层务必平台守卫:未 rebuild 前 app 必须正常运行、通知静默 no-op。
- 全程 tsc + jest 验证;原生/真机步骤显式标给用户,不谎称已验证。
