# VibeCodingSessionScreen 拆分设计（#5）

> 2026-08-05。代码优化 6 步计划的第 5 步——按职责拆 4125 行 god component。
> 本步**最大工程量、中高风险**（用户原话"不建议先做"），故先落设计，让未来抽取机械且可验证，
> 不在无屏级测试覆盖的长会话里临时硬抽。

## 现状度量（拆分前）

`VibeCodingSessionScreen.tsx` = 4125 行，26 useRef / 15 useEffect / 25 useCallback / 25 useState / 29 useMemo / 16 store 选择器。ref 互锁是"改一处波及他处"的最大放大器。

## 接缝图：三类职责的归属

按"修改原因"聚类（SRP，非 LOC）。每类目标一个 hook/组件，对外窄接口。

### A. `useSessionDetailLoader(targetSessionId, { session, wsConnected, device, focusedSessionId })`
**拥有** detail 加载/刷新/恢复的全部时序状态——这正是 #1-3 在 store 侧收口后，**屏侧剩余的耦合簇**。
迁入的 ref/state/effect：
- state: `loadingDetail`、`detailError`、`refreshingLatest`（+各自 setter）
- ref: `autoFetchRef`、`detailLoadInFlightRef`、`detailLoadRequestRef`、`targetSessionIdRef`、`prevRecoverableRef`、`lastAutoRefreshAtRef`、`mountedRef`（mountedRef 与卸载清理共享，见下）
- effect: mount 自动加载（868-930）、detail 不可用短路（935-942）、focus 静默自愈（480-517，与 `markSessionViewed` 共住 focus 回调）、recoverableConversation 自愈（1083-1102）、session-change 重置（1062-1074）
- callback: `handleRefreshLatest`（952-967）
- **返回**：`{ loadingDetail, detailError, refreshingLatest, hasDetail, detailFetchUnavailable, recoverableConversation, refreshLatest, markViewedOnFocus }`

> 注：`hasDetail`（855，读 `isAuthoritativeDetail(detailState)||transcript.length`）与 `detailFetchUnavailable`（858）是这族的纯投影，随迁。
> 风险点：focus effect 既调 `loadAgentSessionDetail`(silent) 又调 `markSessionViewed`；后者是 store action（lastViewedAt/idle-demoter 依赖）。hook 必须把 markSessionViewed 作为注入，不能吞掉。

### B. `useConversationScrollController()`
**拥有** 视口/滚动/布局定位的 ~11 ref。
迁入：`scrollYRef`、`scrollViewRef`、`scrollYSubscriberRef`、`followTailRef`、`pendingScrollToEndRef`、`pendingScrollAnimatedRef`、`preserveFocusRef`、`lastScrollSetRef`、`lastScrollToEndAtRef`、`layoutFlushTimerRef`、`pendingLayoutsRef`、`messageLayouts`(state)、`trailingScrollTimer`、`scrollToEndTimer`。
- **返回**：`{ onScroll, onContentChange, scrollTo(end|id), capturePreserveFocus, restorePreserveFocus, followTail, scrollY, subscribeScrollY, onItemLayout }`
- 风险点：消费点遍布 scrubber commit、conversation rail、prepend 守位、新消息 scroll-to-end。接口必须覆盖所有这些回调；漏一个就回归（滚动跳变/守位失败）。

### C. 保留在屏内的"组装层"
- 顶部相位/预算头（`sessionPhase` useMemo，1882-）、composer 区、空态/失败态 JSX、goal 控制动作、`handleSendText`/`handleLoadEarlierMessages`。
- 这些是"把 A+B 的输出接到 UI"的胶水，留在屏内合理（屏的本职）。

## 拆分顺序（每步独立可验、可单独 PR）

1. **先补屏级 characterization**（Robotest/integration）：mount 自动加载一次性、focus 30s 冷却静默刷新、recoverable 边沿触发一次、session-change 重置。这是 A 抽取的安全网，**必须先有**（当前屏无覆盖）。
2. 抽 `useSessionDetailLoader`（A）—— 最高价值（延续 #1-3），但有上述 focus/markViewed 交叉。先迁 refs/state + mount/unavailable/recoverable effect；focus effect 第二步（处理 markSessionViewed 交叉）。
3. 抽 `useConversationScrollController`（B）—— 接口最宽，最后做。
4. 余下组装层若仍 >1500 行，再拆 `ConversationTranscript` 子组件（含 TranscriptMessageList + ActivityBlock）。

## 为什么不现在抽

- 屏级零测试覆盖 → 抽取回归无网。
- A 的 focus effect 与 `markSessionViewed`（store action，idle-demoter 依赖）共住，错抽会破 lastViewedAt 语义（引回 idle-demote bug）。
- B 接口宽（~6 回调 + 订阅），消费点遍布，长会话末尾易漏。
- 用户明确"不建议先做"。

## 验收

每步：tsc 0 + 既有 store/utils 测全绿 + 第 1 步的屏级 characterization 测全绿 + 真机 smoke（mount 加载、下拉刷新、scroll-to-end、scrubber 跳转、审批推送到达）。

---

相关：[[session-detail-domain-statemachine]]（#1-3 已落地的 store 侧）；[[vibecoding-stale-snapshot-focus-refresh]]、[[vibecoding-aidone-softsettle-align]]（A 涉及的既有 bug 修复，抽取须保其行为）。
