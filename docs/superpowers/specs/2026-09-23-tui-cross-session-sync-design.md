# TUI 跨会话同步(通知式)设计

日期:2026-09-23
状态:待评审
涉及仓:server(AliangPhoneServer)+ agent(GoProgram/nursor/alianggate)+ phone(AliangVibeCodingPhone)

## 1. 背景与问题

用户在终端手开的 Claude Code TUI 会话被 agent 扫描导入为共享会话(`ai_import_*` + `sourceSessionId`);手机端可对同一会话续聊(agent 派发 headless `claude --print --resume <id>` 追加写同一 jsonl)。但 TUI 侧存在三重结构性盲区(2026-09-23 五路调查 verified):

1. TUI 进程不连 server(server WS client 仅 mobile/admin/agent,`server/src/index.ts:233-250`);
2. TUI 运行中不重读 jsonl(上下文全在内存;官方文档 + anthropics/claude-code issue #60943 确认);
3. 手机回合是独立 headless 进程写的,TUI 既看不到也感知不到,模型上下文就此分叉。

历史结论"等 CC 官方外部控制通道"已到位:**CC v2.1.224+ cross-session messaging**(本机 2.1.280 实测坐实)。每个运行中 TUI 在 `/tmp/cc-socks/<pid>.sock` 监听 Unix socket,官方文档明示供"脚本/外部程序向会话投递消息";发现信息在 agent 已扫描的 `~/.claude/sessions/<pid>.json`(`messagingSocketPath`、`peerProtocol:1`、`status`),认证 token 在同目录 `<pid>.<sha>.key` 的 `peerToken` 字段。

**字面意义的"resume 刷新"不存在**(协议无热重载/切换会话 RPC;`claude --resume` 只能起新进程),本设计以官方注入通道实现等效的"刷新":显示 + 模型上下文双同步。

## 2. 目标 / 非目标

**目标**:手机端对共享会话的回合落地后,自动向"正开着该会话且空闲"的 TUI 注入一条摘要通知;TUI 显示该消息,且模型上下文纳入手机端发生的事。

**非目标**:
- 不做路由式深整合(手机消息经 TUI 执行)——留二期,本设计的管道是其子集;
- 不做 Windows(named pipe 通道;agent 现有外部中断同样不支持 Windows,支持度对齐,留二期);
- 不做 phone 侧"立即同步"手动按钮(留二期);
- 不改变现有派发/扫描/对账链路(headless --resume 照旧)。

## 3. 已拍板的决策

| 决策点 | 结论 |
|---|---|
| 方向 | A. 通知式同步(server→agent→socket 注入摘要) |
| 触发模式 | 自动注入:每次手机回合 ai.done 后,同会话 60s 窗口内合并为一次注入 |
| 平台 | macOS/Linux 首发 |
| 可靠性级别 | best-effort,不进 outbox(错过不补,同步是增强不是承诺) |
| 注入内容 | 服务端生成的摘要通知,**绝不把手机原用户消息原样重放为独立指令**(否则空闲 TUI 会重跑任务);digest 内引用截断片段除外 |
| busy 处理 | TUI Status==busy 时跳过本轮,绝不打断终端回合 |

## 4. 架构与数据流

```
[phone] 发消息 → [server] dispatch → [agent] headless --resume(现有链路,不动)
                                    ↓ 回合落定
[server] ai.done 处理器(server/src/modules/agent/handlers/aiRun.ts:431-487 一带)
  条件:会话有 sourceSessionId(共享会话)
  → 发新下行命令 ai.tui.sync { session_id, source_session_id, digest }
    经 publishToAgent(publish.ts:59-82),helper 仿 publishAiSessionRenameToAgent
    (modules/ai/agentPublish.ts:234-259);best-effort,不进 outbox
[agent] 收到 ai.tui.sync,门控判定(全部满足才注入):
  ① liveClaudeTUIRecord:source_session_id 匹配的 pid 记录存活 + ps 身份校验
    (复用 agent_external_interrupt.go:94-112 共享门)
  ② record.Status == "idle"
  ③ pid json 含 messagingSocketPath(= CC ≥2.1.224 能力门,天然兼容旧版)
  ④ 会话 jsonl 相对上次同步基线(size/mtime)有增长(防冗余注入)
  → net.Dial("unix", socketPath)
  → 逐行写:auth 行({"type":"auth","token":<peerToken>},macOS/Linux 可省但带上更稳)
           + user 行({"type":"user","message":{"role":"user","content":<digest>}})
  → 连接 30s 内写完(协议规则);读回执 peer_message_status
    (held/denied/expired/delivered/refused/dropped),记日志,不回传错误给手机
[agent] 去抖合并:同会话 60s 窗口内多次 ai.tui.sync 合并,取最新 digest
  (合并后 digest 中的 N 为最新 run 的回合数,窗口内可能少计,可接受的修饰性问题)
[server] digest 生成(零 LLM 调用,按用户语言 zh/en 模板;N = 本 run 回合数):
  「手机端在你离开时续聊了 N 轮,最新一条:『<用户消息截断200字>』,AI 已回复完毕。
    本条为同步通知,请勿重做任何任务,等待用户下一步指示。」
```

## 5. 各仓改动详单

### server(~100 行级)
- `modules/ai/agentPublish.ts`:新增 `publishAiTuiSyncToAgent`(payload 定义 + publish);
- `modules/agent/handlers/aiRun.ts`:ai.done 处理中,对有 sourceSessionId 的会话组装 digest 并触发;
- digest 模板函数(zh/en,用户消息截断 200 字,turn 计数取本 run);
- 单测:触发条件(imported/原生、有无 sourceSessionId)、digest 截断与语言。

### agent(中)
- 新 `app/http/services/cc_peer_messaging.go`(+`_unix`/`_other`):UDS client、帧构造、回执解析;`_other` no-op(与外部中断同哲学);
- `agent_inventory.go` pid 记录加载(:833-868)扩读 `messagingSocketPath` 字段 + glob 同目录 `<pid>.*.key` 读 `peerToken`;
- 门控复用 `liveClaudeTUIRecord`(agent_external_interrupt.go:94-112);
- 新增 per-session 同步基线(内存 map:sessionID → jsonl size+mtime;agent 重启后基线归零,首轮可能补一次注入,无害);
- 新增 ai.tui.sync 消息 handler + 60s 去抖合并 map;
- 单测:帧构造纯函数、门控判定表(无记录/busy/无 socketPath/无增长/全过)、合并去抖;socket 用内存 listener 模拟。

### phone(小)
- 横幅文案改写(`src/i18n/locales/vibecoding/zh.json:466` / `en.json:466`,key `session.tuiSharedNotice`;en 同步改写为等义文案):
  旧:「…手机上发送的内容不会出现在已打开的终端界面;在终端内重启 resume 可同步上下文。」
  新:「该对话与桌面终端(TUI)共用:手机上的对话会自动同步进开着此会话的空闲终端;终端忙时本轮不注入、不补发。」
  (文案必须如实反映 busy=跳过不补发,不得承诺"延迟到空闲")
- 资源测试同步更新;其余共享态 UI(停止置灰、tui_busy 文案)不动。

## 6. 错误处理(全部静默降级)

| 情形 | 行为 |
|---|---|
| socket 不存在/连接失败(TUI 刚退出/旧版 CC) | no-op + agent 日志 |
| pid json 无 messagingSocketPath | 能力门不通过,no-op(旧版 CC 兼容) |
| 回执 held | TUI 弹了 inbound 审批,等用户批;记日志,属预期 |
| 回执 denied/dropped/refused/expired/超时 | no-op + 日志 |
| .key 读取失败 | 退化为无 auth 行重试一次(macOS/Linux 允许),仍失败则 no-op |
| 旧 agent 收到未知命令 ai.tui.sync | 沿用现状(忽略+日志);server 先部署无害 |

## 7. Spike(第 0 步,实现前必做)

tmux 起一个测试 CC TUI(独立目录,避免污染真实会话)→ 手工 socat 注入,实测并记录:
1. macOS 下省略 auth 行是否可注入;
2. 空闲会话收到消息后自动开新 turn 的真实表现(耗时、是否需要确认);
3. inbound gate 默认行为(accept 直达还是 hold 弹审批;不同 permission mode 差异);
4. 回执帧的真实格式与时序;
5. 一次注入产生 turn 的 token 量级(校准"每次注入成本"预期);
6. busy 会话注入的"工具调用间送达"实测(本期不启用,记录备二期)。
spike 结论直接校准 agent 帧构造、auth 策略与去抖参数。

## 8. 部署序

server 先(旧 agent 忽略新命令,无害)→ agent 重编(CGO,liang-dev 换装流程见记忆)→ phone 文案随下次 APK(可与现有未部署批次同车)。

## 9. 风险与开放问题

- **inbound gate 行为未实测**:若默认 hold,首次注入会在 TUI 弹审批——spike 确认;若体验差,文档化 `crossSessionInbound=accept` 建议配置;
- **token 成本**:每次注入一个 turn;60s 合并已缓解,spike 后若成本显著,升级为"仅当 TUI 空闲且距上次同步 >N 分钟"策略;
- **基线与 mtime 语义漂移**:并行工作已把 agent 的 updated_at 改为取最后真实消息(master@12768a1,未部署);门控④的 jsonl 基线独立于 updated_at,但实现时需基于含该修复的 master;
- **跨会话 @-mention / peer_idle_notice** 等协议能力本期不用,记录备查。

## 10. 验收标准

1. spike 报告含上述 6 项实测结论;
2. 真机链路:手机对共享会话发一条消息 → 回合完成 → 终端里开着该会话的 TUI(空闲)出现同步通知且模型知悉(可追问验证);
3. TUI busy 时手机回合正常完成且不注入、不打断;
4. 旧版 CC(无 messagingSocketPath)零行为变化;
5. 三仓测试全绿(agent 单测/server 单测/phone 资源测试),按各仓 worktree 分支流程落地。
