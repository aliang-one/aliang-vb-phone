# 刷新成功/失败反馈提示 — Design

日期: 2026-07-12 ｜ 范围: phone only (无 server/agent 改动)

## 问题

所有下拉刷新都走 `refreshFromServer` → `loadSnapshot` → `/api/mobile/snapshot?event_limit=40`。
两个症状:

1. **没有任何提示**: `refreshFromServer` (`store/slices/realtimeSlice.ts:134-157`) 在 `catch` 里吞掉所有错误、**永远 resolve、从不 reject**。所以每个 handler 的 `try { await refreshFromServer() } finally { setRefreshing(false) }` 无法区分成功/失败——失败也被当成功静默处理,既无成功提示也无失败提示。
2. **转圈感觉不灭**: RefreshControl 的 `refreshing` 经核实**一定会清**(`try/finally` + `refreshFromServer` 必 resolve + `apiFetch` 8s `AbortController` / `withTimeout` 12s 双重兜底)。所以 spinner 最迟 ~8s 停。但**没有任何 toast**,一个慢/超时的快照(转 ~8s 后静默停止)给人的感觉就是"卡住了 + 没提示"。

## 根因

- `refreshFromServer` 吞错,屏幕侧无法感知结果。
- 全仓**无全局 toast 系统**(`react-native-notify-kit` 是系统通知,非应用内 toast;仅 `noMoreEarlierHint` 一处本地 setTimeout 先例)。

## 设计 (方案 A)

### 1. Toast 基建 (新,zustand,无 Provider)

- `toastSlice` (zustand,复用现有架构):
  - state: `{ message: string | null; type: 'success'|'error'|'info'; visible: boolean }`
  - actions: `show(message, type='success')` → 置 visible=true + 启动 1500ms 自动 `hide`(若已有 toast 在显,清旧定时器、替换内容);`hide()`。
- `<ToastViewport/>` 在 `RootNavigator` 挂一次,顶层覆盖。读 toast store,渲染小浮层(顶部居中,跟随 theme,success=主色/error=错误色),1.5s 自隐。
- `useToast()` hook → `{ show }`。

### 2. `refreshFromServer` 返回结果

- 签名: `Promise<void>` → `Promise<{ ok: boolean; error?: string }>`。
  - `refresh` 成功 → `{ ok: true }`;`catch` → `{ ok: false, error }`。
  - `reinitialize` 成功 → `{ ok: true }`;`catch` → `{ ok: false, error }`。
  - `noop`(`!serverMode && !token`)→ `{ ok: false, error: 'No active connection' }`。
- **非破坏性**: 现有 `void refreshFromServer().catch(()=>{})` 调用方(`usePresenceHeartbeat`、`ProjectScanScreen` 轮询)——`.catch` 是死代码(本就不 reject),`void` 丢弃返回值,均不受影响。顺手清掉这些死 `.catch`。
- 同步更新 `store/types.ts` 的 `refreshFromServer` 类型。

### 3. 接入各刷新 handler

- **4 个简单 handler**(`TerminalListScreen`、`ProjectSettingsScreen`、`CommandCenterScreen`、`VibeCodingListScreen`)——现状都是 `setRefreshing(true); try { await refreshFromServer() } finally { setRefreshing(false) }`:
  - 换用 `useRefreshWithFeedback()` hook → `{ refreshing, handleRefresh }`。hook 持有 `refreshing`,await `refreshFromServer`,按 `{ok}` 弹 toast。
- **`ProjectDetailScreen`**——`Promise.all([refreshFromServer(), reload()])`:保留结构,读 `refreshFromServer` 结果弹 toast(`reload` 失败由其自身 error 态处理)。
- **`VibeCodingSessionScreen`**——**核查后排除**:其 `handleRefresh` 走"加载更早历史"或 `handleRefreshLatest`,后者调的是 `loadAgentSessionDetail`(按会话拉详情),**不**走 `refreshFromServer`/快照接口。故不在本次快照反馈范围;其失败已有 `setDetailError` 内联提示、加载更早已有 `noMoreEarlierHint`。

### 成功/失败策略 (用户已确认)

- 成功 → toast「刷新成功」(1.5s 自隐)。
- 失败 → toast「刷新失败: {error}」(1.5s 自隐,内容含原因,如 `timed out after 8000ms`)。

## 不在本次范围

- `FileBrowserScreen` / `DeviceTerminalScreen` 的 `!cancelled` 卡 spinner bug(独立,已另诊断)。
- 文件浏览 reload 按钮(走 `loadProjectFiles`,不同接口;如需后续可加 toast)。
- 快照服务端性能(若 toast 暴露长期 8s 超时,另开服务端排查)。

## 测试 (TDD)

- toastSlice: show/hide/1.5s 自隐/新 toast 替换旧(清旧定时器)。
- `refreshFromServer` 返回: 成功→`{ok:true}`;mock `loadSnapshot` reject→`{ok:false,error}`;`noop`→`{ok:false}`。
- `useRefreshWithFeedback`: 成功→refreshing true→false + 成功 toast;失败→错误 toast。
- 回归: `refreshFromServer` 返回值变更非破坏(调用方忽略返回/`.catch` 死代码)。jest 基线不变(已知的 terminal flake 除外)。

## 验收

- phone tsc0 + jest 绿(terminal 基线 flake 除外)。
- 真机: 下拉刷新成功→「刷新成功」闪现;断网/超时→「刷新失败: …」闪现。
- 顺带验证: toast 弹出时刻 = spinner 停止时刻,可据此判断"转圈不灭"究竟是慢/超时还是真卡死。

## 落地

纯 phone 改动。tsc0 + jest 后 rebuild APK 上设备。
