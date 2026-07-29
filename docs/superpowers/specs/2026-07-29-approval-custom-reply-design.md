# 审批自定义回复(Approval Custom Reply)— 设计文档

日期:2026-07-29
状态:已与用户对齐,待实施

## 背景与动机

vibecoding 的「方案选择」(server 端 `kind: 'client_response'` 的审批)目前只允许用户从 AI 在 ```aliang-options``` 围栏块里给出的固定 ≤12 个选项中点选。用户无法用自己的话回复、给替代方案或追问。

探查发现:**自由文本回复在整条链路上其实早已支持,唯一缺口在手机端 UI 入口**。

证据链(均为已存在、本次不改的代码):

- 契约:`onResolve(id, decision, { selectedOptionId?, message? })` 已带 `message` 字段
- phone 传输:`respondApproval` 透传 `message`
  (`AliangVibeCodingPhone/src/api/approvals.ts:40`)
- 服务端 resolve 对 `client_response` **优先**用 `input.message` 作为用户消息回传 AI、开新回合:
  ```ts
  // AliangPhoneServer/server/src/modules/approval/resolve.ts:69
  const content =
    optionalString(input.message) ??                 // 1. 用户自由文本(最高优先级)
    optionalString(selectedOption?.response) ??      // 2. 选项预置回复
    ...
  await dispatchUserAiMessage(session, { content, ... });
  ```
- schema:`message: z.string().max(4000).optional()`
  (`AliangPhoneServer/server/src/schemas.ts:333`)
- `aliang-options` 解析出的方案选择审批被标为 `kind: 'client_response'`
  (`AliangPhoneServer/server/src/modules/approval/derived.ts:50`,`:65`)

**缺口**:手机端两处渲染点都只把固定选项做成按钮,点击直接 resolve,`message` 永远只取 `option.response`(预置回复),从无输入入口:
- 会话屏 `AliangVibeCodingPhone/src/screens/vibecoding/VibeCodingSessionScreen.tsx:2179-2224`
- 审批中心 `AliangVibeCodingPhone/src/screens/operations/ApprovalCenterScreen.tsx:463-506`

## 目标 / 非目标

**目标**:给 `client_response`(方案选择)审批加一个「自定义回复」UI 入口,复用现有 `message` 链路把用户输入当作回复发回 AI,**零后端、零契约、零 agent 改动**。

**非目标**:
- 不动 `dangerous_command` / `file_write` / `git_push` / `tool` 等其他 kind —— 这些 kind 的 `message` 在 `resolve.ts` 走 `publishToAgent`(附在审批结果里转发),不会触发新对话回合,语义半残,不在本次范围。
- 不改 server / agent / 契约 / `parsing.ts` / `resolve.ts` / `approvals.ts`。
- 不改选项按钮的现有行为与样式。

## 方案概览(路线 A:共享纯 UI 组件)

新增一个**纯 UI、不绑 i18n namespace** 的组件 `ApprovalCustomReply`,会话屏与审批中心各贴一行条件渲染。**展开式入口**:默认折叠为一个触发器,点开才出现输入框。复用现有 `VoiceTextInput`(自带语音 + 文本)。

选此路线而非「两处内联」:两处都要用,抽出共享组件避免重复、可独立单测、行为天然一致,符合仓库现有把审批 UI 收进 `components/vibecoding/` 的惯例(`ApprovalQuickPolicySheet.tsx`、`ResolvedApprovalsGroup.tsx`)。

## 判据(条件渲染)

`approval.kind === 'client_response'`

与 `resolve.ts:44` 的 `isClientResponseApproval = approval.kind === 'client_response'` 同源;`derived.ts:50/65` 确保方案选择审批一定带此 kind。前后端语义闭环。

## 组件设计 `ApprovalCustomReply.tsx`

位置:`AliangVibeCodingPhone/src/components/vibecoding/ApprovalCustomReply.tsx`

```ts
interface ApprovalCustomReplyProps {
  approvalId: string;
  /** 「✎ 自己回复」触发器文案(宿主 t() 传入) */
  triggerLabel: string;
  /** 输入框占位文案(宿主 t() 传入,避免依赖 VoiceTextInput 内置默认) */
  placeholder: string;
  /** 「发送」按钮文案(宿主 t() 传入) */
  sendLabel: string;
  /** 设备离线 / 他卡 resolving 时禁用触发器与输入 */
  disabled?: boolean;
  /** 透传 VoiceTextInput,归属语音录音(admin 数据浏览) */
  sessionId?: string;
  projectPath?: string;
  /** 发送回调:传入去空白的文本 */
  onSend: (message: string) => void;
}
```

内部状态:
- `expanded: boolean`(默认 `false`)
- `text: string`(默认 `''`)

行为:
- **折叠态**:渲染一个 `TouchableOpacity`「{triggerLabel}」。
- **展开态**:渲染一行 `<VoiceTextInput value=text onChangeText onSubmitEditing=send maxLength=2000 placeholder testIDPrefix>` + `<GlowButton>`「{sendLabel}」+ 一个 **✕ 收起** 按钮。
- `send()`:`onSend(text.trim())`;随后 `text = ''`、`expanded = false`。(发送即 resolve,整张卡会转 resolved 态消失,故清空。)
- **✕ 收起**:`expanded = false`,**保留 `text`**(不调 `onSend`)。下次再展开,已输入/已转写的文本仍在,可改可删。
- **空输入保护**:`text.trim() === ''` 时发送按钮 `disabled`。
- `disabled` 透传:禁用触发器点击、禁用输入与发送。

组件自身**不调用 `useTranslation`**,所有文案由宿主以各自 namespace 翻译后作为 props 传入 —— 这样两处复用零 namespace 冲突,且组件可纯受控单测。

**选项按钮始终可见**:宿主在 `optionChoices.map(...)` 里渲染的固定选项按钮**不受**本组件 `expanded` 影响,展开输入框时它们仍在上方、始终可点。因此用户「后悔」有两条路:
1. 直接点上方选项按钮 → resolve(一直可行)
2. 点 ✕ 收起输入框 → 回到折叠态(新增),继续点选项或再展开

## 接入点(各贴一段条件渲染)

**会话屏** `VibeCodingSessionScreen.tsx` —— 在 `renderApprovalCard` 的 `optionChoices.length` 分支内、「更多 ⋯」那行(`:2207` 附近)旁:

```tsx
{approval.kind === 'client_response' && (
  <ApprovalCustomReply
    approvalId={approval.id}
    triggerLabel={t('session.approval.customReply')}
    placeholder={t('session.approval.customReplyPlaceholder')}
    sendLabel={t('session.approval.customReplySend')}
    disabled={deviceOffline || Boolean(resolvingApproval)}
    sessionId={session.id}
    projectPath={session.directory}
    onSend={msg => handleResolveApproval(approval.id, 'approved', { message: msg })}
  />
)}
```

**审批中心** `ApprovalCenterScreen.tsx` —— 在 `ApprovalCard` 的 `optionActionStack` 内、「更多」链接(`:487` 附近)旁:

```tsx
{item.kind === 'client_response' && (
  <ApprovalCustomReply
    approvalId={item.id}
    triggerLabel={t('approval.customReply')}
    placeholder={t('approval.customReplyPlaceholder')}
    sendLabel={t('approval.customReplySend')}
    disabled={actionsDisabled}
    onSend={msg => onResolve(item.id, 'approved', { message: msg })}
  />
)}
```

发送语义统一为 `decision: 'approved'` + `{ message }`。「拒绝」留给预置的 deny 选项按钮,不混淆。`resolve.ts` 对 `client_response` 只要带 `message` 即触发回传,与 `decision` 无关,故 `approved + message` 一定能发出。

## 数据流(全已存在)

```
onSend(text)
 → onResolve(id, 'approved', { message: text })          // 屏幕层
 → store handleResolveApproval / onResolve
 → respondApproval(id, 'approved', { message })           // api/approvals.ts
 → POST /api/approvals/:id/respond                         // schemas.ts:333 校验
 → resolveApprovalServerSide(approval,'approved',{message})// resolve.ts:33
 → (isClientResponseApproval && message)                   // resolve.ts:55
 → dispatchUserAiMessage(session, { content: message })    // resolve.ts:79
 → AI 开新回合;会话回 running;审批落 approved+resolvedAt;卡片转 resolved 态
```

## i18n(新增 key)

两 namespace × 中英 = 4 个文件,各加 3 个 key:

- `src/i18n/locales/vibecoding/zh.json` 与 `en.json`:
  - `session.approval.customReply`(如「自己回复…」/ "Reply yourself…")
  - `session.approval.customReplyPlaceholder`(如「输入你的回复」/ "Type your reply")
  - `session.approval.customReplySend`(如「发送」/ "Send")
- `src/i18n/locales/operations/zh.json` 与 `en.json`:
  - `approval.customReply` / `approval.customReplyPlaceholder` / `approval.customReplySend`

`VoiceTextInput` 内部 `useTranslation('vibecoding')` 的默认 placeholder 由宿主显式传入的 `placeholder` 覆盖,不产生依赖。

补充:`VoiceTextInput` 的 caption / hint(空闲态提示、录音态状态文本)固定从 `vibecoding` namespace 取(`voiceInput.hint` 等现有 key),因此即便在审批中心(operations 语境)复用,显示的也是这些通用 hint 文案——语义无害、key 已存在、**无需新增**。本次只为输入框 placeholder 做宿主覆盖。若日后要求审批中心的 caption 也本地化,需扩展 `VoiceTextInput` 接受 hint 文案 prop,属非本次范围。

## 测试(TDD,新增 `ApprovalCustomReply.test.tsx`)

- 折叠态:不渲染输入框 / 发送按钮,只渲染触发器。
- 点触发器 → 展开,出现输入框与发送按钮。
- 空文本时发送按钮 `disabled`;输入非空白后启用。
- 输入文本点发送 → 调用 `onSend` 且实参为 `trim()` 后的文本;调用后 `text` 清空、收起。
- 点 ✕ 收起 → 输入框消失、**未**调用 `onSend`;再次展开时文本仍在。
- `disabled=true` → 触发器不响应、输入/发送禁用。

接入层不新增专门测试(现有屏幕测试保持),验收门槛:`tsc` 0 错、全量 jest 不新增失败(以 terminal 基线为准)。

## 边界与风险

- **长度**:`message` 服务端上限 4000(`schemas.ts:333`),组件 `maxLength={2000}` 前端先截,留余量。
- **防重复**:发送即 resolve → 审批转 resolved,`pending` 守卫使触发器与选项区一并消失,无法对同一审批重复发送。
- **会话屏 `canResolve` 守卫**:接入点位于 `optionChoices.length` 分支内,该分支已受 `resolvableApprovalIds` / `canResolve` 闸控,无需额外处理。
- **审批中心守卫源不同(注意)**:该屏 `optionChoices = item.options ?? []` 只受 `pending` 闸控,**没有** `canResolve` / `resolvableApprovalIds`(与会话屏不同源)。自定义回复触发器接 `disabled={actionsDisabled}`(`deviceOffline` 或他卡 `resolving`),与该屏选项按钮同源;接入示例代码已如此写。resolve 后卡片刷新为 resolved 态是现有行为,无需特殊处理。
- **i18n 遗漏风险**:四个文件必须同步加 key,否则落回 key 字面量;实施时逐个核对。

## 不变项(本次零改动)

- 契约类型(`onResolve` 的 `options.message`)
- `api/approvals.ts`(`respondApproval` 已透传 `message`)
- server `schemas.ts` / `resolve.ts` / `derived.ts` / `parsing.ts`
- agent(Go)
