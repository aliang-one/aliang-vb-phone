# 文件夹视图 · AI 改动审核（Codex 式翻页 diff）

- 日期：2026-06-30
- 分支：`feat/folder-view-change-review`（worktree `.worktrees/folder-view-change-review`，基于 `feat/files-cache-and-terminal-recent` @ `df0e23b`）
- 范围：**仅手机端**。零 agent / server 改动，不需重编部署。

## 目标

在文件浏览器（`FileBrowserScreen`）里加一个入口，进入「Codex 式 diff 审核」全屏翻页：逐个查看 AI 在会话里改过的文件，以逐行红绿 diff 呈现，可上一个/下一个翻页。

## 为什么低成本（数据已端到端就绪）

核查坐实，AI 会话改动的 diff 链路早已建好，只是没接进文件夹视图：

- agent 已上报 `ai.file_change` 结构化事件，含 `diff` 文本（≤16KB/文件）。
- server `ai_structured_events` 表已存 `detail={diff, changes}`（`database.ts`）；端点 `GET /api/ai/sessions/:sid/structured-events/:eid` 返回含 diff 的 detail（`server/src/modules/routes/ai.ts:142`）。
- phone 已有 `fetchStructuredEventDetail(sessionId, eventId)`（`src/api/sessions.ts:249`）；会话快照带 `structuredEvents` 信封（`StructuredActivityEvent`，`data/platformModels.ts:286`）。
- `components/code/CodeDiffViewer.tsx`（吃 `DiffLine[]`）现成但闲置——本特性首次接上。

## 数据流

```
FileBrowserScreen (project{deviceId,path} + device 已在手)
  顶部入口「AI 改动 · N」  N = 最新会话 file_change 去重后文件数
   │ navigate('ChangeReview', {projectId, deviceId, projectPath})
   ▼
ChangeReviewScreen
  ① store.vibeRuns 筛 device + projectPath 匹配本项目的会话
  ② 默认最新会话；顶部会话切换器
  ③ 取该会话 structuredEvents.filter(kind==='file_change') → 按 path 去重(留最新 eventId) → 按出现顺序排序
  ④ 翻页当前文件 → fetchStructuredEventDetail(sessionId,eventId) 取 {diff} (走现有 detailCache)
  ⑤ parseUnifiedDiff(diff) → DiffLine[] → <CodeDiffViewer/>
```

## 组件

| 文件 | 动作 |
|---|---|
| `utils/diff/parseUnifiedDiff.ts` (+test) | 新建。纯函数：unified diff 文本 → `DiffLine[]` |
| `utils/diff/selectSessionChanges.ts` (+test) | 新建。纯函数：会话筛选 + file_change 收集/去重/排序 |
| `screens/projects/ChangeReviewScreen.tsx` (+test) | 新建。翻页审核主体 |
| `components/code/CodeDiffViewer.tsx` | 复用（不改进，沿用新文件行号：删除行留空） |
| `screens/projects/FileBrowserScreen.tsx` | 改：顶部加入口 chip（不动树渲染） |
| `app/navigation/types.ts` | 改：加 `'ChangeReview'` 路由 |

## parseUnifiedDiff 规则

- `+`（非 `+++`）→ `add`；`-`（非 `---`）→ `remove`；空格前缀 → `context`
- `+++`/`---` 文件头、`@@ -a,b +c,d @@` hunk 头 → 跳过
- `\ No newline at end of file` → 跳过
- 空串 → `[]`
- 截断（`truncated` 标志，由调用方判断）→ 渲染层显示「diff 已截断」提示

## 默认决策（已与用户确认）

1. 会话作用域：默认最新会话 + 顶部切换器（不聚合全部会话）。
2. 行号：直接复用 `CodeDiffViewer`（新文件行号，删除行留空）。不扩展 `DiffLine`。

## 边界

- 无会话 / 无 file_change → 入口隐藏；屏内空状态。
- diff 缺失（binary 等）→ 「无 diff」。
- 截断 → 「diff 已截断，仅显示前 16KB」。
- 设备离线 / 取 detail 失败 → 复用 `describeDeviceError` 报错 + 重试。
- 重命名 → 显示 `renamedFrom → path`，徽章 R。

## 测试

- `parseUnifiedDiff.test.ts`：加/删/上下文/hunk 头/文件头/无换行/空/多 hunk。
- `selectSessionChanges.test.ts`：会话筛选、去重留最新、排序、空。
- `ChangeReviewScreen.test.tsx`：翻页上/下、空态、截断态、无 diff、入口 N=0 隐藏。

## 基线

- worktree `feat/folder-view-change-review` @ `df0e23b`：jest **577 测试，573 通过 / 4 失败**（4 个均为 terminal 相关已知 flake，非本特性）。
- 验收门槛：tsc 0 错；新测全绿；全量仍只余这 4 个已知 flake。
