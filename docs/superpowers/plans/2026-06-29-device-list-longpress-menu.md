# 设备列表长按菜单(详细介绍 / 重命名 / 删除)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「Vibe Command」首页设备列表的 `DeviceControlCard` 上加长按菜单:详细介绍(底部信息卡)、重命名、删除(硬删除,二次确认)。

**Architecture:** 纯手机端改动,零后端/agent 变更。重命名复用已实现但未被调用的 store action `renameDevice`;删除新增 transport 方法 `unbindDevice` + store action `removeDevice`(其状态迁移抽成纯 helper 便于单测,符合本仓 internals 纯函数测试惯例);卡片镜像 `VibeSessionCard` 的长按菜单 Modal 模式。

**Tech Stack:** React Native 0.85(New Arch)、TypeScript、zustand(`controlCenterStore` + slices/internals)、jest。tsc 为权威(LSP 在重构期 desync)。

**Spec:** `docs/superpowers/specs/2026-06-29-device-list-longpress-menu-design.md`

**全链路核查结论(详见 spec §2):** 后端重命名(`PATCH /api/devices/:id/settings` `{name}`)与删除(`POST /api/devices/:id/unbind`,硬删除)已完全就绪;phone API 已封装。缺口仅在手机端。

---

## 文件结构

| 文件 | 责任 | 改动 |
|---|---|---|
| `src/store/internals.ts` | 纯状态迁移 helper | 新增 `removeDeviceFromState` |
| `src/store/__tests__/internals.test.ts` | 纯函数单测 | 新增 `removeDeviceFromState` 测试 |
| `src/services/platformTransport.ts` | server API 适配层 | 新增 `unbindDevice` 方法 + import |
| `src/store/types.ts` | store 类型契约 | 新增 `removeDevice` 签名 |
| `src/store/slices/deviceProjectSlice.ts` | device/project actions | 新增 `removeDevice` action |
| `src/components/vibecoding/DeviceControlCard.tsx` | 设备卡片 UI | 加长按菜单 + 信息卡 + 重命名 + 删除确认 |

**测试策略说明(偏离 spec §7):** 本仓的 **store 测试一律测 internals 里的纯函数**,不 import 整个 store(见 `internals.test.ts`/`structuredEvents.test.ts`;import 整个 store 会拖入 WS 等重依赖,现有测试刻意回避)。因此删除的状态迁移抽成纯 helper `removeDeviceFromState` 并单测(Task 1);transport/action 是薄接线,靠 tsc + helper 测试覆盖(Task 2-3)。本仓**有少量组件测试**(`MessageComposer.test.tsx`/`useVoiceStt.test.tsx`,用 `react-test-renderer`+`act`,针对交互复杂的组件);但 `DeviceControlCard` 菜单是薄状态切换 + 调用已被单测的 store action,故卡片 UI 本计划靠 tsc + 真机手测(Task 4-5),不新增组件测试。若评审认为必要,可在 Task 4 追加一个 react-test-renderer 组件测试(需 mock `useControlCenterStore`/`useTheme`)。

---

## Task 1: 纯 helper `removeDeviceFromState` + 单测(TDD)

**Files:**
- Modify: `src/store/internals.ts`(在 `attachDeviceRelations` 附近,~line 1378 之后)
- Test: `src/store/__tests__/internals.test.ts`

- [ ] **Step 1: 写失败测试** — 在 `internals.test.ts` 顶部 import 区加 `removeDeviceFromState`,并新增测试块:

```ts
// 加入已有 import { ... } from '../internals'; 列表
import {
  attachActiveSessionIds,
  attachDeviceRelations,
  attachProjectIds,
  removeDeviceFromState,            // ← 新增
  // ...其余保持
} from '../internals';

// 复用文件里已有的 makeRun / makeDevice 风格的最小 mock(字段 cast through unknown)
const makeDevice = (id: string): Device =>
  ({ id, name: id, status: 'online' }) as unknown as Device;
const makeProject = (id: string, deviceId: string): Project =>
  ({ id, deviceId }) as unknown as Project;

describe('removeDeviceFromState', () => {
  it('removes the device, its projects and vibe runs, and emits an event', () => {
    const devices = [makeDevice('d1'), makeDevice('d2')];
    const projects = [makeProject('p1', 'd1'), makeProject('p2', 'd2')];
    const vibeRuns = [makeRun({ id: 'r1', deviceId: 'd1' })];
    const result = removeDeviceFromState(devices, projects, vibeRuns, [], 'd1', 'Dev One');
    expect(result.devices.map(d => d.id)).toEqual(['d2']);
    expect(result.projects.map(p => p.id)).toEqual(['p2']);
    expect(result.vibeRuns.map(r => r.id)).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Device removed');
    expect(result.events[0].detail).toBe('Dev One');
    expect(result.events[0].type).toBe('device.bound');
  });

  it('leaves unrelated devices/projects untouched when deviceId absent', () => {
    const devices = [makeDevice('d2')];
    const projects = [makeProject('p2', 'd2')];
    const result = removeDeviceFromState(devices, projects, [], [], 'missing', 'X');
    expect(result.devices.map(d => d.id)).toEqual(['d2']);
    expect(result.projects.map(p => p.id)).toEqual(['p2']);
    expect(result.events).toHaveLength(1);
  });
});
```

注:`makeRun` 已存在于该测试文件(见 head),签名 `makeRun(over: Partial<VibeCodingRun> & { id: string })`。若 `Device`/`Project` 类型未 import,从 `'../../data/platformModels'` 补 import(文件已 import `Device`/`Project`,核对即可)。

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx jest src/store/__tests__/internals.test.ts -t "removeDeviceFromState"`
Expected: FAIL(`removeDeviceFromState is not exported`)。

- [ ] **Step 3: 实现 helper** — 在 `src/store/internals.ts`(`attachDeviceRelations` 定义之后)加:

```ts
/**
 * Pure state transition for removing a device after a successful /unbind.
 * Drops the device, any projects / vibe runs referencing it, re-attaches
 * relation counts on surviving devices, and prepends a 'Device removed' event.
 * Tested directly (see internals.test.ts) — the store action is a thin wrapper.
 */
export const removeDeviceFromState = (
  devices: Device[],
  projects: Project[],
  vibeRuns: VibeCodingRun[],
  events: UnifiedEvent[],
  deviceId: string,
  deviceName: string,
): { devices: Device[]; projects: Project[]; vibeRuns: VibeCodingRun[]; events: UnifiedEvent[] } => {
  const nextProjects = projects.filter(project => project.deviceId !== deviceId);
  const nextVibeRuns = vibeRuns.filter(run => run.deviceId !== deviceId);
  return {
    projects: nextProjects,
    vibeRuns: nextVibeRuns,
    devices: attachDeviceRelations(
      devices.filter(device => device.id !== deviceId),
      nextProjects,
      nextVibeRuns,
    ),
    events: [
      event('device.bound', 'Device removed', deviceName, 'done', { deviceId }),
      ...events,
    ].slice(0, 120),
  };
};
```

(`Device`/`Project`/`VibeCodingRun`/`UnifiedEvent`/`attachDeviceRelations`/`event` 均已在 internals.ts 作用域内。)

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx jest src/store/__tests__/internals.test.ts -t "removeDeviceFromState"`
Expected: PASS(2 tests)。

- [ ] **Step 5: tsc 全量**

Run: `npx tsc --noEmit`
Expected: EXIT 0(确认 helper 类型正确;忽略 LSP stale 诊断)。

- [ ] **Step 6: Commit**

```bash
git add src/store/internals.ts src/store/__tests__/internals.test.ts
git commit -m "feat(store): add removeDeviceFromState pure helper + tests"
```

---

## Task 2: transport 暴露 `unbindDevice`

**Files:**
- Modify: `src/services/platformTransport.ts:1-4`(import)、`:325` 附近(方法)

- [ ] **Step 1: 加 import** — 把 `api/devices` 的 import 块改为同时引入 `unbindDevice`:

```ts
import {
  unbindDevice as apiUnbindDevice,           // ← 新增
  updateDeviceSettings as apiUpdateDeviceSettings,
  type ServerDevice,
} from '../api/devices';
```

- [ ] **Step 2: 加方法** — 紧邻 `scanDeviceProjects`(镜像其最简形态):

```ts
  unbindDevice(deviceId: string): Promise<{ status: string; device_id: string }> {
    return apiUnbindDevice(deviceId);
  }
```

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: EXIT 0。

- [ ] **Step 4: Commit**

```bash
git add src/services/platformTransport.ts
git commit -m "feat(transport): expose unbindDevice"
```

---

## Task 3: store `removeDevice` action + 类型

**Files:**
- Modify: `src/store/types.ts`(`renameDevice` 声明之后)
- Modify: `src/store/slices/deviceProjectSlice.ts`(import 块、`Pick` 类型、`renameDevice` 之后)

- [ ] **Step 1: types.ts 加签名** — 在 `renameDevice` 声明后插入:

```ts
  renameDevice: (deviceId: string, name: string) => Promise<BindDeviceResult>;
  removeDevice: (deviceId: string) => Promise<BindDeviceResult>;   // ← 新增
  scanDeviceProjects: (deviceId: string) => Promise<void>;
```

- [ ] **Step 2: slice 的 import 加 `removeDeviceFromState`** — 在 `deviceProjectSlice.ts` 顶部 `import { attachDeviceRelations, event, ... } from '../internals';` 列表里加 `removeDeviceFromState`。

- [ ] **Step 3: slice 的 `Pick` 类型加 `'removeDevice'`** — 在 `type DeviceProjectSlice = Pick<ControlCenterState, ...>` 里,把 `'removeDevice'` 加到 `'renameDevice'` 旁:

```ts
type DeviceProjectSlice = Pick<
  ControlCenterState,
  | 'devices' | 'projects' | 'projectFiles' | 'scanResults'
  | 'renameDevice' | 'removeDevice' | 'scanDeviceProjects'   // ← 加 removeDevice
  | 'createProject' | 'updateProject' | 'deleteProject'
  | 'loadProjectFiles' | 'loadProjectFileContent' | 'dropFile'
>;
```

- [ ] **Step 4: 实现 action** — 在 `renameDevice` action 之后(其 `},` 之后)插入 `removeDevice`,紧邻 `scanDeviceProjects`:

```ts
  removeDevice: async (deviceId) => {
    if (!get().serverMode) {
      return {
        ok: false,
        error: 'Platform connection is required before removing a device.',
      };
    }
    const device = get().devices.find(d => d.id === deviceId);
    try {
      await platformTransport.unbindDevice(deviceId);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to remove device.',
      };
    }
    set(state =>
      removeDeviceFromState(
        state.devices,
        state.projects,
        state.vibeRuns,
        state.events,
        deviceId,
        device?.name ?? 'Device',
      ),
    );
    return { ok: true, deviceId };
  },
```

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`
Expected: EXIT 0。

- [ ] **Step 6: Commit**

```bash
git add src/store/types.ts src/store/slices/deviceProjectSlice.ts
git commit -m "feat(store): add removeDevice action (unbind + local cleanup)"
```

---

## Task 4: `DeviceControlCard` 长按菜单 + 信息卡

**Files:**
- Modify(整体替换组件实现): `src/components/vibecoding/DeviceControlCard.tsx`

镜像 `VibeSessionCard` 的长按菜单 Modal 模式(`onLongPress` → `<Modal>` + `renderMenuAction`)。重命名用**普通 `TextInput`**(设备名是短文本,无语音/会话上下文,故不用 `VoiceTextInput`)。删除用菜单内两步确认(镜像重命名的 `renaming` 状态切换,本仓无 `Alert` 先例)。

- [ ] **Step 1: 整体替换 `DeviceControlCard.tsx`** 为下方完整内容(保留原有卡片视觉,新增菜单/信息卡/handlers):

```tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
} from 'react-native';
import { Device } from '../../data/platformModels';
import { useTheme } from '../../theme/useTheme';
import { GlassPanel } from '../shared/GlassPanel';
import { StatusChip } from '../shared/StatusChip';
import { IconBadge } from '../visual/IconBadge';
import { RingMeter } from '../visual/RingMeter';
import { useControlCenterStore } from '../../store/controlCenterStore';

interface DeviceControlCardProps {
  device: Device;
  onPress?: () => void;
}

const statusType = {
  online: 'success',
  warning: 'warning',
  offline: 'neutral',
} as const;

type ActionTone = 'default' | 'primary' | 'danger';

export const DeviceControlCard = React.memo<DeviceControlCardProps>(
  ({ device, onPress }) => {
    const { theme, isDark } = useTheme();
    const renameDevice = useControlCenterStore(s => s.renameDevice);
    const removeDevice = useControlCenterStore(s => s.removeDevice);

    const [menuVisible, setMenuVisible] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [infoVisible, setInfoVisible] = useState(false);

    const openMenu = () => {
      setRenaming(false);
      setConfirmingDelete(false);
      setMenuVisible(true);
    };

    const handleRenameStart = () => {
      setRenameValue(device.name);
      setRenaming(true);
    };
    const handleRenameCancel = () => setRenaming(false);
    const handleRenameSave = async () => {
      const trimmed = renameValue.trim();
      if (!trimmed) return;
      const result = await renameDevice(device.id, trimmed);
      if (result.ok) setMenuVisible(false);
    };

    const handleConfirmDelete = async () => {
      const result = await removeDevice(device.id);
      if (result.ok) {
        setMenuVisible(false);
      }
    };

    const renderMenuAction = (
      label: string,
      onPressAction: () => void,
      tone: ActionTone = 'default',
    ) => {
      const color =
        tone === 'danger'
          ? theme.colors.tertiary
          : tone === 'primary'
          ? theme.colors.primary
          : theme.colors.onSurface;
      return (
        <TouchableOpacity
          key={label}
          style={styles.menuAction}
          activeOpacity={0.7}
          onPress={onPressAction}>
          <Text style={[theme.typography.titleMd, { color }]}>{label}</Text>
        </TouchableOpacity>
      );
    };

    return (
      <>
        <TouchableOpacity
          onPress={onPress}
          onLongPress={openMenu}
          activeOpacity={0.75}
          delayLongPress={350}>
          <GlassPanel
            glowColor={device.status === 'warning' ? 'secondary' : 'none'}
            style={styles.card}>
            {/* —— 原有卡片内容保持不变 开始 —— */}
            <View style={styles.header}>
              <IconBadge
                name="device"
                tone={
                  device.status === 'offline'
                    ? 'neutral'
                    : device.status === 'warning'
                    ? 'tertiary'
                    : 'primary'
                }
                filled={device.status === 'online'}
              />
              <View style={styles.titleBlock}>
                <Text
                  style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}
                  numberOfLines={1}>
                  {device.name}
                </Text>
                <Text
                  style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}
                  numberOfLines={1}>
                  {device.host}
                </Text>
              </View>
              <StatusChip label={device.status.toUpperCase()} type={statusType[device.status]} />
            </View>
            <View style={styles.metaRow}>
              <View style={[styles.metaPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : theme.colors.surfaceContainer }]}>
                <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  {device.os}
                </Text>
              </View>
              <View style={[styles.metaPill, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : theme.colors.surfaceContainer }]}>
                <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                  {device.location}
                </Text>
              </View>
            </View>
            <View style={styles.metrics}>
              <RingMeter progress={device.cpuLoad} label="CPU" value={`${device.cpuLoad}%`} color={theme.colors.primary} size={74} />
              <RingMeter progress={device.memLoad} label="MEM" value={`${device.memLoad}%`} color={theme.colors.secondary} size={74} />
              <View style={styles.statStack}>
                <MiniStat icon="project" value={`${device.projectIds.length}`} label="Projects" />
                <MiniStat icon="agent" value={`${device.activeSessionIds.length}`} label="Agents" />
              </View>
            </View>
            {/* —— 原有卡片内容保持不变 结束 —— */}
          </GlassPanel>
        </TouchableOpacity>

        {/* 长按菜单 */}
        <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
          <View style={styles.modalRoot}>
            <Pressable
              onPress={() => setMenuVisible(false)}
              style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(2,5,8,0.78)' : 'rgba(12,18,28,0.34)' }]}
            />
            <GlassPanel glowColor="primary" style={styles.menuPanel}>
              <View style={styles.menuHeader}>
                <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                  {device.name}
                </Text>
                <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                  {device.host}
                </Text>
              </View>

              {renaming ? (
                <>
                  <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
                    新名称
                  </Text>
                  <TextInput
                    value={renameValue}
                    onChangeText={setRenameValue}
                    placeholder="输入新的设备名称"
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                    maxLength={64}
                    returnKeyType="done"
                    onSubmitEditing={handleRenameSave}
                    style={[styles.renameInput, { color: theme.colors.onSurface, borderColor: theme.colors.primary }]}
                    autoFocus
                  />
                  <View style={styles.actionGrid}>
                    {renderMenuAction('取消', handleRenameCancel)}
                    {renderMenuAction('保存', handleRenameSave, 'primary')}
                  </View>
                </>
              ) : confirmingDelete ? (
                <>
                  <Text style={[theme.typography.bodySm, { color: theme.colors.onSurface }]}>
                    将永久删除该设备及其全部项目 / 会话 / 审批,不可恢复。
                  </Text>
                  <View style={styles.actionGrid}>
                    {renderMenuAction('取消', () => setConfirmingDelete(false))}
                    {renderMenuAction('确认删除', handleConfirmDelete, 'danger')}
                  </View>
                </>
              ) : (
                <View style={styles.actionGrid}>
                  {renderMenuAction('详细介绍', () => {
                    setMenuVisible(false);
                    setInfoVisible(true);
                  })}
                  {renderMenuAction('重命名', handleRenameStart)}
                  {renderMenuAction('删除', () => setConfirmingDelete(true), 'danger')}
                </View>
              )}
            </GlassPanel>
          </View>
        </Modal>

        {/* 详细介绍信息卡 */}
        <Modal visible={infoVisible} transparent animationType="fade" onRequestClose={() => setInfoVisible(false)}>
          <View style={styles.modalRoot}>
            <Pressable
              onPress={() => setInfoVisible(false)}
              style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(2,5,8,0.78)' : 'rgba(12,18,28,0.34)' }]}
            />
            <GlassPanel glowColor="primary" style={styles.infoPanel}>
              <View style={styles.menuHeader}>
                <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]} numberOfLines={1}>
                  {device.name}
                </Text>
                <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                  详细介绍
                </Text>
              </View>
              <ScrollView>
                <InfoRow label="主机" value={device.host} />
                <InfoRow label="系统" value={device.os} />
                <InfoRow label="位置" value={device.location} />
                <InfoRow label="状态" value={device.status} />
                <InfoRow label="Agent 版本" value={device.agentVersion ?? '—'} />
                <InfoRow label="唯一码" value={device.uniqueCode ?? '—'} />
                <InfoRow label="项目数" value={`${device.projectIds.length}`} />
                <InfoRow label="Agent 数" value={`${device.activeSessionIds.length}`} />
                <InfoRow label="最近活跃" value={device.lastSeen ?? '—'} />
                <InfoRow label="远程终端" value={device.remoteTerminalEnabled ? '开启' : '关闭'} />
                <InfoRow label="AI 控制" value={device.aiControlEnabled ? '开启' : '关闭'} />
                <InfoRow label="能力数" value={`${device.capabilities.length}`} />
                <InfoRow label="工具数" value={`${device.tools.length}`} />
              </ScrollView>
              <View style={styles.actionGrid}>
                {renderMenuAction('关闭', () => setInfoVisible(false), 'primary')}
              </View>
            </GlassPanel>
          </View>
        </Modal>
      </>
    );
  },
  (prev, next) => prev.device === next.device,
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const { theme } = useTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant, flex: 1 }]}>
        {label}
      </Text>
      <Text style={[theme.typography.bodySm, { color: theme.colors.onSurface, flex: 2 }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
};

interface MiniStatProps {
  icon: 'project' | 'agent';
  value: string;
  label: string;
}

const MiniStat: React.FC<MiniStatProps> = ({ icon, value, label }) => {
  const { theme, isDark } = useTheme();
  return (
    <View
      style={[
        styles.miniStat,
        { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : theme.colors.surfaceContainer },
      ]}>
      <IconBadge name={icon} tone={icon === 'agent' ? 'secondary' : 'primary'} size={30} iconSize={15} />
      <View>
        <Text style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>{value}</Text>
        <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>{label}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { padding: 12, marginBottom: 10, gap: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  titleBlock: { flex: 1, gap: 2 },
  metaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  metaPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  metrics: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statStack: { flex: 1, gap: 8 },
  miniStat: { minHeight: 42, borderRadius: 8, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  // —— 菜单 / 信息卡 ——
  modalRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  menuPanel: { width: '100%', maxWidth: 420, padding: 16, gap: 12 },
  infoPanel: { width: '100%', maxWidth: 460, padding: 16, gap: 10, maxHeight: '80%' },
  menuHeader: { gap: 2 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  menuAction: {
    flex: 1,
    minWidth: 120,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(127,127,127,0.08)',
  },
  renameInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  infoRow: { flexDirection: 'row', gap: 12, paddingVertical: 4 },
});
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit`
Expected: EXIT 0。用到的 `theme.typography` 档位(`titleMd`/`codeSm`/`labelSm`/`labelCaps`/`bodySm`)均已核对存在。

- [ ] **Step 3: Commit**

```bash
git add src/components/vibecoding/DeviceControlCard.tsx
git commit -m "feat(ui): DeviceControlCard long-press menu (info/rename/delete)"
```

---

## Task 4b(可选): `DeviceControlCard` 组件测试

> spec §7 显式要求卡片测试覆盖(长按开菜单 / 三项动作 / 两步删除)。本仓 `__tests__/` 有现成基建(`ToolsMenu.test.tsx` 菜单测试 + `TerminalListScreen.test.tsx` 用 `useControlCenterStore.setState` 注入 mock)。**可选**:若下面 Modal-mock 在你的 jest 环境不稳,可跳过本任务,以 Task 5 真机手测兜底,不阻塞。

**Files:**
- Test: `__tests__/DeviceControlCard.test.tsx`

- [ ] **Step 1: 写组件测试** — 镜像 `__tests__/ToolsMenu.test.tsx` + `TerminalListScreen.test.tsx`:

```tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { DeviceControlCard } from '../src/components/vibecoding/DeviceControlCard';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { Device } from '../src/data/platformModels';

// RN Modal 把 children portal 出测试树;此处改为 visible 时内联渲染,以便断言菜单内容。
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
      visible ? (children as React.ReactNode) : null,
  };
});

const wrap = (ui: React.ReactElement) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}
      >
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 0, right: 0, bottom: 0, left: 0 },
          }}
        >
          {ui}
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
  });
  return renderer!;
};

const makeDevice = (id = 'd1'): Device =>
  ({
    id, name: 'MacBook', status: 'online', location: 'home', os: 'darwin', host: 'mac.local',
    cpuLoad: 10, memLoad: 20, authorizedDirectories: [], activePorts: [], projectIds: [],
    activeSessionIds: [], lastSeen: 'now', remoteTerminalEnabled: true, aiControlEnabled: true,
    capabilities: [], tools: [],
  }) as unknown as Device;

const texts = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root.findAllByType(Text).map(t => String(t.props.children));

const tap = (root: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const btn = root.root.findAllByType(TouchableOpacity).find(c =>
    c.findAllByType(Text).some(t => String(t.props.children) === label));
  act(() => { (btn as { props: { onPress?: () => void } })?.props?.onPress?.(); });
};

describe('DeviceControlCard long-press menu', () => {
  let renameDevice: jest.Mock;
  let removeDevice: jest.Mock;
  let root: ReactTestRenderer.ReactTestRenderer;

  beforeEach(() => {
    renameDevice = jest.fn().mockResolvedValue({ ok: true, deviceId: 'd1' });
    removeDevice = jest.fn().mockResolvedValue({ ok: true, deviceId: 'd1' });
    useControlCenterStore.setState({ renameDevice, removeDevice });
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
  });

  it('long-press opens the menu with 详细介绍 / 重命名 / 删除', () => {
    root = wrap(<DeviceControlCard device={makeDevice()} onPress={jest.fn()} />);
    act(() => {
      (root.root.findAllByType(TouchableOpacity)[0].props as { onLongPress?: () => void }).onLongPress?.();
    });
    const t = texts(root);
    expect(t.some(x => x === '详细介绍')).toBe(true);
    expect(t.some(x => x === '重命名')).toBe(true);
    expect(t.some(x => x === '删除')).toBe(true);
  });

  it('delete shows a two-step confirm and calls removeDevice on 确认删除', async () => {
    root = wrap(<DeviceControlCard device={makeDevice()} onPress={jest.fn()} />);
    act(() => {
      (root.root.findAllByType(TouchableOpacity)[0].props as { onLongPress?: () => void }).onLongPress?.();
    });
    tap(root, '删除');
    expect(texts(root).some(x => x === '确认删除')).toBe(true);
    await act(async () => { tap(root, '确认删除'); });
    expect(removeDevice).toHaveBeenCalledWith('d1');
  });

  it('详细介绍 opens the info sheet', () => {
    root = wrap(<DeviceControlCard device={makeDevice()} onPress={jest.fn()} />);
    act(() => {
      (root.root.findAllByType(TouchableOpacity)[0].props as { onLongPress?: () => void }).onLongPress?.();
    });
    tap(root, '详细介绍');
    const t = texts(root);
    expect(t.some(x => x === '详细介绍')).toBe(true); // 信息卡标题
    expect(t.some(x => x === 'Agent 版本')).toBe(true); // 信息卡字段
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `npx jest __tests__/DeviceControlCard.test.tsx`
Expected: PASS(3 tests)。若 Modal-mock 导致渲染异常,见任务开头的可选跳过说明。

- [ ] **Step 3: Commit(若采纳)**

```bash
git add __tests__/DeviceControlCard.test.tsx
git commit -m "test(ui): DeviceControlCard long-press menu"
```

---

## Task 5: 全量验证 + 真机手测清单

- [ ] **Step 1: tsc 全量**

Run: `npx tsc --noEmit`
Expected: EXIT 0。

- [ ] **Step 2: jest 全量(对照基线)**

Run: `npx jest`
Expected: 全绿;新增 2 个 `removeDeviceFromState` 测试通过。若出现既有 flake,与 terminal 基线对比确认非本次引入。

- [ ] **Step 3: 真机手测清单(上设备后逐项确认)**

- 首页设备列表:长按设备卡片 → 弹出菜单(详细介绍/重命名/删除)。
- 详细介绍 → 底部信息卡,字段正确;关闭返回列表。
- 重命名 → 输入新名 → 保存 → 卡片标题更新(走 `PATCH /settings`)。
- 重命名空名 → 保存无反应(前端拦截);重名 → store 返回错误(沿用现有文案)。
- 删除 → 二次确认 → 确认 → 设备从列表消失;后端 `/unbind` 触发(agent 下线、数据清除)。
- 删除失败(断网)→ 设备仍在列表,有事件提示。
- 点按(非长按)仍正常跳 `DeviceDetail`。

- [ ] **Step 4: 若手测发现问题则修复并追加 commit;否则收尾**

---

## 范围边界 / 非目标

- 不动后端、agent、official-website(零改动)。
- 不引入 `revoked_devices` 黑名单(spec §9,未来可选)。
- 不扩展 `TerminalListScreen`(同样列设备,日后可复用本卡)。
- 不新造组件测试基建(遵循本仓「测 internals 纯函数」惯例)。
