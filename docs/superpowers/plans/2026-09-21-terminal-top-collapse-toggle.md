# SSH 终端顶栏手动折叠开关 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 SSH 终端屏顶部面板加手动折叠/展开按钮,折叠后复用既有键盘折叠摘要布局,扩大终端可用面积。

**Architecture:** 在 `DeviceTerminalScreen` 增加 `userCollapsed` 布尔态,并入现有 `topPanelCollapsed` 合成谓词(单一代码路径,复用全部既有折叠 UI);标题行内加 30×30 圆形 chevron 开关;把折叠态加入终端 fit effect 依赖,保证折叠后 xterm 重排行列。

**Tech Stack:** React Native + react-test-renderer 测试(仓库 jest preset),react-native-svg。

**Spec:** `docs/superpowers/specs/2026-09-21-terminal-top-collapse-toggle-design.md`

**工作目录:** worktree `/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone/.worktrees/terminal-top-collapse`(分支 `feat/terminal-top-collapse-toggle`)。以下所有路径相对该 worktree 根;所有命令在该目录执行。

---

### Task 1: 新增手动折叠测试(先红)

**Files:**
- Modify: `__tests__/DeviceTerminalScreen.test.tsx`(在测试 `collapses the terminal top project controls while the keyboard is open` 之后,约 line 1160 处插入 4 个新测试)

测试文件已有基建(勿改):`renderScreen()` helper、`keyboardListeners` mock(`keyboardWillShow` / `keyboardDidHide`)、`mockTerminalFit`(经 TerminalEmulator mock 的 `terminalRef` 注入)。

- [ ] **Step 1: 写 4 个失败测试**

在 `it('collapses the terminal top project controls while the keyboard is open', ...)` 测试块结束的 `});` 之后插入:

```tsx
  it('manually collapses the terminal top panel from the toggle button', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    expect(
      screen!.root.findByProps({ testID: 'terminal-top-toggle' }).props
        .accessibilityState,
    ).toEqual({ expanded: true, disabled: false });

    act(() => {
      screen!.root.findByProps({ testID: 'terminal-top-toggle' }).props.onPress();
    });

    expect(
      screen!.root.findAllByProps({ testID: 'terminal-top-grid' }).length,
    ).toBe(0);
    expect(
      screen!.root.findByProps({ testID: 'terminal-collapsed-summary' }),
    ).toBeTruthy();
    expect(
      screen!.root.findByProps({ testID: 'terminal-top-toggle' }).props
        .accessibilityState,
    ).toEqual({ expanded: false, disabled: false });
  });

  it('manually expands the terminal top panel again from the toggle button', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    act(() => {
      screen!.root.findByProps({ testID: 'terminal-top-toggle' }).props.onPress();
    });
    act(() => {
      screen!.root.findByProps({ testID: 'terminal-top-toggle' }).props.onPress();
    });

    expect(
      screen!.root.findAllByProps({ testID: 'terminal-top-grid' }).length,
    ).toBeGreaterThan(0);
    expect(
      screen!.root.findAllByProps({ testID: 'terminal-collapsed-summary' })
        .length,
    ).toBe(0);
  });

  it('disables the collapse toggle while the keyboard forces the panel collapsed', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    act(() => {
      keyboardListeners.keyboardWillShow?.forEach(listener =>
        listener({ endCoordinates: { height: 300 } } as KeyboardEvent),
      );
    });

    expect(
      screen!.root.findByProps({ testID: 'terminal-top-toggle' }).props
        .accessibilityState,
    ).toEqual({ expanded: false, disabled: true });

    act(() => {
      keyboardListeners.keyboardDidHide?.forEach(listener => listener());
    });

    expect(
      screen!.root.findByProps({ testID: 'terminal-top-toggle' }).props
        .accessibilityState,
    ).toEqual({ expanded: true, disabled: false });
  });

  it('refits the terminal after a manual collapse toggle', async () => {
    await act(async () => {
      screen = renderScreen();
    });

    // 先等挂载期 fit effect 的 40ms 真实定时器落地并清空调用记录,否则挂载
    // 定时器会在下方等待窗口内触发,让测试无法区分折叠联动的 fit(本文件
    // 不用 fake timers)。
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 60));
    });
    mockTerminalFit.mockClear();

    act(() => {
      screen!.root.findByProps({ testID: 'terminal-top-toggle' }).props.onPress();
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 60));
    });

    expect(mockTerminalFit).toHaveBeenCalled();
  });
```

- [ ] **Step 2: 运行确认失败**

```bash
npx jest __tests__/DeviceTerminalScreen.test.tsx --silent 2>&1 | tail -20
```

预期:新增 4 个测试 FAIL(`terminal-top-toggle` 不存在导致 findByProps 抛错),既有测试全 PASS。

- [ ] **Step 3: 提交红测试**

```bash
git add __tests__/DeviceTerminalScreen.test.tsx
git commit -m "test(终端): 顶栏手动折叠开关的失败测试(TDD 红)"
```

---

### Task 2: 实现开关(变绿)

**Files:**
- Modify: `src/screens/devices/DeviceTerminalScreen.tsx`(唯一实现文件)

- [ ] **Step 1: 加 userCollapsed 状态**

在 `const [currentQuickDirectory, setCurrentQuickDirectory] = useState(...)`(约 line 239-241)之后加:

```tsx
  // 手动折叠开关:用户主动收起顶栏(不持久化,每次进屏默认展开)。
  const [userCollapsed, setUserCollapsed] = useState(false);
```

- [ ] **Step 2: 改合成谓词**

把(line ~308):

```tsx
  const topPanelCollapsed = keyboardInset > 0 || keyboardProxyFocused;
```

替换为:

```tsx
  const keyboardForcesCollapse = keyboardInset > 0 || keyboardProxyFocused;
  const topPanelCollapsed = userCollapsed || keyboardForcesCollapse;
```

- [ ] **Step 3: 加 ChevronIcon SVG 组件**

导入行(约 line 23)改为:

```tsx
import Svg, { Path, Polyline } from 'react-native-svg';
```

在 `TopStatusShape` 组件定义之后(约 line 155)、`PENDING_KEYBOARD_LIFT_INSET` 常量之前加:

```tsx
const TopPanelToggleIcon: React.FC<{ color: string; up: boolean }> = ({
  color,
  up,
}) => (
  <Svg width={14} height={14} viewBox="0 0 14 14">
    <Polyline
      points={up ? '3,9 7,5 11,9' : '3,5 7,9 11,5'}
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);
```

- [ ] **Step 4: 加切换 handler**

在 `handleBack` 定义之后(约 line 597)加:

```tsx
  const handleToggleTopPanel = () => {
    if (keyboardForcesCollapse) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setUserCollapsed(value => !value);
  };
```

- [ ] **Step 5: 插入开关按钮 JSX**

`headerRow` 中,`headerCopy` 的闭合 `</View>`(约 line 865)之后、`devicePod` 的 `<View`(约 line 866)之前插入。该插入点在展开态与折叠态共用的同一 JSX 分支里,两态都渲染:

```tsx
                <TouchableOpacity
                  testID="terminal-top-toggle"
                  activeOpacity={0.74}
                  accessibilityRole="button"
                  accessibilityLabel={
                    topPanelCollapsed
                      ? 'Expand terminal header'
                      : 'Collapse terminal header'
                  }
                  accessibilityState={{
                    expanded: !topPanelCollapsed,
                    disabled: keyboardForcesCollapse,
                  }}
                  hitSlop={terminalControlHitSlop}
                  disabled={keyboardForcesCollapse}
                  onPress={handleToggleTopPanel}
                  style={[
                    styles.topToggle,
                    {
                      borderColor: strongOutlineColor,
                      backgroundColor: elevatedSurfaceColor,
                    },
                  ]}
                >
                  <TopPanelToggleIcon
                    color={theme.colors.primary}
                    up={!topPanelCollapsed}
                  />
                </TouchableOpacity>
```

(缩进对齐 headerRow 内既有子元素。)

- [ ] **Step 6: 加样式**

`styles` 的 `backButton` 定义之后加:

```tsx
  topToggle: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 15,
  },
```

- [ ] **Step 7: fit effect 依赖加 topPanelCollapsed**

把(约 line 566-572):

```tsx
  }, [keyboardLiftInset, terminalViewportInset]);
```

改为:

```tsx
  }, [keyboardLiftInset, terminalViewportInset, topPanelCollapsed]);
```

- [ ] **Step 8: 跑测试确认全绿**

```bash
npx jest __tests__/DeviceTerminalScreen.test.tsx --silent 2>&1 | tail -5
```

预期:全部 PASS(含既有键盘折叠测试零改动通过)。

- [ ] **Step 9: tsc + 相关测试面**

```bash
npx tsc --noEmit
npx jest __tests__/DeviceTerminal.initialCommand.test.tsx __tests__/DeviceTerminal.voiceFab.test.tsx __tests__/DeviceTerminalScreen.attach.test.tsx --silent 2>&1 | tail -5
```

预期:tsc 零错误;三个关联套件 PASS。

- [ ] **Step 10: 提交**

```bash
git add src/screens/devices/DeviceTerminalScreen.tsx
git commit -m "feat(终端): 顶栏手动折叠/展开开关,折叠复用键盘摘要布局并联动终端 fit"
```

---

### Task 3: 全量回归与收尾

- [ ] **Step 1: 全量测试**

```bash
npm test 2>&1 | tail -8
```

预期:除已知 terminal 基线 flake(历史上恒为 3 个)外零新增失败;退出码若非 0,核对失败集 == 基线集。

- [ ] **Step 2: 汇报并等待合并决策**

向用户汇报结果,由 finishing-a-development-branch 流程决定合并回 main。
