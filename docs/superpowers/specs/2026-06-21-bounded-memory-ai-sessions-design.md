# 手机端 AI 会话数据有界内存设计（bounded memory）

- 日期：2026-06-21
- 范围：仅手机端 `AliangVibeCodingPhone`（store + 一个根 hook + 会话屏接线）
- 状态：方案 A 已确认 —— 硬封顶（写入即裁）+ 生命周期/事件驱动空闲降级，无常驻高频定时器（仅一个 5min 粗粒度兜底）

## 1. 背景与问题

AI 会话在手机端是全局 WS、按 userId 广播消费：用户离开 vibecoding 对话页后，后台仍持续接收该用户所有会话的 `ai.delta` 与结构化事件并写进 zustand store。既有内存封顶覆盖了 transcript（500）、会话总数（50）、详细会话数（8 LRU）、terminal（2000 ring）、事件日志（120）。但**两个维度无上限**：

- `structuredEvents`：`applyStructuredEvent` 只 append 不裁（`structuredSlice.ts`）；活跃会话永不 LRU 淘汰 → 长时间运行的活跃会话在 RAM 里无限累积活动事件。
- `eventDetailCache`：`cacheStructuredDetail` 只 spread 不裁（`aiSessionSlice.ts:546`）→ 用户每点开一个活动条目就加一条，无上限。
- 附带：`evictStaleSessionDetail` 清 `transcript`+`events` 但**不清** structuredEvents/detailCache，LRU 淘汰的会话仍泄漏这两项。

带宽不是问题（结构化事件走 slim envelope，已剥 output/diff/thinking 正文）；**RAM 无界增长**才是真实隐患。

## 2. 目标

每个 AI 会话默认只保留最新部分数据；不被关注（非查看、非活跃）的会话定期降级到"只剩快照"；活跃/正在查看的会话保持完整。绝不爆炸，且不引入高频常驻定时器。

## 3. 设计

### 3.1 两层防护

**层 1：硬封顶（安全网，写入即裁，零新状态依赖）**
- `structuredEvents`：每次 append 后 `tail(N)`（N=`STRUCTURED_EVENTS_CAP=200`，与服务端内存窗口对齐）。
- `eventDetailCache`：FIFO 封顶（`EVENT_DETAIL_CACHE_MAX=30`），每次写入裁最旧键。
- 即便降级器永不触发，这两项也被钉死在上限。

**层 2：空闲降级（Approach A，生命周期/事件驱动 + 5min 兜底）**
- 每个会话新增 `lastViewedAt?: number`（纯内存，不持久化；会话屏 focus 时刷新）。
- 全局新增 `currentlyViewedSessionId?: string`（正在查看的会话 id；focus 设、blur 清）。
- `demoteIdleSessions(runs, now)`：把满足 `id !== currentlyViewedSessionId && 非活跃 && lastViewedAt 已设 && now - lastViewedAt > IDLE_DEMOTE_MS(3min)` 的会话**降级**（清 transcript/events/structuredEvents/eventDetailCache/detailLoadedAt，保留元数据用于列表）。降级后重进会触发既有 `loadAgentSessionDetail` 自动加载恢复。
- 触发点（均接，廉价）：
  1. `AppState`→`inactive`/`background`：跑一次 `demoteIdleSessions`（用户离开 app 的主信号）。
  2. 5min `setInterval` 兜底：覆盖"app 一直前台、用户走开"场景（满足用户"定期清理"字面）。
  - 不在 ai.done settle 时降级（避免用户还在看时误清；currentlyViewedSessionId 豁免已足够）。

### 3.2 关键不变量 / 边界

- **活跃会话永不降级**（`ACTIVE_RUN_STATUS`）：流式/可恢复会话保留完整缓冲，避免丢 streaming reducer 的 append 目标（与既有 `evictOverflowVibeRuns` 语义一致）。
- **正在查看的会话永不降级**（`currentlyViewedSessionId` 豁免）：否则查看中每 3-5min 会被清一次、屏闪"拉取中"。
- **从未查看的会话不主动降级**：它们通常只有快照（`publicAiSession` 不含 structured_events → structuredEvents=[]），无可清；其累积由层 1 硬封顶兜住。
- **`lastViewedAt` 跨快照合并必须保留**：`mergeVibeRunSnapshot` 现状是 `{...existing, ...incoming}` spread，incoming 永不带 lastViewedAt → 会把 existing.lastViewedAt 抹成 undefined（与之前 structuredEvents 同类 bug）。须在显式返回字段里保留 `lastViewedAt: existing.lastViewedAt`。
- 降级 = 清成快照（复用并泛化 `evictStaleSessionDetail` 的语义），**不是**缩到更小上限（已确认：重进短暂"拉取中…"是可接受的既有体验）。

### 3.3 改动落点

| 文件 | 改动 |
|---|---|
| `data/platformModels.ts` | `VibeCodingRun` 增 `lastViewedAt?: number` |
| `store/internals.ts` | 新常量（`STRUCTURED_EVENTS_CAP`/`EVENT_DETAIL_CACHE_MAX`/`IDLE_DEMOTE_MS`/`IDLE_SWEEP_INTERVAL_MS`）；`capEventDetailCache`、`demoteRunDetail`、`demoteIdleSessions`；`evictStaleSessionDetail` 改走 `demoteRunDetail`（顺带清 structuredEvents/detailCache）；`mergeVibeRunSnapshot` 显式保留 `lastViewedAt` |
| `store/slices/structuredSlice.ts` | `applyStructuredEvent` 末尾 `tail`；`reconcileStructured` 末尾 `tail` |
| `store/slices/aiSessionSlice.ts` | `cacheStructuredDetail` 套 `capEventDetailCache`；新增 `markSessionViewed`/`clearCurrentlyViewedSession`/`demoteIdleSessions` 动作；`AiSessionSlice` Pick 增键 |
| `store/types.ts` | `ControlCenterState` 增 `currentlyViewedSessionId` + 三个动作签名 |
| `store/controlCenterStore.ts` | 初始 `currentlyViewedSessionId: undefined` |
| `hooks/useIdleSessionDemoter.ts`（新） | AppState 监听 + 5min interval → `demoteIdleSessions`；serverMode 自守；RootNavigator 挂载 |
| `screens/vibecoding/VibeCodingSessionScreen.tsx` | `useFocusEffect`：focus→`markSessionViewed(id)`，blur→`clearCurrentlyViewedSession()` |

### 3.4 测试

- `internals`：`capEventDetailCache` FIFO；`demoteRunDetail` 清四项留元数据；`demoteIdleSessions` 豁免活跃 + 豁免 currentlyViewed + 尊重阈值 + lastViewedAt 未设不降；`evictStaleSessionDetail` 现在也清 structuredEvents/detailCache；`mergeVibeRunSnapshot` 保留 lastViewedAt。
- `structuredSlice`：`applyStructuredEvent` 超 CAP 截断保新；`reconcileStructured` 并集后截断。
- `aiSessionSlice`：`markSessionViewed` 设时间戳 + currentlyViewedSessionId；`cacheStructuredDetail` 超 MAX 截断保新。

## 4. 不做（YAGNI）

- 不做服务端 per-session 推送过滤（按会话静音）—— 需新协议，本次不涉及。
- 不做 detailCache 真 LRU（按访问序）—— FIFO 已够，留待需要时升级。
- 不动 transcript 上限（维持 500）、不动 terminal ring（2000）。
- admin web 不动。
