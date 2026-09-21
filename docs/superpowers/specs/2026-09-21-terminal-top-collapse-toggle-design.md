# SSH 终端顶栏手动折叠开关 设计

日期:2026-09-21
状态:已获用户批准的设计,待实现
仓库:AliangVibeCodingPhone
分支:feat/terminal-top-collapse-toggle

## 问题

进入 SSH 终端屏(DeviceTerminalScreen)后,顶部面板固定占据较高面积:标题行(返回键 / TERMINAL + shell / 设备徽章)+ 状态瓷砖行(MEM / CPU / STATE)+ 文件夹快捷目录面板。用户希望手动收起这部分,把屏幕让给终端本体。

## 现状(可复用的既有机制)

顶部面板已有「键盘驱动」的自动折叠:

- `topPanelCollapsed = keyboardInset > 0 || keyboardProxyFocused`(DeviceTerminalScreen.tsx)
- 折叠时:`terminal-top-grid`(metaRail 瓷砖 + directoryPanel)不渲染,标题行切换为紧凑摘要(`terminal-collapsed-summary` / `terminal-collapsed-directory` / `terminal-collapsed-status`),`consoleTopCollapsed` 样式(minHeight 76)生效
- 键盘收起后自动展开

折叠布局、样式、测试基建均已存在,本设计只加一个手动开关。

## 设计(方案 A:复用键盘折叠布局)

### 状态

```tsx
const [userCollapsed, setUserCollapsed] = useState(false); // 不持久化
const topPanelCollapsed =
  userCollapsed || keyboardInset > 0 || keyboardProxyFocused;
```

- 手动折叠后的视觉 = 键盘弹出时的单行摘要(返回键 + 当前目录 + 设备状态),单一代码路径。
- 不做跨会话持久化(用户已拍板):每次进屏默认展开。

### 折叠开关按钮

- 位置:`headerRow` 内、`devicePod`(设备徽章)左侧,展开态与折叠态(摘要行)都渲染,位置固定。
- 形态:30×30 圆形描边按钮,视觉语言与返回键一致(elevatedSurface 底 + strongOutline 边框);箭头用 react-native-svg polyline(仓库已有 TopStatusShape / FolderGlyph / EnterDirectoryIcon 的 SVG 先例)。
- 图标:展开态 ⌃(点击=收起),折叠态 ⌄(点击=展开)。
- `testID="terminal-top-toggle"`;`accessibilityRole="button"`;`accessibilityLabel="Collapse terminal header" / "Expand terminal header"`;`accessibilityState={{ expanded: !topPanelCollapsed }}`。
- 键盘弹起(`keyboardInset > 0 || keyboardProxyFocused`)时按钮 `disabled`(置灰):此时折叠是强制的,点击无视觉反馈,不提供无效操作。

### 终端自适应(关键联动)

顶部面板与 `outputPane` 是 flex 列兄弟,面板变矮终端区域自动变高。`TerminalEmulator` 自身有容器 onLayout 触发的 fit 兜底,但为与键盘路径保持一致的确定性时序,现有 fit effect(`[keyboardLiftInset, terminalViewportInset]` 依赖)**必须把 `topPanelCollapsed` 加入依赖数组**——键盘路径因 keyboardInset 变化天然触发,手动路径只有加依赖才能同样触发(避免依赖 onLayout 兜底时序)。

### 动画

复用键盘监听中已有的 `LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)`:点击开关时先 configureNext 再 setState。Android 未启用 experimental LayoutAnimation 时 configureNext 为 no-op,不会崩溃。

### 非目标

- 不改键盘自动折叠行为(键盘弹起仍强制折叠,收起后回到 userCollapsed 的值)
- 不做持久化、不做手势(双击/长按)、不做半折叠(只收瓷砖保留文件夹区)
- 不动 voice banner 逻辑(banner 位于 grid 之前,折叠态照常显示,维持现状)

## 测试计划(TDD)

新增(`__tests__/DeviceTerminalScreen.test.tsx`,沿用现有键盘事件的 mock 手法):

1. 点开关 → `terminal-collapsed-summary` 出现、`terminal-top-grid` 消失、toggle 的 accessibilityState.expanded=false
2. 再点开关 → 恢复展开(grid 回来、摘要消失)
3. 键盘弹起时 toggle disabled;键盘收起后恢复可用
4. 手动折叠后 fit 被调用(fit effect 依赖生效;fit 走 40ms 真实 setTimeout,断言需短真实等待;复用测试文件已有的 `mockTerminalFit`)
5. 回归:现有「键盘弹起折叠 / 收起展开」测试必须零改动通过

## 影响面

- 单文件改动:`src/screens/devices/DeviceTerminalScreen.tsx`(状态 + 按钮 + SVG 图标 + fit 依赖 + LayoutAnimation)
- 新增测试在同文件对应的既有测试文件中
- 零协议/零 agent/零 server 改动
