# 语音设备固定（Voice Device Pin）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NEW TERM 设备面板里长按设备 = 固定（pin）进会话上下文并立即进语音识别；此后语音→命令强制落在 pinned 设备（忽略 AI `select_device`），面板高亮 + FAB 角标，可解除/换绑。

**Architecture:** 纯 phone 单仓。新增独立 zustand 内存 store（`devicePinStore`，先例 `toastStore.ts`）；`VibeCodingListScreen` 面板行加 onLongPress + pinned 高亮/图钉 + FAB 角标 + 自动清 pin effect；`VoiceToBashModal` 新增 `lockedDevice` prop（打开时快照）——confirm 步锁定芯片替换 DevicePicker、生成结果设备被覆盖。server/agent 零改动。

**Tech Stack:** React Native + zustand + react-test-renderer（jest，i18n 钉中文）。规格：`docs/superpowers/specs/2026-09-22-voice-device-pin-design.md`（已批准）。

**工作区/约定（全程使用）**

```
P=/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone/.worktrees/voice-device-pin   (分支 feat/voice-device-pin，已建，spec 已提交)
```

**关键仓库事实（执行前必读）**

1. **jest 在 worktree 必须 pattern 在前 + override**：`npx jest <pattern> --testPathIgnorePatterns="/node_modules/"`；裸 `npx jest` = 0 tests 假绿。全量回归在**主树**裸跑 `npx jest`。
2. **测试断言中文**（jest.setup 钉 zh）；房屋范式 = react-test-renderer + `ThemeContext.Provider(utilityMinimalist)` + `SafeAreaProvider(390x844)`；Animated 组件测试 `jest.useFakeTimers()` + afterEach unmount。
3. `VibeCodingListScreen` 用 `useTranslation('vibecoding')`（t，line 207）；`VoiceToBashModal` 用 `useTranslation('terminal')`（line 169）——modal 内的 pin 文案必须跨命名空间 `t('vibecoding:devicePin.locked')`。
4. FAB hold = `handleNewTermPressIn`（line 589）内 900ms setTimeout → `openVoiceModal(newTerminalDevice)`（line 618）；短按 = `handleNewTermPress`（line 632）切面板；面板行 tap = `handleCreateTerminal`（line 1019）。
5. `VoiceToBashModal` confirm 步 DevicePicker 条件在 line 630-645（testID `v2b-device-picker`）；生成结果设备写入在 295-307；`handleConfirmPress`→`onConfirm(finalCommand, chosenDeviceId, chosenCwd)` 在 345-354。
6. 已有测试基础：`__tests__/VibeCodingListScreen.longpress.test.tsx`（mock navigation + VoiceToBashModal stub + `device()` 工厂 + `switchToTerminals` 助手）；`__tests__/VoiceToBashModal.test.tsx`（mock useVoiceStt/generateCommand + driveTranscript/driveReviewToConfirm 助手 + dispatchCommandGenEvent）。两者都要扩展而非重写。

---

## Task 1: `devicePinStore`（TDD）

**Files:**
- Create: `src/store/devicePinStore.ts`
- Test: `__tests__/devicePinStore.test.ts`

- [ ] **Step 1.1: 写失败测试**

```ts
// __tests__/devicePinStore.test.ts
import { useDevicePinStore } from '../src/store/devicePinStore';

describe('devicePinStore', () => {
  beforeEach(() => {
    useDevicePinStore.setState({ pinned: null });
  });

  it('starts unpinned', () => {
    expect(useDevicePinStore.getState().pinned).toBeNull();
  });

  it('pin stores id + name snapshot', () => {
    useDevicePinStore.getState().pin({ id: 'device-2', name: 'Studio' });
    expect(useDevicePinStore.getState().pinned).toEqual({
      id: 'device-2',
      name: 'Studio',
    });
  });

  it('re-pin overwrites the previous device', () => {
    useDevicePinStore.getState().pin({ id: 'device-2', name: 'Studio' });
    useDevicePinStore.getState().pin({ id: 'device-1', name: 'MacBook' });
    expect(useDevicePinStore.getState().pinned).toEqual({
      id: 'device-1',
      name: 'MacBook',
    });
  });

  it('unpin clears', () => {
    useDevicePinStore.getState().pin({ id: 'device-2', name: 'Studio' });
    useDevicePinStore.getState().unpin();
    expect(useDevicePinStore.getState().pinned).toBeNull();
  });
});
```

- [ ] **Step 1.2: 跑红** `cd "$P" && npx jest devicePinStore --testPathIgnorePatterns="/node_modules/"` → FAIL（模块不存在）。

- [ ] **Step 1.3: 实现** `src/store/devicePinStore.ts`：

```ts
import { create } from 'zustand';

export interface PinnedDevice {
  id: string;
  name: string;
}

export interface DevicePinState {
  pinned: PinnedDevice | null;
  pin: (device: PinnedDevice) => void;
  unpin: () => void;
}

// Session-scoped (in-memory) voice-device lock: the device long-pressed in the
// NEW TERM picker stays the voice→bash target until unpinned/re-pinned or the
// app dies. Deliberately NOT persisted (spec 2026-09-22 §3.1).
export const useDevicePinStore = create<DevicePinState>(set => ({
  pinned: null,
  pin: device => set({ pinned: { id: device.id, name: device.name } }),
  unpin: () => set({ pinned: null }),
}));
```

- [ ] **Step 1.4: 跑绿 + typecheck + Commit**

```bash
cd "$P" && npx jest devicePinStore --testPathIgnorePatterns="/node_modules/" && npm run typecheck
git add src/store/devicePinStore.ts __tests__/devicePinStore.test.ts
git commit -m "feat(终端): devicePinStore——会话内语音设备固定的独立 zustand store"
```

## Task 2: i18n（`vibecoding` namespace `devicePin` 组）

**Files:** Modify: `src/i18n/locales/vibecoding/en.json`、`src/i18n/locales/vibecoding/zh.json`

- [ ] **Step 2.1: en.json** 顶层（与 `activitySummary` 平级，放首位附近即可，保持 2 空格缩进）加：

```json
"devicePin": {
  "locked": "Locked",
  "panelHint": "Voice locked to {{name}}",
  "pinHint": "Long-press a device to lock voice to it"
}
```

- [ ] **Step 2.2: zh.json** 同位置加：

```json
"devicePin": {
  "locked": "已锁定",
  "panelHint": "语音已锁定到 {{name}}",
  "pinHint": "长按设备可将语音固定到该设备"
}
```

（`panelHint` 同时用作 FAB 角标的 accessibilityLabel；`pinHint` 替换面板 subhead 现有硬编码英文 "Pick a live machine for the new shell"。）

- [ ] **Step 2.3: 验证 + Commit**

```bash
cd "$P" && node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/vibecoding/en.json'));JSON.parse(require('fs').readFileSync('src/i18n/locales/vibecoding/zh.json'));console.log('JSON-OK')"
npx jest VibeCodingListScreen --testPathIgnorePatterns="/node_modules/" 2>&1 | tail -3
git add src/i18n/locales/vibecoding && git commit -m "feat(终端): i18n 新增 vibecoding/devicePin 键组(锁定态/面板提示)"
```
预期：JSON-OK；既有 longpress 测试仍绿（未动行为）。

## Task 3: 设备面板——长按 pin + 高亮 + 图钉解除 + 提示文案

**Files:**
- Modify: `src/screens/vibecoding/VibeCodingListScreen.tsx`
- Test: `__tests__/VibeCodingListScreen.longpress.test.tsx`（扩展）

- [ ] **Step 3.1: 写失败测试**（在 `VibeCodingListScreen.longpress.test.tsx` 追加；文件顶部补 `import { useDevicePinStore } from '../src/store/devicePinStore';`，并在 beforeEach 里 `useDevicePinStore.setState({ pinned: null });`）：

```tsx
  it('long-pressing a device row pins it, closes the panel and opens the voice modal', () => {
    act(() => {
      screen = renderScreen();
    });
    switchToTerminals(screen!.root);

    const fab = findByTestId(screen!.root, 'new-term-fab')[0];
    act(() => {
      fab.props.onPressIn();
      fab.props.onPressOut();
      fab.props.onPress();
    });
    expect(findByTestId(screen!.root, 'new-term-device-picker')).not.toHaveLength(0);

    const row = findByTestId(screen!.root, 'new-term-device-device-2')[0];
    act(() => {
      row.props.onLongPress();
    });

    expect(useDevicePinStore.getState().pinned).toEqual({
      id: 'device-2',
      name: 'Studio',
    });
    // 面板关闭、语音 modal 直接打开
    expect(findByTestId(screen!.root, 'new-term-device-picker')).toHaveLength(0);
    expect(findByTestId(screen!.root, 'v2b-stub-confirm')).not.toHaveLength(0);
  });

  it('pinned row renders highlighted with a pin button that unpins', () => {
    useDevicePinStore
      .getState()
      .pin({ id: 'device-2', name: 'Studio' });
    act(() => {
      screen = renderScreen();
    });
    switchToTerminals(screen!.root);

    const fab = findByTestId(screen!.root, 'new-term-fab')[0];
    act(() => {
      fab.props.onPressIn();
      fab.props.onPressOut();
      fab.props.onPress();
    });

    const pinBtn = findByTestId(
      screen!.root,
      'new-term-device-pin-device-2',
    )[0];
    expect(pinBtn).toBeTruthy();
    act(() => {
      pinBtn.props.onPress();
    });
    expect(useDevicePinStore.getState().pinned).toBeNull();
    // tap 行为不变：仍然建终端
    const row = findByTestId(screen!.root, 'new-term-device-device-2')[0];
    act(() => {
      row.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('DeviceTerminal', {
      deviceId: 'device-2',
      directory: '/repo',
      newSession: true,
    });
  });

  it('panel subhead shows the lock hint when pinned', () => {
    useDevicePinStore.getState().pin({ id: 'device-2', name: 'Studio' });
    act(() => {
      screen = renderScreen();
    });
    switchToTerminals(screen!.root);
    const fab = findByTestId(screen!.root, 'new-term-fab')[0];
    act(() => {
      fab.props.onPressIn();
      fab.props.onPressOut();
      fab.props.onPress();
    });
    expect(
      screen!.root
        .findAllByType(Text)
        .some(n => n.props.children === '语音已锁定到 Studio'),
    ).toBe(true);
  });
```

- [ ] **Step 3.2: 跑红** `cd "$P" && npx jest VibeCodingListScreen --testPathIgnorePatterns="/node_modules/" 2>&1 | tail -4` → 新用例 FAIL。

- [ ] **Step 3.3: 实现**（`VibeCodingListScreen.tsx`）：

① imports：`import { useDevicePinStore } from '../../store/devicePinStore';`；`react-native-svg` 的 import 扩展为本文件所需（若已有则补 `Circle`；无 svg import 则加 `import Svg, { Circle, Path } from 'react-native-svg';`）。

② 组件内（`newTerminalDevice` 定义后，~line 424）：

```tsx
  // 语音设备固定（spec 2026-09-22）：面板长按固定，语音→命令强制落该设备，
  // 直到解除/换绑/App 退出。只存 id+name 快照，实时状态从 choices 派生。
  const pinPinned = useDevicePinStore(s => s.pinned);
  const pinDevice = useDevicePinStore(s => s.pin);
  const unpinDevice = useDevicePinStore(s => s.unpin);
  const pinnedDevice =
    pinPinned && terminalDeviceChoices.some(d => d.id === pinPinned.id)
      ? pinPinned
      : null;
  useEffect(() => {
    // pinned 设备掉出在线列表（离线/解绑）→ 自动清除，语音回退默认目标。
    if (pinPinned && !pinnedDevice) {
      unpinDevice();
    }
  }, [pinPinned, pinnedDevice, unpinDevice]);
```

③ `PinIcon` 内联组件（文件内其他小型内联 SVG/组件附近）：

```tsx
const PinIcon: React.FC<{ color: string; size?: number }> = ({
  color,
  size = 12,
}) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Path
      d="M6 1.2a3.2 3.2 0 0 1 3.2 3.2c0 2.2-3.2 6.1-3.2 6.1s-3.2-3.9-3.2-6.1A3.2 3.2 0 0 1 6 1.2Z"
      fill="none"
      stroke={color}
      strokeWidth={1.3}
    />
    <Circle cx={6} cy={4.4} r={1.1} fill={color} stroke="none" />
  </Svg>
);
```

④ 设备行（`pagedTerminalDeviceChoices.map` 内）：
- 行首计算：`const isPinnedRow = pinnedDevice?.id === device.id;`
- `Pressable` 加 `onLongPress={() => { pinDevice({ id: device.id, name: device.name }); setTerminalDevicePickerOpen(false); setTerminalDevicePage(0); openVoiceModal(device); }}`
- 行 style 数组追加：`isPinnedRow && { borderColor: theme.colors.primary, backgroundColor: getActiveChipBackground(isDark) }`
- 在 `deviceChoiceLaunch` View **之前**插入图钉按钮：

```tsx
                    {isPinnedRow ? (
                      <TouchableOpacity
                        testID={`new-term-device-pin-${device.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={t('devicePin.locked')}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => unpinDevice()}
                        style={[
                          styles.deviceChoicePin,
                          {
                            borderColor: theme.colors.primary,
                            backgroundColor: getActiveChipBackground(isDark),
                          },
                        ]}
                      >
                        <PinIcon color={theme.colors.primary} />
                      </TouchableOpacity>
                    ) : null}
```

⑤ subhead 提示（line ~1002 的 hint Text）：

```tsx
              {pinnedDevice
                ? t('devicePin.panelHint', { name: pinnedDevice.name })
                : t('devicePin.pinHint')}
```
（radar dot 在 pinned 时改 `theme.colors.error` 以示锁定态——可选，保持 primary 亦可；plan 默认保持 primary。）

⑥ styles 追加：

```tsx
  deviceChoicePin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
```

- [ ] **Step 3.4: 跑绿**（4 个新用例 + 既有 5 个用例全绿）+ **Commit**

```bash
cd "$P" && npx jest VibeCodingListScreen --testPathIgnorePatterns="/node_modules/" 2>&1 | tail -3
git add src/screens/vibecoding/VibeCodingListScreen.tsx __tests__/VibeCodingListScreen.longpress.test.tsx
git commit -m "feat(终端): 设备面板长按固定语音设备——pinned 行高亮+图钉解除+锁定提示"
```

## Task 4: FAB——角标 + 长按目标用 pinned + 触达检查

**Files:**
- Modify: `src/screens/vibecoding/VibeCodingListScreen.tsx`
- Test: `__tests__/VibeCodingListScreen.longpress.test.tsx`（扩展）

- [ ] **Step 4.1: 写失败测试**（追加）：

```tsx
  it('hold uses the pinned device as the voice target', () => {
    useDevicePinStore.getState().pin({ id: 'device-2', name: 'Studio' });
    act(() => {
      screen = renderScreen();
    });
    switchToTerminals(screen!.root);

    const fab = findByTestId(screen!.root, 'new-term-fab')[0];
    act(() => {
      fab.props.onPressIn();
      jest.advanceTimersByTime(900);
    });

    const confirm = findByTestId(screen!.root, 'v2b-stub-confirm')[0];
    act(() => {
      confirm.props.onPress();
    });
    // 锁定到 device-2，而不是默认的 choices[0] = device-1
    expect(mockNavigate).toHaveBeenCalledWith('DeviceTerminal', {
      deviceId: 'device-2',
      directory: '/repo',
      initialCommand: 'git status --short',
      newSession: true,
    });
  });

  it('shows a pin badge on the FAB while pinned, gone after unpin', () => {
    useDevicePinStore.getState().pin({ id: 'device-2', name: 'Studio' });
    act(() => {
      screen = renderScreen();
    });
    switchToTerminals(screen!.root);
    expect(
      findByTestId(screen!.root, 'new-term-fab-pin-badge'),
    ).not.toHaveLength(0);

    act(() => {
      useDevicePinStore.getState().unpin();
    });
    expect(findByTestId(screen!.root, 'new-term-fab-pin-badge')).toHaveLength(
      0,
    );
  });

  it('auto-unpins when the pinned device drops out of the online choices', () => {
    useDevicePinStore.getState().pin({ id: 'device-2', name: 'Studio' });
    act(() => {
      screen = renderScreen();
    });
    switchToTerminals(screen!.root);
    expect(useDevicePinStore.getState().pinned).toEqual({
      id: 'device-2',
      name: 'Studio',
    });

    act(() => {
      useControlCenterStore.setState({
        devices: [
          device('device-1', 'MacBook', 'online'),
          device('device-3', 'Offline Box', 'offline'),
        ],
      });
    });
    expect(useDevicePinStore.getState().pinned).toBeNull();
  });
```

- [ ] **Step 4.2: 跑红**（hold-target 与 badge 用例 FAIL；auto-unpin 可能已经过——以实际为准，过则说明 effect 已在 Task 3 覆盖，保留用例作回归钉）。

- [ ] **Step 4.3: 实现**（`VibeCodingListScreen.tsx`）：

① `handleNewTermPressIn` 的 setTimeout 回调（line ~618）改：

```tsx
      openVoiceModal(pinnedDevice ?? newTerminalDevice);
```
依赖数组（line 620-625）加 `pinnedDevice`。

② FAB 角标——在 FAB 外层 `styles.newTermFabShadow` 的 View 内、`Pressable` 之后追加：

```tsx
          {pinnedDevice ? (
            <View
              testID="new-term-fab-pin-badge"
              pointerEvents="none"
              accessibilityLabel={t('devicePin.panelHint', {
                name: pinnedDevice.name,
              })}
              style={[
                styles.newTermFabPinBadge,
                {
                  backgroundColor: theme.colors.primary,
                  borderColor: theme.colors.onPrimary + '55',
                },
              ]}
            >
              <PinIcon color={theme.colors.onPrimary} size={9} />
              <Text
                numberOfLines={1}
                style={[
                  theme.typography.codeSm,
                  styles.newTermFabPinBadgeText,
                  { color: theme.colors.onPrimary },
                ]}
              >
                {pinnedDevice.name}
              </Text>
            </View>
          ) : null}
```

③ styles 追加：

```tsx
  newTermFabPinBadge: {
    position: 'absolute',
    top: -9,
    alignSelf: 'center',
    maxWidth: NEW_TERM_FAB_WIDTH + 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    height: 17,
    borderRadius: 9,
    borderWidth: 1,
    zIndex: 10,
    elevation: 2,
  },
  newTermFabPinBadgeText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '600',
  },
```

- [ ] **Step 4.4: 跑绿 + Commit**

```bash
cd "$P" && npx jest VibeCodingListScreen --testPathIgnorePatterns="/node_modules/" 2>&1 | tail -3
git add src/screens/vibecoding/VibeCodingListScreen.tsx __tests__/VibeCodingListScreen.longpress.test.tsx
git commit -m "feat(终端): FAB 长按语音目标用 pinned 设备+固定角标,设备掉线自动解固定"
```

## Task 5: `VoiceToBashModal` 的 `lockedDevice` 强制锁定（TDD）

**Files:**
- Modify: `src/components/terminal/VoiceToBashModal.tsx`
- Test: `__tests__/VoiceToBashModal.test.tsx`（扩展既有文件）

- [ ] **Step 5.1: 写失败测试**（在既有 `__tests__/VoiceToBashModal.test.tsx` 追加；复用其 `baseProps/tree/driveTranscript/driveReviewToConfirm/el/setState` 助手与 mock）：

```tsx
  it('lockedDevice: no DevicePicker, locked chip instead', async () => {
    const props = baseProps({
      mode: 'initial',
      selectableDevices: [
        { id: 'device-1', name: 'MacBook', platform: 'darwin', online: true, cwd: '/repo' },
      ],
      lockedDevice: { id: 'device-1', name: 'MacBook', platform: 'darwin', online: true, cwd: '/repo' },
    });
    act(() => { screen = ReactTestRenderer.create(tree(props)); });
    act(() => { setState('recording'); rerender(props); });
    await driveTranscriptToConfirming(screen!, props, 'ls -la');

    expect(findAllById(screen!.root, 'v2b-device-picker')).toHaveLength(0);
    expect(findAllById(screen!.root, 'v2b-locked-device')).not.toHaveLength(0);
  });

  it('lockedDevice: AI-chosen device is discarded, onConfirm gets the locked device', async () => {
    mockGenerateCommand.mockResolvedValueOnce({
      command: 'ls -la',
      dangerous: false,
      deviceId: 'device-9',   // AI select_device 换的设备
      cwd: '/other',
    });
    const props = baseProps({
      mode: 'initial',
      selectableDevices: [
        { id: 'device-1', name: 'MacBook', platform: 'darwin', online: true, cwd: '/repo' },
      ],
      lockedDevice: { id: 'device-1', name: 'MacBook', platform: 'darwin', online: true, cwd: '/repo' },
    });
    act(() => { screen = ReactTestRenderer.create(tree(props)); });
    act(() => { setState('recording'); rerender(props); });
    await driveTranscriptToConfirming(screen!, props, 'ls -la');

    act(() => { (el(screen!.root, 'v2b-confirm').props as { onPress: () => void }).onPress(); });
    expect((props as { onConfirm: jest.Mock }).onConfirm).toHaveBeenCalledWith(
      'ls -la',
      'device-1',
      '/repo',
    );
  });

  it('without lockedDevice the confirm picker still renders (regression)', async () => {
    const props = baseProps({
      mode: 'initial',
      selectableDevices: [
        { id: 'device-1', name: 'MacBook', platform: 'darwin', online: true, cwd: '/repo' },
      ],
    });
    act(() => { screen = ReactTestRenderer.create(tree(props)); });
    act(() => { setState('recording'); rerender(props); });
    await driveTranscriptToConfirming(screen!, props, 'pwd');
    expect(findAllById(screen!.root, 'v2b-device-picker')).not.toHaveLength(0);
    expect(findAllById(screen!.root, 'v2b-locked-device')).toHaveLength(0);
  });
```

（⚠ 助手名以**既有文件实际导出/定义**为准：该文件已有 `driveTranscript`/`driveReviewToConfirm`/`el`/`setState`/`rerender` 等助手——「drive 到 confirming 相」的等价调用可能是 `driveTranscript(...)` + `driveReviewToConfirm(...)` 两步。实现者先读既有测试文件头部与用例，按既有习惯拼装，不新造重复助手。`findAllById` 若无定义用 `root.findAllByProps({testID:id})`。）

- [ ] **Step 5.2: 跑红** `cd "$P" && npx jest VoiceToBashModal --testPathIgnorePatterns="/node_modules/" 2>&1 | tail -4` → 新用例 FAIL（无 lockedDevice prop / picker 仍在）。

- [ ] **Step 5.3: 实现**（`VoiceToBashModal.tsx`）：

① props 接口（line 46-58）加：

```ts
  /** Initial 模式：语音设备已固定——confirm 步设备锁死为此设备，忽略 AI select_device。 */
  lockedDevice?: DevicePickerEntry;
```
组件签名解构加 `lockedDevice`。

② **打开时快照**（组件内，refs 区）：

```tsx
  // lockedDevice 在每次 modal 打开时快照一次——打开期间 screen 侧的 pin 变化
  // （如设备掉线自动解固定）不得把锁定翻转为解锁；中途掉线由生成错误态兜底。
  const lockedDeviceRef = useRef<DevicePickerEntry | undefined>(undefined);
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      lockedDeviceRef.current = lockedDevice;
    }
    wasVisibleRef.current = visible;
  }, [visible, lockedDevice]);
  const locked = lockedDeviceRef.current;
```

③ confirm 步 picker 条件（line 630）改为：

```tsx
              {mode === 'initial' &&
              selectableDevices &&
              selectableDevices.length >= 1 &&
              !locked ? ( ...原 DevicePicker 块... ) : null}
              {mode === 'initial' && locked ? (
                <View testID="v2b-locked-device" style={styles.pickerWrap}>
                  <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
                    {t('voiceBash.confirm.runOnLabel')}
                  </Text>
                  <View
                    style={[
                      styles.lockedDeviceChip,
                      {
                        borderColor: theme.colors.primary,
                        backgroundColor: isDark
                          ? 'rgba(255,255,255,0.045)'
                          : theme.colors.surfaceContainerLow,
                      },
                    ]}
                  >
                    <PinInline color={theme.colors.primary} />
                    <Text
                      numberOfLines={1}
                      style={[theme.typography.labelMd, { color: theme.colors.onSurface }]}
                    >
                      {locked.name}
                    </Text>
                    <Text style={[theme.typography.codeSm, { color: theme.colors.primary }]}>
                      {tVibe('devicePin.locked')}
                    </Text>
                  </View>
                </View>
              ) : null}
```
（`tVibe` = 该文件新增 `const { t: tVibe } = useTranslation('vibecoding');`——⚠ modal 的 t 是 `terminal` ns，pin 文案在 `vibecoding` ns，必须跨 ns。`PinInline` = 文件内新增 12x12 图钉内联 SVG（同 Task 3 造型）。）

④ 生成结果覆盖（line 295-307 的 `.then((result) => {`）改为：

```tsx
        .then((result) => {
          setCommand(result.command);
          setDangerous(Boolean(result.dangerous));
          if (lockedDeviceRef.current) {
            // 设备已固定：丢弃 AI select_device 的换设备结果，强制锁定设备。
            setChosenDeviceId(lockedDeviceRef.current.id);
            setChosenCwd(lockedDeviceRef.current.cwd);
            setChosenDeviceName(lockedDeviceRef.current.name);
          } else {
            setChosenDeviceId(result.deviceId);
            setChosenCwd(result.cwd);
            setChosenDeviceName(result.deviceName);
          }
          armConfirmDanger(false);
          setPhase('confirming');
        })
```
（该 effect 的依赖数组需补 `lockedDevice`——但快照语义下用 ref 读取，依赖数组**保持不变**即可，ref 取值不受闭包陈旧影响。）

⑤ styles 追加：

```tsx
  lockedDeviceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
```

- [ ] **Step 5.4: 跑绿 + 回归 + Commit**

```bash
cd "$P" && npx jest VoiceToBashModal --testPathIgnorePatterns="/node_modules/" 2>&1 | tail -4
npm run typecheck
git add src/components/terminal/VoiceToBashModal.tsx __tests__/VoiceToBashModal.test.tsx
git commit -m "feat(终端): VoiceToBashModal 支持 lockedDevice——confirm 设备锁死,丢弃 AI 换设备"
```

## Task 6: 全量回归 + 类型检查

- [ ] **Step 6.1:**

```bash
cd "$P" && npm run typecheck && echo TS-OK
cd /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone && npx jest 2>&1 | tail -5
```
预期：tsc 0；全量绿（当前基线 164 套件/1368+3 测试全绿，新增后应 ~165 套件/1371+ 全绿，**不得新增失败**）。

- [ ] **Step 6.2:** 零星修正逐条 commit（中文 message）。

## Task 7: 合并主分支 + 重建 APK

- [ ] **Step 7.1: 合并**

```bash
cd /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone
git merge feat/voice-device-pin --no-edit
git push github main 2>&1 | tail -1
git push ssh://git@172.16.1.33:2222/aliang/aliang-vibe-coding-phone.git main 2>&1 | tail -1
```

- [ ] **Step 7.2: 重建 APK**

```bash
npm run android:release 2>&1 | tail -4
```

- [ ] **Step 7.3:** 收尾报告：APK 路径 + 交互说明（面板长按固定、图钉解除、FAB 角标、语音强制锁定）；合并掉的分支/worktree 清理留待用户指令。

---

## 附：已知坑位清单（执行时对照）

1. worktree 里 jest 必须 `--testPathIgnorePatterns="/node_modules/"`，主树裸跑。
2. 组件测试断言中文（jest.setup 钉 zh）。
3. modal 的 t 是 `terminal` ns——pin 文案跨 ns 用 `t('vibecoding:devicePin.locked')`。
4. `lockedDevice` 用「打开时快照」ref 模式（visible 上升沿捕获），不要直接用 prop 渲染锁定态。
5. RN Pressable：`onLongPress` 触发后 `onPress` 不触发——tap 建终端语义天然不受影响，勿加额外守卫。
6. `devicePinStore` 是独立 store——测试里用 `useDevicePinStore.setState({pinned: null})` 复位（beforeEach 必做，防止用例间串染）。
7. 长按行进语音 = `openVoiceModal(device)` 直接调用（同 FAB hold 同一函数），不要绕道模拟 hold 定时器。
