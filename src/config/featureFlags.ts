/**
 * 手机端 UI 开关(编译期常量,不做远程下发)。
 *
 * 存在的理由:某些功能在服务端/数据层是好的,但手机端暂时不该露出「入口」。
 * 这类需求反复出现(今天藏、以后可能恢复),所以集中在一处而不是把渲染代码
 * 删掉——恢复时改一个布尔值即可,不必翻 git 历史重建 UI。
 *
 * 约定:开关只影响「怎么展示」,不动 API、store、路由和数据结构。关掉之后
 * 后端行为、已有数据、深链路由都必须仍然可用。
 */

/**
 * Goal 在手机上的新建入口。
 *
 * 2026-10-21 用户决定:手机上不再展示 goal 的「新建/进入」触发点——
 *   - Vibecoding 列表页的 Tasks 标签(GoalInboxPanel)
 *   - 会话页 ToolsMenu 里的 Goal 开关
 *   - Composer 命令面板里的 `/goal` 条目(agent 上报的同名命令也一并滤掉)
 *   - Composer 输入 `/goal` 自动进入 goal draft(手打发送也只当普通文本)
 * 但**保留**已有 goal 会话的状态展示(GoalStatusBar / GoalDraftBar)与
 * SessionSettings 里「模型在 Goal 创建时固定」的只读提示——那些是状态,
 * 不是入口。
 *
 * 注意:关掉后 parseGoalCommand 仍然解析 `/goal`,只是不再触发 draft 切换,
 * 消息会作为普通文本发出去(见 VibeCodingSessionScreen.handleComposerInputChange
 * 与 handleInsertCommand 的门控)。
 */
export const GOAL_UI_ENABLED = false;
