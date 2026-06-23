# Vibecoding 会话屏 · 状态层级方案

- 日期:2026-06-22
- 范围:`AliangVibeCodingPhone` 仅手机端(数据契约零改动)
- 状态:DRAFT(已与用户对齐 3 个关键决策,待实现)

## 背景

VibeCodingSessionScreen 当前有三处状态展示,但**层级混乱、语义打架**,导致一次 vibecoding 还没结束,状态就频繁显示成「DONE / 已完成」:

1. **顶部 `StatusChip`**(`VibeCodingSessionScreen.tsx:1338-1343`)读 `session.status`,经 `vibeStatusLabel` 映射。`session.status` 来自服务端快照(`mapSessionStatus`),会把 `idle` 映射成 `IDLE`、`closed` 映射成 `DONE`,在会话存活期间就抖到 done/idle。
2. **每条助手消息下的「工具活动」块**(`ActivityBlock.tsx` + `activitySummary.ts:63`)标题是「思考中 / 运行命令 / 编辑文件 / **已完成**」。其中「已完成」是**absence-of-pulse 的兜底**:没有 active thinking、没有 started command、没有 file 时就显示。而一次 vibecoding 回合内有**很多次 LLM API 请求**,两次请求之间的空档恰好满足兜底条件 → 频繁闪「已完成」。
3. **底部 `timelineBadge` 气泡**(`VibeCodingSessionScreen.tsx:2090-2101`)的 `StatusChip` 读 `latestAgentEvent.status.toUpperCase()`,最近一条事件 done 了就显示 `DONE`。

根因:**UI 用「有没有子事件正在流式」推断「是否完成」**,但 vibecoding 里两次 API 调用之间的正常空档正好是「没有子事件在流式」,空档被误判成「已完成」。真正能区分「真完成」与「在等下一次请求」的信号(回合 / 会话级生命周期)没有被任何一层消费。

此外:**已 resolved 的 approval** 当前由 `conversationTimeline.ts` 全量穿插进对话流,每张都是完整 `GlassPanel` 卡片,占大量屏幕空间。

## 目标

给三处状态一个**有层级、有次序、互不重叠**的定位;让「已完成」只出现在它该出现的地方(历史回合);把已处理审批折叠收口。

## 设计:三层状态模型

原则:**越往上越稳**。L1 不感知单次请求,L2 不感知单次 API 调用空档,L3 才是实时脉冲。

| 层 | 位置 | 代表 | 抖动粒度 | 数据来源 |
|---|---|---|---|---|
| **L1 会话** | 顶部 `StatusChip` | 这次 vibecoding 的整体阶段 | 只随终态/阻塞变 | 新派生 `sessionPhase` |
| **L2 回合** | 每条助手消息下「工具活动」块 | 这一轮对话的状态 | 随回合 settle 变 | `summarizeActivity` + 新 `turnSettled` |
| **L3 步骤** | 底部常驻气泡 | 此刻在做什么 | 随单次请求/命令脉冲 | 最新回合的结构化事件脉冲 |

「已完成 / DONE」语义**只属于 L2 的历史回合**;L1 与 L3 都不再显示它。

### L1 — 顶部(会话整体)

状态集收敛为 4 个:

- `进行中` — 会话存活期间的**默认值**(agent 在打字、agent 答完等用户、空闲去抖窗口内,统统算进行中)
- `待审批` — 存在 pending approval(需用户动作,最该顶到顶部)
- `已结束` — 会话显式 closed
- `失败` — error

派生(新 helper `deriveSessionPhase(session, hasPendingApproval)`):

```
session.status === 'failed'        → 失败
session.status ∈ {completed,closed}→ 已结束
hasPendingApproval                 → 待审批
否则                                → 进行中   ← idle 不再上顶部
```

- `idle` 在顶部展示时映射为 `进行中`(idle/running 的细分下沉到 L3)。
- 现有 `vibeStatusLabel` 保留给列表页等别处;顶部用新的 `sessionPhaseLabel` 映射。
- 设备离线只读横幅(`VibeCodingSessionScreen.tsx:1373`)保留,叠加显示,不改变顶部相位。

### L2 — 回合级(「工具活动」块)

结构不动,只修 `summarizeActivity` 的兜底语义。新增 `turnSettled: boolean` 入参:

- 非最新回合:`turnSettled = true`(历史回合确实做完了)。
- 最新回合:`turnSettled` = 该回合是否真的结束(收到该回合 `ai.done` / 不再流式 / 球回到用户)。判定复用现有「该回合是否仍在 streaming」的信号。

标题分支改为:

```
activeThink   ? '🧠 思考中…'
: openCmd     ? '⚙ 运行命令'
: files>0     ? '📝 编辑 N 个文件'
: turnSettled ? '已完成'
: '处理中…'                  ← 活着但处于请求空档,带 spinner
```

历史回合仍显示「已完成」;进行中的最新回合在请求空档显示「处理中…」而非「已完成」——即原始 bug 的修复点。

### L3 — 底部气泡(实时步骤脉冲)

复用现有 `timelineBadge` 容器(保留:事件数、点击展开时间线、刷新最新按钮),**只替换中间那颗 `StatusChip` 的语义**:

- 移除读 `latestAgentEvent.status.toUpperCase()` 的 chip(它会显示 `DONE`)。
- 换成实时脉冲标题(与 L2 同源,只取最新回合、常驻):
  - active thinking → `🧠 思考中…`
  - 有 started 命令 → `⚙ 运行 X`
  - 回合仍活、处于请求空档 → `处理中…`(带 spinner)
  - 回合 settle(球回到用户)→ `等待你的输入`(置灰、无 spinner)
- **永不显示「已完成 / DONE」**。

### 数据来源(三层均手机端派生,零契约改动)

- L1:`session`(`useVibeRun`) + `approvals`(`useSessionApprovals`,判 `hasPendingApproval`)。
- L2:`session.structuredEvents`(按 `messageId` 归到各回合)+ 新 `turnSettled`。
- L3:最新回合的 `structuredEvents` 脉冲。
- `thinking.active` / `command.status` 仍由 agent 经 WS 推送(`structuredSlice.ts` 透传),不改。

## 设计:已处理审批折叠

现状:`conversationTimeline.ts:44` 把所有 approval(含 resolved)按 `createdAt` 穿插进对话流,每张完整卡片。

新方案:

- **pending approval**:照旧——完整卡片、glow 高亮、置顶跳转横幅(`:2206`)全保留。
- **resolved(approved/denied)approval**:从 inline 流**抽出**,聚合成**一个**可折叠组:
  - 默认折叠,一行:`✓ 已处理审批 · N`(带 chevron)。
  - 点击展开,内部按时间顺序列出各张已处理审批卡,**整体置灰**(降 `opacity` + 去 glow + 中性色 chip)。
  - **位置**:对话流末尾(最新消息下方)。已处理的是历史,不打断进行中的对话时序;一个收口点最干净。
  - 由新组件 `components/vibecoding/ResolvedApprovalsGroup.tsx` 承载。

`conversationTimeline.ts` 调整:resolved 审批不再作为 inline item 返回(或返回但 render 时统一折叠——实现时择一,倾向从 items 剔除、由末尾聚合块单独渲染,保持时间线纯净)。

## 落地范围

新增 / 修改文件:

- 新 `src/utils/sessionPhase.ts`:`deriveSessionPhase` + `sessionPhaseLabel` / `sessionPhaseType`。
- 改 `src/utils/activitySummary.ts`:`summarizeActivity(events, turnSettled)`。
- 新 `src/components/vibecoding/ResolvedApprovalsGroup.tsx`:折叠 + 置灰列表。
- 改 `src/screens/vibecoding/VibeCodingSessionScreen.tsx`:顶部用 `sessionPhase`;底部气泡 chip 换脉冲标题;L2 传 `turnSettled`;接入 `ResolvedApprovalsGroup`。
- 改 `src/utils/conversationTimeline.ts`:resolved 审批从 inline 剔除(交给聚合块)。
- 测试:`activitySummary` 加 `turnSettled` 用例;新 `sessionPhase` 用例;`conversationTimeline` resolved 剔除用例。

## 不在范围(YAGNI)

- 不改 server / Go agent / WS 契约。
- 不改列表页(`VibeCodingListScreen`)的状态展示(沿用 `vibeStatusLabel`)。
- 不改审批的交付链路 / 解决逻辑,仅改 resolved 的展示形态。
- 不引入「会话级真正结束」的新判定(沿用现有 `closed` 信号)。

## 测试计划

- 单元:`summarizeActivity` 在 `turnSettled=true/false` × (thinking/command/files/空) 各分支;`deriveSessionPhase` 4 态 + pending 优先级;`conversationTimeline` 不再返回 resolved、仍返回 pending。
- 组件:`ResolvedApprovalsGroup` 默认折叠 / 展开置灰。
- 手测(真机):一次多请求的 vibecoding 回合中,顶部保持「进行中」、底部脉冲在「思考中/运行/处理中」间切换且不出现 DONE、最新回合块在空档显示「处理中…」;resolved 审批折叠成一行、展开置灰。
