# 桌宠伙伴（Pet Companion）设计决策记录

- 日期：2026-09-25（需求头脑风暴定稿）
- 分支：`feat/pet-companion`（phone，本仓）；server 仓同名分支承载 B1
- 状态：需求与架构决策已定稿；**实现未开始**。本文档是决策快照 + 已验证的技术落点，供后续会话接续
- 流程备注：正式 spec 审查循环与实现计划（writing-plans）按用户要求暂缓，开发启动时先补

---

## 1. 背景与目标

在 app 的**所有页面**上悬浮一只虚拟宠物（仓鼠），定位为**交互入口**：点开快捷面板提供真功能；远期成为有记忆、会对话、能主动给建议的 AI 伙伴。宠物作为 app 全局状态的可爱化身，绝不主动打扰。

## 2. 范围拆解（三期）

| 子项目 | 内容 | 仓库 |
|---|---|---|
| **A 宠物壳** | 全局悬浮仓鼠（Rive 动画、可拖动、吸边、位置记忆）+ 快捷面板（审批快捷处理/会话设备总览/快捷跳转/建议列表/语音入口） | phone |
| **B 灵魂** | **B1** 下一步建议自动生成（server 管道 + 面板展示 + 一键发入会话）；**B2** 与宠物持续对话 | server + phone |
| **C 长期记忆** | 跨会话积累用户目标理解（宠物聊天 + cc/codex 转录蒸馏），增强 B | server |

**一期 = A + B1**（用户已确认）。B2/C 后置二期/三期，各自单独 spec。

## 3. 已定决策（2026-09-25 逐条确认）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 宠物定位 | 交互入口（点开有真功能），非纯装饰 |
| 2 | 面板内容 | 待审批快捷处理、运行中会话/设备总览、快捷跳转、建议列表（B1）、语音入口（一期简版：语音→命令发到最近活跃会话，复用现有 STT 链路） |
| 3 | 交互方式 | 轻点=开面板；**可拖动 + 吸附左右边缘 + 位置记忆**（AsyncStorage）；拖动手势与点击用手势状态机区分（参照 TerminalVoiceFab 的 pressActive/holdFired 模式） |
| 4 | 形象 | **仓鼠**（金丝熊，腮帮鼓起 = 存建议的天然隐喻） |
| 5 | 动画技术 | **Rive**（rive-react-native，Nitro 运行时，状态机驱动）；状态件（审批角标/zzZ/腮帮）可代码层叠加 |
| 6 | 资产制作分工 | **我方交付**：仓鼠 SVG 静态形象（多姿态）+ 状态机规格书 + Rive 编辑器操作指引；**用户**在 Rive 编辑器完成绑定与动画制作 |
| 7 | B1 触发策略 | **冷却节流**：同一会话冷却期（默认 10 分钟）内只生成一次；失败/报错回合无视冷却必生成排查建议 |
| 8 | 显隐规则 | 登录/相机扫码/调试页隐藏；键盘弹起自动避让；Me 页总开关（默认开）；**绝不主动弹系统通知**，新建议只用腮帮+角标表达 |
| 9 | 渲染降级 | 开启系统「减弱动态效果」时退化为静态形象（复用 useReduceMotion）；Rive 资产未就绪期间以静态 SVG 形象占位运行 |

## 4. 手机端技术落点（已探明，2026-09-24 代码核实）

### 4.1 全局挂载点
- 挂载位置：`App.tsx` 的 `AppContent` fragment 内、`</NavigationContainer>` 之后、`<ToastViewport />`（App.tsx:180）同级 —— 唯一已验证的全局覆盖层先例，天然盖住全部 ~21 屏（4 tab + 19 push + 登录页）
- 该位置在 SafeAreaProvider/ThemeProvider/LocaleProvider 内，可直接 `useTheme()` / `useSafeAreaInsets()`
- ⚠️ 不要挂进 RootNavigator（hydrate 前早退 loading、登录态切换子树会销毁重建）
- ⚠️ 交互需容器 `pointerEvents='box-none'`（先例 DeviceTerminalScreen.tsx:1553），只有宠物本体可点，空白触摸穿透

### 4.2 手势与位置
- 手势状态机参照 `TerminalVoiceFab.tsx:74-92`（pressActiveRef + holdFiredRef + 阈值计时）；拖动用 react-native-gesture-handler Pan（或 reanimated Gesture）
- 吸边 + 位置记忆：拖动结束 animate 到最近左/右边缘，x/y 持久化 AsyncStorage（`@pet_position`）
- 键盘避让：Keyboard 事件上浮（先例 DeviceTerminalScreen.tsx:392-407 的 controlsBottomOffset 模式）
- 底部基线：`BottomNavBar.tsx:46-48` 常量（BULGE_BAND=22/BODY_HEIGHT=54）+ `BottomTabBarHeightContext`；stack push 屏无 tab bar，用 insets.bottom

### 4.3 组件结构（建议）
```
src/components/pet/
  PetOverlay.tsx          # 全局容器：显隐判定 + 定位 + 手势 + 键盘避让
  PetHamster.tsx          # 形象渲染：Rive 就绪→RiveView，未就绪→静态 SVG；reduceMotion 降级
  PetPanel.tsx            # 快捷面板（BottomSheet 模式，复用 src/components/shared/BottomSheet.tsx）
  PetPanelSuggestions.tsx # 建议卡片列表（B1）
  PetPanelSessions.tsx    # 会话/设备总览 + 审批快捷 + 跳转
src/stores/  或 src/store/
  usePetSettings.ts       # zustand：总开关/位置/reduceMotion 状态（AsyncStorage 持久化）
  usePetSuggestions.ts    # zustand：建议列表 + 未读数（WS 事件驱动）
src/rive/ (或直接引库)
  PetRiveView.tsx         # rive-react-native 封装 + 状态机输入接口（输入: state/input 命名见 §6）
```
- 显隐判定需订阅导航状态：`navigationRef`（App.tsx:159 已挂 ref）而非依赖屏内刷新（freezeOnBlur 冻结屏不重渲染）

### 4.4 测试要点（仓库已知坑）
- Pressable 是 memo 包裹，react-test-renderer 定位交互节点必须用恒定 testID
- 含 Animated.loop 的组件测试必须逐个 unmount，否则 jest 挂起
- reanimated mock 在 act() 内同步重渲染会 throw（参照 DeferredMount.tsx 的 IN_TEST gate）
- 测试主目录在**根 `__tests__/`**；i18n 钉 zh，断言中文文案
- RiveView 在 jest 中需 mock（原生模块）

## 5. 服务端 B1 管道（概要，挂点待开发时核实）

```
cc/codex 回合结束（ai.done / soft-settle 路径）
  → 冷却检查（同 session 10min；失败回合绕过）
  → 组装上下文（会话目标 + 最近 transcript 摘要）
  → LLM 生成 1-3 条下一步建议（复用 commandgen / session-title 的网关配置模式：env ALIANG_PET_*，OpenAI 协议）
  → 持久化（per-user，照 database 按域拆分 dao 模式加 pet_suggestions 域）
  → WS 推送 phone（复用现有 realtime publish 链路；新增事件类型如 pet.suggestions.updated）
  → phone usePetSuggestions 收事件 → 腮帮鼓起 + 角标
```
- 待核实（开发时确认）：ai.done 的权威挂点（sessionStatus soft-settle）、LLM 网关配置复用细节、WS 事件注册处、dao 域拆分落点
- 成本护栏：冷却节流 + 每用户建议保留最近 N 条（建议 10）+ LLM 超时/失败静默降级（不阻塞回合结算路径）

## 6. Rive 状态机规格（概要，制作前出完整版）

| 状态 | 触发输入 | 动画描述 | 过渡 |
|---|---|---|---|
| idle | 默认 | 呼吸起伏 + 随机眨眼 + 偶尔理毛 | ↔ sleep（无操作 >2min）、→ busy |
| busy | `isWorking`=1（任一 AI 会话 running） | 跑步轮/嗑瓜子加速版，尾巴快动 | 输入归零回 idle |
| alert | `hasApproval`=1 | 耳朵立起 + 头顶冒气泡（角标由代码层叠加） | 决断后回上个状态 |
| sleep | idle 超时 | 闭眼蜷缩 + zzZ（代码层画） | 触摸唤醒 |
| drag | `isDragging`=1 | 四肢张开挣扎 | 松手 → snap（吸附小弹跳）→ idle |
| cheekFull | `hasUnreadSuggestions`=1 | 腮帮鼓起 + 微晃 | 面板打开读完 → 缩回 |

- 交付物清单（制作前提交）：① 仓鼠 SVG 静态形象（idle/busy/alert/sleep/drag 五姿态，分层可绑定）② 上述状态机的完整规格书（输入命名、混合时长、循环点）③ Rive 编辑器分步操作指引（导入 SVG→骨骼→状态机→导出 .riv）
- 导出：`.riv` 放 `src/assets/pet/`；suggestions 角标/zzZ 等状态件由代码层叠加，不烘进 Rive

## 7. 里程碑

1. **M1 宠物壳上线**：PetOverlay + 静态 SVG 形象 + 手势/吸边/位置记忆 + 显隐规则 + 总开关 + 快捷面板（审批/总览/跳转）——纯 phone，可先发
2. **M2 Rive 形象**：状态机规格交付 → 用户制作 → PetRiveView 接入 + 降级链路
3. **M3 B1 建议管道**：server 管道 + 面板建议卡 + 一键发入会话 + 腮帮/角标联动
4. **二期**：B2 与宠物持续对话；**三期**：C 长期记忆/目标画像

## 8. 风险

- rive-react-native Nitro 运行时较新（2025 margelo 重写），接入时先在 debug 验证 RN 0.85 兼容性；保留降级：静态 SVG → （必要时）lottie-react-native v7
- Rive 编辑器学习曲线在用户侧；规格书质量决定制作效率
- B1 LLM 成本随活跃度增长：冷却节流 + 建议条数上限 + 失败静默
- 悬浮层与既有手势（BottomNavBar、屏内 FAB、下拉刷新）的冲突需在 M1 真机回归

## 9. 本期明确不做

- B2 对话、C 记忆（后置）；照片级真实渲染（帧序列/Lottie 视频）；宠物弹系统通知；Android 系统级桌面宠物（悬浮窗权限路线，从未在需求内）
